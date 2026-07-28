// Écran de crash de dernier recours (plan de durcissement T1.3). Pur et testable : construit un
// document HTML minimal, entièrement autonome (aucune ressource externe, aucun script distant), qui
// s'affiche quand une exception non rattrapée survient ALORS QU'AUCUNE fenêtre n'existe — le pire
// cas, celui qui laissait Mina en processus fantôme sans rien à l'écran.
//
// Ce module ne connaît pas Electron : il rend du texte en HTML sûr et décide, à partir d'un simple
// booléen « une fenêtre existe-t-elle ? », s'il faut ouvrir ce dernier filet. L'ouverture réelle
// d'une BrowserWindow est la responsabilité de l'appelant ; ici tout est vérifiable hors application.

// Échappement HTML strict : le message d'erreur peut contenir n'importe quoi (chemins, guillemets,
// chevrons). Il est inséré comme TEXTE, jamais interprété — un rapport d'erreur ne doit pas pouvoir
// injecter du balisage dans son propre écran d'affichage.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Réduit une erreur à un rapport NON sensible : un titre court et un détail borné. On ne sérialise
// jamais l'objet entier (il pourrait porter une config, un token) — seulement le message et, s'il
// existe, le nom de l'étape de boot concernée.
export function crashReport({ error, step = null } = {}) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
  const detail = String(message ?? 'erreur inconnue').slice(0, 2_000);
  const title = step ? `Échec au démarrage — étape « ${step} »` : 'Échec au démarrage';
  return Object.freeze({ title, detail });
}

// Décision : faut-il ouvrir l'écran de crash ? Uniquement si AUCUNE fenêtre n'est déjà là pour
// montrer l'erreur. Si une fenêtre existe, elle affiche déjà l'incident (via le canal de boot) et
// ouvrir un second écran serait du bruit.
export function shouldShowCrashScreen({ hasVisibleWindow } = {}) {
  return hasVisibleWindow !== true;
}

export function buildCrashScreenHtml({ error, step = null } = {}) {
  const { title, detail } = crashReport({ error, step });
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  // data: URL-safe, tout en ligne. Deux actions seulement : copier le rapport, relancer. Les deux
  // passent par des identifiants stables que l'appelant câble à ses propres handlers (clipboard,
  // app.relaunch) — le HTML ne fait aucune supposition sur l'environnement d'exécution.
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Mina Vision — ${safeTitle}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem; background: #14161a; color: #e6e6e6; font: 14px/1.6 Segoe UI, system-ui, sans-serif; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; color: #ff8a80; }
  p { margin: 0 0 1rem; color: #a8b0ba; }
  pre { white-space: pre-wrap; word-break: break-word; background: #0d0f12; border: 1px solid #2a2f37; border-radius: 8px; padding: 1rem; color: #e6e6e6; max-height: 40vh; overflow: auto; }
  .actions { margin-top: 1.25rem; display: flex; gap: 0.75rem; }
  button { font: inherit; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #3a4049; background: #1d2127; color: #e6e6e6; cursor: pointer; }
  button:hover { background: #262b33; }
  #status { margin-top: 0.75rem; color: #6ee7a8; min-height: 1.2em; }
</style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>Mina n'a pas pu démarrer normalement. Le rapport ci-dessous décrit l'incident. Aucune donnée n'a quitté ce PC.</p>
  <pre id="report">${safeDetail}</pre>
  <div class="actions">
    <button id="copy" type="button">Copier le rapport</button>
    <button id="relaunch" type="button">Relancer Mina</button>
  </div>
  <div id="status" role="status" aria-live="polite"></div>
  <script>
    const report = document.getElementById('report').textContent;
    const setStatus = (text) => { document.getElementById('status').textContent = text; };
    document.getElementById('copy').addEventListener('click', async () => {
      // Préfère le pont Electron (clipboard natif, fiable hors contexte sécurisé) ; retombe sur
      // l'API navigateur si le pont est absent (écran affiché sans preload, ex. test standalone).
      try {
        if (window.minaCrash && typeof window.minaCrash.copy === 'function') { await window.minaCrash.copy(report); setStatus('Rapport copié.'); return; }
        await navigator.clipboard.writeText(report); setStatus('Rapport copié.');
      } catch { setStatus('Copie impossible — sélectionnez le texte manuellement.'); }
    });
    document.getElementById('relaunch').addEventListener('click', () => {
      if (window.minaCrash && typeof window.minaCrash.relaunch === 'function') window.minaCrash.relaunch();
      else setStatus('Relance indisponible — fermez puis rouvrez Mina.');
    });
  </script>
</body>
</html>`;
}
