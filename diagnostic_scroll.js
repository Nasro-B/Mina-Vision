require('dotenv').config();
const { chromium } = require('playwright');

async function main() {
    console.log("🔌 Connexion à Chrome sur le port 9222...");
    try {
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
        console.log("✅ Connecté au navigateur ! Contextes ouverts :", browser.contexts().length);
        const context = browser.contexts()[0];
        const pages = context.pages();
        console.log("Pages ouvertes :");
        for (let i = 0; i < pages.length; i++) {
            console.log(`  [${i}] Title: "${await pages[i].title()}" | URL: ${pages[i].url()}`);
        }

        // On prend la page Google Photos si elle est déjà ouverte, sinon on prend la dernière page
        let page = pages.find(p => p.url().includes('photos.google.com'));
        if (!page) {
            console.log("⚠️ Google Photos n'a pas été trouvé dans les onglets ouverts, on prend le premier.");
            page = pages[0];
        }

        if (!page) {
            console.log("❌ Aucune page ouverte dans le navigateur.");
            await browser.close();
            return;
        }

        console.log(`\n🔎 Analyse de la page : "${await page.title()}"`);

        // Analyser le scroll container en JS dans la page
        const scrollInfo = await page.evaluate(() => {
            const containers = [];
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const style = window.getComputedStyle(el);
                const hasScrollableStyle = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll';
                if (hasScrollableStyle && el.scrollHeight > el.clientHeight) {
                    containers.push({
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight,
                        scrollTop: el.scrollTop
                    });
                }
            }
            return {
                windowScrollY: window.scrollY,
                documentScrollHeight: document.documentElement.scrollHeight,
                documentClientHeight: document.documentElement.clientHeight,
                containers
            };
        });

        console.log("\n📊 Informations de défilement (Scroll Info) :");
        console.log(`  Window scrollY : ${scrollInfo.windowScrollY}`);
        console.log(`  Document scrollHeight : ${scrollInfo.documentScrollHeight}`);
        console.log(`  Document clientHeight : ${scrollInfo.documentClientHeight}`);
        console.log(`  Scroll containers trouvés (${scrollInfo.containers.length}) :`);
        scrollInfo.containers.forEach((c, idx) => {
            console.log(`    [${idx}] Tag: ${c.tagName} | Class: "${c.className}" | ID: "${c.id}" | scrollHeight: ${c.scrollHeight} | clientHeight: ${c.clientHeight} | scrollTop: ${c.scrollTop}`);
        });

        // Nombre de photos chargées dans le DOM
        const photoCount = await page.$$eval('[data-latest-bg]', els => els.length).catch(() => 0);
        const photoCountFallback = await page.$$eval('div[style*="background-image"]', els => els.length).catch(() => 0);
        console.log(`\n🖼️ Éléments miniatures détectés :`);
        console.log(`  [data-latest-bg] : ${photoCount}`);
        console.log(`  div[style*="background-image"] : ${photoCountFallback}`);

        await browser.close();
    } catch (err) {
        console.error("❌ Erreur de connexion ou d'analyse :", err);
    }
}

main().catch(console.error);
