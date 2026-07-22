# modal_vision_app.py — Modèle : Qwen/Qwen3.5-9B (vision)
# Déploiement : modal deploy modal_vision_app.py
# URL de l'endpoint : https://berkoun-nasserallah--sourire-vision-analyze.modal.run

import modal
import base64
import io
from PIL import Image

# ── App Modal ─────────────────────────────────────────────────────────────────
app = modal.App("sourire-vision")

MODEL_ID = "Qwen/Qwen3.5-9B"

# Image Docker avec toutes les dépendances
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "transformers>=4.51.0",   # Qwen3.5 requiert une version récente
        "torch==2.4.0",
        "torchvision",
        "Pillow",
        "accelerate",
        "qwen-vl-utils[decord]>=0.0.8",
        "pydantic>=2.0",
    ])
    .run_commands([
        # Flash Attention 2 — accélère fortement l'inférence sur A10G
        "pip install flash-attn --no-build-isolation || echo 'flash-attn skipped'"
    ])
    # Pré-télécharger le modèle dans l'image pour éviter le cold start
    .run_commands([
        f"python -c \"from transformers import AutoProcessor, AutoModelForImageTextToText; "
        f"AutoProcessor.from_pretrained('{MODEL_ID}', trust_remote_code=True); "
        f"print('Processor cached.')\" || true"
    ])
)

VISION_PROMPT = """Tu es un expert en marketing et esthétique dentaire pour une marque de blanchiment des dents.
Analyse cette image ou capture de vidéo (miniature).

CRITÈRES DE SÉLECTION (OUI si AU MOINS UN est vrai) :
1. AVANT / APRÈS : Côte à côte ou montage de dents jaunes/tachées devenant blanches.
2. GROS PLAN SOURIRE : Zoom serré sur des dents blanches, un sourire lumineux, des lèvres entrouvertes montrant les dents.
3. DENTS JAUNES / TEINTÉES : Photo de dents colorées (jaunes, brunes, tachées) isolées ou dans un sourire.
4. ACCESSOIRES DE BLANCHIMENT : Gouttière dentaire transparente, lampe LED bleue de blanchiment, seringue de gel blanchissant, plateau dentaire.
5. ÉCARTEURS : Lèvres écartées par des écarteurs dentaires montrant clairement toutes les dents.
6. NUANCIER / TEINTES : Palette de teintes dentaires (shade guide) placée à côté d'un sourire.
7. RÉSULTAT BLANCHIMENT : Dents visiblement très blanches et brillantes, sourire parfait style Hollywood smile.
8. VIDÉO TUTORIEL : Miniature vidéo montrant une procédure de blanchiment à domicile ou un résultat dentaire.

CRITÈRES DE REJET (NON si l'un est vrai) :
- Selfie ou photo de groupe où les dents ne sont PAS le sujet principal.
- Paysage, aliment, objet du quotidien sans dents visibles.
- Capture d'écran, texte, document, graphique.
- Radiographie dentaire, appareil orthodontique (bagues métalliques), chirurgie orale.
- Portrait où la bouche est fermée ou peu visible.

Réponds UNIQUEMENT "OUI" ou "NON". Aucun autre texte."""


# ── Classe du modèle ──────────────────────────────────────────────────────────
@app.cls(
    gpu="A10G",           # 24 GB VRAM — idéal pour Qwen3.5-9B en float16
    image=image,
    container_idle_timeout=300,  # Conteneur chaud 5 min après la dernière requête
    timeout=180,
)
class VisionModel:

    @modal.enter()
    def load(self):
        """Charge Qwen3.5-9B une seule fois au démarrage du conteneur."""
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText

        print(f"⏳ Chargement de {MODEL_ID}...")

        self.processor = AutoProcessor.from_pretrained(
            MODEL_ID,
            trust_remote_code=True,
            min_pixels=256 * 28 * 28,
            max_pixels=768 * 28 * 28,
        )

        self.model = AutoModelForImageTextToText.from_pretrained(
            MODEL_ID,
            trust_remote_code=True,
            torch_dtype=torch.float16,
            device_map="auto",
            attn_implementation="flash_attention_2",  # Activé si flash-attn installé
        )
        self.model.eval()
        print(f"✅ {MODEL_ID} prêt sur {next(self.model.parameters()).device}")

    @modal.web_endpoint(method="POST", label="analyze")
    def analyze(self, payload: dict) -> dict:
        """
        Reçoit  : { "image_base64": "...", "mime_type": "image/jpeg" }
        Retourne: { "result": "OUI" | "NON", "model": "Qwen3.5-9B", "raw": "..." }
        """
        import torch
        from qwen_vl_utils import process_vision_info

        # ── Décoder et redimensionner l'image ────────────────────────────────
        image_bytes = base64.b64decode(payload["image_base64"])
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image.thumbnail((1024, 1024), Image.LANCZOS)

        # ── Construire le message vision ─────────────────────────────────────
        messages = [{
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text",  "text": VISION_PROMPT},
            ],
        }]

        # ── Tokenisation ─────────────────────────────────────────────────────
        text = self.processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,   # Désactive le mode réflexion pour réponse rapide
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self.processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to("cuda")

        # ── Inférence ────────────────────────────────────────────────────────
        with torch.no_grad():
            generated_ids = self.model.generate(
                **inputs,
                max_new_tokens=8,
                do_sample=False,
                temperature=None,
                top_p=None,
            )

        generated_ids_trimmed = [
            out_ids[len(in_ids):]
            for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]
        output_text = self.processor.batch_decode(
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip().upper()

        # ── Décision OUI / NON ───────────────────────────────────────────────
        result = "OUI" if output_text.startswith("OUI") else "NON"
        return {"result": result, "model": "Qwen3.5-9B", "raw": output_text}


# ── Point d'entrée de test local ─────────────────────────────────────────────
@app.local_entrypoint()
def test():
    """Test : modal run modal_vision_app.py"""
    # Crée une image blanche de test (devrait retourner NON)
    from PIL import Image as PILImage
    img = PILImage.new("RGB", (100, 100), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    test_b64 = base64.b64encode(buf.getvalue()).decode()

    vm = VisionModel()
    result = vm.analyze.remote({"image_base64": test_b64, "mime_type": "image/jpeg"})
    print(f"✅ Résultat test : {result}")
