require('dotenv').config();
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// ── Initialisation Gemini Vision ──────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// ── Fallback OpenRouter (vision gratuit) ──────────────────────────────────────
const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || '',
});
// Modèles vision gratuits sur OpenRouter — essayés dans l'ordre
const OPENROUTER_MODELS = [
    'meta-llama/llama-3.2-11b-vision-instruct:free',  // Llama 3.2 Vision 11B
    'qwen/qwen2-vl-7b-instruct:free',                  // Qwen2 VL 7B
    'google/gemini-2.0-flash-exp:free',                // Gemini 2.0 Flash Exp
    'moonshotai/kimi-vl-a3b-thinking:free',            // Kimi VL
];

// ── Fallback Modal (Qwen3.5-9B self-hosted) ──────────────────────────────────
// Déployé via : modal deploy modal_vision_app.py
const MODAL_ENDPOINT     = process.env.MODAL_ENDPOINT || 'https://berkoun-nasserallah--sourire-vision-analyze.modal.run';
const MODAL_TOKEN_ID     = process.env.MODAL_TOKEN_ID || process.env.MODAL_TOKEN || '';
const MODAL_TOKEN_SECRET = process.env.MODAL_TOKEN_SECRET || '';
function getModalAuthHeader() {
    if (!MODAL_TOKEN_ID) return {};
    if (MODAL_TOKEN_SECRET) {
        const b64 = Buffer.from(`${MODAL_TOKEN_ID}:${MODAL_TOKEN_SECRET}`).toString('base64');
        return { 'Authorization': `Basic ${b64}` };
    }
    return { 'Authorization': `Bearer ${MODAL_TOKEN_ID}` };
}


// ── Prompt métier enrichi ─────────────────────────────────────────────────────
const VISION_PROMPT = `
Tu es un expert en marketing et esthétique dentaire pour une marque de blanchiment des dents.
Analyse cette image ou capture de vidéo (miniature).

═══ CRITÈRES DE SÉLECTION (OUI si AU MOINS UN est vrai) ═══

1. AVANT / APRÈS : Côte à côte ou montage de dents jaunes/tachées devenant blanches.
2. GROS PLAN SOURIRE : Zoom serré sur des dents blanches, un sourire lumineux, des lèvres entrouvertes montrant les dents.
3. DENTS JAUNES / TEINTÉES : Photo de dents colorées (jaunes, brunes, tachées) isolées ou dans un sourire.
4. ACCESSOIRES DE BLANCHIMENT : Gouttière dentaire transparente, lampe LED bleue de blanchiment, seringue de gel blanchissant, plateau dentaire.
5. ÉCARTEURS : Lèvres écartées par des écarteurs dentaires (blancs ou rouges) montrant clairement toutes les dents.
6. NUANCIER / TEINTES : Palette de teintes dentaires (shade guide) placée à côté d'un sourire.
7. RÉSULTAT BLANCHIMENT : Dents visiblement très blanches et brillantes, sourire parfait style "Hollywood smile".
8. VIDÉO TUTORIEL : Miniature vidéo montrant une procédure de blanchiment à domicile ou un résultat dentaire.

═══ CRITÈRES DE REJET (NON si l'un est vrai) ═══

- Selfie ou photo de groupe où les dents ne sont PAS le sujet principal.
- Paysage, aliment, objet du quotidien sans dents visibles.
- Capture d'écran, texte, document, graphique, infographie générique.
- Radiographie dentaire, appareil orthodontique (bagues métalliques), chirurgie orale.
- Photo médicale clinique de cabinet (praticien en blouse dans un cabinet).
- Portrait où la bouche est fermée ou peu visible.

═══ DÉCISION ═══
Réponds UNIQUEMENT "OUI" ou "NON". Aucun autre texte.
`;

// ── Analyse Vision d'une URL de miniature ────────────────────────────────────
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Fallback OpenRouter Vision ────────────────────────────────────────────────
async function analyzeImageOpenRouter(base64Image, contentType) {
    if (!process.env.OPENROUTER_API_KEY) {
        console.log(`  ℹ️  Pas de clé OPENROUTER_API_KEY — fallback ignoré.`);
        return false;
    }
    for (const modelName of OPENROUTER_MODELS) {
        try {
            process.stdout.write(`  🔄 OpenRouter [${modelName.split('/')[1]}]...`);
            const resp = await openrouter.chat.completions.create({
                model: modelName,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: VISION_PROMPT },
                        { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64Image}` } }
                    ]
                }],
                max_tokens: 10,
            });
            const text = resp.choices[0]?.message?.content?.trim().toUpperCase() || '';
            const result = text.startsWith('OUI');
            console.log(result ? ' ✅ OUI' : ' ❌ NON');
            return result;
        } catch (err) {
            const msg = err.message || '';
            // Si 404 (modèle indispo) → essayer le suivant
            if (msg.includes('404') || msg.includes('unavailable') || msg.includes('not found')) {
                console.log(` ⏭️  indispo, essai suivant...`);
                continue;
            }
            // Autre erreur → log et essayer le suivant
            console.log(` ⚠️  ${msg.substring(0, 60)}`);
            continue;
        }
    }
    console.error('  🚫 Tous les modèles OpenRouter sont indisponibles.');
    return false;
}

// ── Fallback Modal Vision (Qwen3.5-9B self-hosted) ──────────────────────────
async function analyzeImageModal(base64Image, contentType) {
    try {
        process.stdout.write(`  🖥️  Modal (Qwen3.5-9B)...`);
        const headers = {
            'Content-Type': 'application/json',
            ...getModalAuthHeader(),
        };
        const resp = await fetch(MODAL_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify({ image_base64: base64Image, mime_type: contentType }),
        });
        if (!resp.ok) {
            const err = await resp.text();
            console.log(` ⚠️  Modal HTTP ${resp.status}: ${err.substring(0, 80)}`);
            return null;
        }
        const data = await resp.json();
        const result = data.result === 'OUI';
        console.log(result ? ' ✅ OUI' : ' ❌ NON');
        return result;
    } catch (err) {
        console.log(` ⚠️  Modal injoignable: ${err.message.substring(0, 60)}`);
        return null;
    }
}

// ── Analyse Vision principale (Gemini → Modal → OpenRouter) ──────────────────
async function analyzeImage(imageUrl, retries = 3) {
    // Récupère la miniature en mémoire
    const response = await fetch(imageUrl).catch(() => null);
    if (!response || !response.ok) return false;
    const buffer = await response.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    try {
        const result = await model.generateContent([
            VISION_PROMPT,
            { inlineData: { data: base64Image, mimeType: contentType } }
        ]);
        const text = result.response.text().trim().toUpperCase();
        return text.startsWith("OUI");
    } catch (error) {
        const is429 = error.message && error.message.includes('429');
        const isDailyLimit = error.message && error.message.includes('PerDay');

        // Quota/minute → wait + retry sur Gemini
        if (is429 && !isDailyLimit && retries > 0) {
            const retryMatch = error.message.match(/retryDelay":"(\d+)s"/);
            const waitSec = retryMatch ? parseInt(retryMatch[1]) + 2 : 65;
            console.log(`\n  ⏳ Quota/min Gemini — attente ${waitSec}s... (${retries} retry restant)`);
            await sleep(waitSec * 1000);
            return analyzeImage(imageUrl, retries - 1);
        }

        // Quota journalier Gemini → bascule Modal (self-hosted) d'abord
        if (is429 && isDailyLimit) {
            console.log(`\n  🔄 Quota Gemini épuisé → essai Modal...`);
            const modalResult = await analyzeImageModal(base64Image, contentType);
            if (modalResult !== null) return modalResult; // Modal a répondu
            // Modal indispo → dernier recours OpenRouter
            console.log(`  🔄 Modal indispo → OpenRouter...`);
            return analyzeImageOpenRouter(base64Image, contentType);
        }

        console.error(`  ⚠️  Erreur Vision: ${error.message.substring(0, 120)}`);
        return false;
    }
}


// ── Extraction de l'URL de la miniature depuis un élément [data-latest-bg] ───
async function extractThumbnailUrl(element) {
    // Méthode 1 : attribut data-latest-bg (URL directe)
    const dataBg = await element.getAttribute('data-latest-bg');
    if (dataBg && dataBg.startsWith('http')) return dataBg;

    // Méthode 2 : style background-image
    const style = await element.getAttribute('style');
    if (style) {
        const m = style.match(/url\(['"]?([^'"\)]+)['"]?\)/);
        if (m && m[1].startsWith('http')) return m[1];
    }

    // Méthode 3 : balise <img> enfant
    const img = await element.$('img[src*="googleusercontent"]');
    if (img) return await img.getAttribute('src');

    return null;
}
// ── Normalisation des URLs Google Photos pour déduplication unique ───────────
function getUniquePhotoId(url) {
    if (!url) return null;
    // Supprimer les options de dimensionnement Google Photos de type =w... ou =s... ou =h...
    const parts = url.split('=');
    if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        if (/^[a-zA-Z0-9-]+$/.test(lastPart)) {
            return parts.slice(0, -1).join('=');
        }
    }
    return url;
}

// ── Agent principal ───────────────────────────────────────────────────────────
async function runAgent() {
    console.log("🚀 Lancement de l'Agent Vision Sourire Concept...\n");

    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const defaultContext = browser.contexts()[0];
    const page = await defaultContext.newPage();

    // Dossier de téléchargement cible
    const client = await page.context().newCDPSession(page);
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: 'C:\\Users\\Nasro\\Downloads\\Nouveau dossier'
    });

    // Naviguer vers la recherche Google Photos (compte u/0)
    const searchUrl = 'https://photos.google.com/u/0/search/CgxkZW50ICsgZGVudHMiDgoMZGVudCArIGRlbnRzKLK4mPC1MzgD';
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log("✅ Page chargée.\n");

    // ── ÉTAPE 1 : Skip la section "les plus pertinents" ──────────────────────
    const sectionHeader = await page.$('div[role="heading"], h2, [data-groupid]');
    if (sectionHeader) {
        await sectionHeader.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        // On scrolle encore 500px pour dépasser visuellement la section
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log("⏩ Section 'les plus pertinents' passée.\n");
    }

    // ── ÉTAPE 2 : Défilement incrémentiel et analyse en temps réel ───────────
    console.log("🧠 Démarrage de l'analyse IA pas à pas (Interactive Bottom-Up)...");
    
    // Positionner le curseur au centre de la page pour activer page.mouse.wheel
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.waitForTimeout(500);

    const processedUrls = new Set();
    let selectedCount = 0;
    let analyzedCount = 0;
    let consecutiveNoNewPhotos = 0;

    while (consecutiveNoNewPhotos < 5) {
        // Récupérer les éléments miniatures actuellement chargés dans le DOM
        let photoElements = await page.$$('[data-latest-bg]');
        if (photoElements.length === 0) {
            photoElements = await page.$$('div[style*="background-image"]');
        }

        let newlyDiscoveredInThisStep = 0;

        for (const element of photoElements) {
            const imageUrl = await extractThumbnailUrl(element);
            if (!imageUrl) continue;

            const uniqueId = getUniquePhotoId(imageUrl);
            if (processedUrls.has(uniqueId)) {
                continue; // Déjà traitée
            }

            // Vérifier si cette photo appartient à la section "pertinents" (index 0)
            const isInPertinents = await element.evaluate((node) => {
                let parent = node.parentElement;
                for (let i = 0; i < 10; i++) {
                    if (!parent) break;
                    if (parent.getAttribute('data-section-index') === '0') return true;
                    parent = parent.parentElement;
                }
                return false;
            }).catch(() => false);

            if (isInPertinents) {
                processedUrls.add(uniqueId); // Marquer comme ignorée
                continue;
            }

            newlyDiscoveredInThisStep++;
            processedUrls.add(uniqueId);
            analyzedCount++;

            console.log(`\n[${analyzedCount}] 🔍 Analyse photo: ${imageUrl.substring(0, 65)}...`);
            const isMatch = await analyzeImage(imageUrl);

            if (isMatch) {
                try {
                    // Faire défiler pour s'assurer que l'élément est dans le viewport
                    await element.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(200);
                    
                    // Hover pour révéler la case à cocher
                    await element.hover();
                    await page.waitForTimeout(300);

                    // Localiser la coche
                    let checkEl = await element.$('div[role="checkbox"]');
                    if (!checkEl) {
                        checkEl = await page.evaluateHandle((node) => {
                            let parent = node.parentElement;
                            for (let i = 0; i < 4; i++) {
                                if (!parent) break;
                                const cb = parent.querySelector('div[role="checkbox"]');
                                if (cb) return cb;
                                parent = parent.parentElement;
                            }
                            return null;
                        }, element);
                        if (!(await checkEl.asElement())) checkEl = null;
                    }

                    if (checkEl) {
                        // Vérifier si elle est déjà sélectionnée
                        const isChecked = await page.evaluate((el) => el.getAttribute('aria-checked') === 'true', checkEl);
                        if (!isChecked) {
                            await checkEl.click();
                            selectedCount++;
                            console.log(`  ✅ SÉLECTIONNÉE (${selectedCount})`);
                        } else {
                            console.log(`  ℹ️ Déjà cochée`);
                        }
                    } else {
                        console.log(`  ⚠️ Case à cocher non trouvée (clic direct sur l'élément)`);
                        // Clic direct en fallback si la checkbox n'apparaît pas
                        await element.click();
                    }
                } catch (err) {
                    console.error(`  ⚠️ Erreur de sélection : ${err.message}`);
                }
                await page.waitForTimeout(200);
            } else {
                console.log(`  ❌ Rejeté`);
            }
        }

        if (newlyDiscoveredInThisStep > 0) {
            consecutiveNoNewPhotos = 0;
            console.log(`\n➕ ${newlyDiscoveredInThisStep} nouvelle(s) photo(s) découverte(s) lors de cette étape.`);
        } else {
            consecutiveNoNewPhotos++;
            console.log(`\n⏳ Aucun nouvel élément découvert. Tentative de défilement ${consecutiveNoNewPhotos}/5...`);
        }

        // 1. Essayer de scroller le dernier élément dans la vue pour forcer le chargement
        if (photoElements.length > 0) {
            try {
                const lastPhoto = photoElements[photoElements.length - 1];
                await lastPhoto.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
                await page.waitForTimeout(500);
            } catch (e) {
                // Ignorer l'erreur silencieusement
            }
        }

        // 2. Défiler le conteneur principal de défilement en JS (méthode robuste)
        await page.evaluate(() => {
            const getScrollContainer = () => {
                let maxScrollHeight = 0;
                let bestContainer = document.documentElement;
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    const style = window.getComputedStyle(el);
                    const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                    if (isScrollable && el.scrollHeight > el.clientHeight) {
                        if (el.scrollHeight > maxScrollHeight) {
                            maxScrollHeight = el.scrollHeight;
                            bestContainer = el;
                        }
                    }
                }
                return bestContainer;
            };
            const container = getScrollContainer();
            if (container) {
                container.scrollBy(0, 1000);
            } else {
                window.scrollBy(0, 1000);
            }
        }).catch(() => {});

        // 3. Fallback additionnel : simuler un appui sur PageDown
        await page.keyboard.press('PageDown').catch(() => {});

        // Attente dynamique pour charger le contenu suivant
        await page.waitForTimeout(2500);
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🎉 Analyse terminée !`);
    console.log(`   Total analysé : ${analyzedCount} | Sélectionné : ${selectedCount}`);
    console.log(`${'─'.repeat(50)}\n`);

    // ── ÉTAPE 3 : Téléchargement de la sélection ─────────────────────────────
    if (selectedCount > 0) {
        console.log("📥 Déclenchement du téléchargement (Shift+D)...");
        await page.waitForTimeout(1000);
        await page.keyboard.down('Shift');
        await page.keyboard.press('D');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(3000);
        console.log("✅ Téléchargement lancé → C:\\Users\\Nasro\\Downloads\\Nouveau dossier");
    } else {
        console.log("ℹ️ Aucun asset sélectionné.");
    }

    await browser.close();
}

runAgent().catch(console.error);

