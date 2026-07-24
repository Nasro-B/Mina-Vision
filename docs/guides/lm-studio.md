# Modèles locaux avec LM Studio

Mina Vision peut fonctionner avec des modèles d'IA **100 % locaux**, sans aucune
clé cloud, via [LM Studio](https://lmstudio.ai). C'est optionnel : Mina démarre
sans, et bascule sur le cloud (Gemini, DeepSeek, …) si le local est absent.

Trois usages, chacun optionnel et indépendant :
- **texte** (conversation, raisonnement) ;
- **vision** (analyse d'images/captures) ;
- **embeddings** (mémoire sémantique — recherche par sens, pas seulement par mots).

---

## 1. Installer et lancer LM Studio

1. Installez LM Studio, téléchargez un modèle (texte, et/ou vision, et/ou
   embeddings).
2. Dans LM Studio → onglet **Serveur local** (Local Server) → **Démarrer**. Par
   défaut il écoute sur `http://127.0.0.1:1234`.
3. Chargez le(s) modèle(s) voulu(s) dans le serveur.

> Mina n'accepte qu'un serveur en **loopback local** (`127.0.0.1`/`localhost`) et en
> **HTTP** : le point de tout faire tourner sur votre machine, jamais exposé au réseau.

---

## 2. Variables d'environnement

Dans votre `.env` (voir aussi `.env.example`) :

```bash
# Active la recherche de modèles locaux (true par défaut).
LM_STUDIO_ENABLED=true

# URL du serveur local LM Studio (loopback + HTTP obligatoires).
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1

# Noms des modèles chargés dans LM Studio (laisser vide = usage non activé).
LM_STUDIO_TEXT_MODEL=
LM_STUDIO_VISION_MODEL=
LM_STUDIO_EMBEDDING_MODEL=

# Délai max d'une requête locale (ms). Défaut 240000 (4 min) — un gros modèle sur
# CPU peut être lent.
LM_STUDIO_TIMEOUT_MS=240000
```

Chaque champ modèle est indépendant : renseignez seulement ceux que vous utilisez.
Le nom doit correspondre **exactement** à l'identifiant du modèle affiché dans le
serveur LM Studio.

---

## 3. Choisir local ou cloud

La variable globale d'inférence décide de la priorité :

```bash
# auto        → local si disponible, sinon cloud (défaut)
# local-first → local d'abord, cloud seulement en secours
# local-only  → jamais de cloud (100 % hors ligne pour l'IA)
MINA_INFERENCE_MODE=auto

# Coupe TOUT appel réseau d'IA, quel que soit le mode ci-dessus.
MINA_OFFLINE=false
```

Pour un fonctionnement entièrement local et privé : `MINA_INFERENCE_MODE=local-only`
avec les modèles LM Studio renseignés.

---

## 4. Vérifier

1. LM Studio lancé, modèle(s) chargé(s), serveur démarré.
2. Variables posées, Mina redémarrée.
3. **Config → Capacités** doit indiquer le domaine d'inférence local **disponible**.
   S'il reste « indisponible » ou « dégradé », la raison exacte est affichée
   (serveur injoignable, modèle introuvable, délai dépassé) — jamais un état
   optimiste.
