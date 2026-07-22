require('dotenv').config();
const { chromium } = require('playwright');

async function debugDOM() {
    console.log("🔍 Connexion à Chrome...");
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const defaultContext = browser.contexts()[0];
    const page = await defaultContext.newPage();

    await page.goto('https://photos.google.com/u/0/search/CgxkZW50ICsgZGVudHMiDgoMZGVudCArIGRlbnRzKLK4mPC1MzgD', { waitUntil: 'networkidle' });
    console.log("✅ Page chargée. Attente 3 secondes...");
    await page.waitForTimeout(3000);

    // Scroll une fois pour activer le lazy loading
    await page.evaluate('window.scrollTo(0, 600)');
    await page.waitForTimeout(2000);

    // Tester différents sélecteurs candidats
    const selectors = [
        'div[data-is-item="true"]',
        'div[jsaction*="click"]',
        '[data-latest-bg]',
        'div[role="checkbox"]',
        'c-wiz[data-p]',
        'div.yDSiEe',   // classe connue Google Photos
        'div[data-num-items]',
        'div[style*="background-image"]',
        'img[src*="googleusercontent"]',
        '[aria-label][data-id]',
    ];

    console.log("\n📊 RÉSULTATS DES SÉLECTEURS :");
    for (const sel of selectors) {
        const count = await page.$$eval(sel, els => els.length).catch(() => 0);
        console.log(`  ${count > 0 ? '✅' : '❌'} "${sel}" → ${count} élément(s)`);
    }

    // Dump des 3 premiers children du body pour comprendre la structure
    const bodyInfo = await page.evaluate(() => {
        const getInfo = (el, depth = 0) => {
            if (depth > 2) return '';
            const tag = el.tagName;
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className ? `.${el.className.split(' ').slice(0, 2).join('.')}` : '';
            const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '';
            const dataP = el.getAttribute('data-p') ? '[data-p]' : '';
            const jsaction = el.getAttribute('jsaction') ? '[jsaction]' : '';
            let info = `${'  '.repeat(depth)}${tag}${id}${cls}${role}${dataP}${jsaction}\n`;
            for (const child of Array.from(el.children).slice(0, 3)) {
                info += getInfo(child, depth + 1);
            }
            return info;
        };
        const main = document.querySelector('main') || document.querySelector('body');
        return getInfo(main);
    });
    console.log("\n🌳 Structure DOM (3 niveaux depuis main) :\n" + bodyInfo);

    // Chercher TOUTES les images Google Photos (googleusercontent)
    const allImgs = await page.$$eval('img[src*="googleusercontent"]', imgs => 
        imgs.slice(0, 5).map(img => ({ src: img.src.substring(0, 80), parent: img.parentElement?.className }))
    );
    console.log("\n🖼️ Exemples d'images trouvées :");
    allImgs.forEach(i => console.log(`  src: ${i.src}...\n  parent class: ${i.parent}\n`));

    await browser.close();
}

debugDOM().catch(console.error);
