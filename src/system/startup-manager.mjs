// Démarrage automatique avec Windows : Mina se lance à l'ouverture de session quand Nasro
// l'active. Passe par l'API Electron officielle (setLoginItemSettings → clé Run de
// l'utilisateur COURANT), jamais par une écriture registre manuelle ni une tâche planifiée
// système : aucune élévation, aucun effet hors du profil utilisateur, réversible en un clic.

const HIDDEN_ARG = '--mina-autostart';

export function createStartupManager({
  getLoginItemSettings,
  setLoginItemSettings,
  executablePath = process.execPath,
  // En développement (electron .), l'exécutable est electron.exe : il FAUT lui repasser le
  // dossier du projet, sinon le démarrage automatique lancerait Electron à vide.
  launchArgs = [],
  isPackaged = true,
} = {}) {
  if (typeof getLoginItemSettings !== 'function' || typeof setLoginItemSettings !== 'function') {
    throw new TypeError('startup_manager_dependencies_required');
  }

  const options = () => (isPackaged
    ? { path: executablePath, args: [HIDDEN_ARG] }
    : { path: executablePath, args: [...launchArgs, HIDDEN_ARG] });

  return Object.freeze({
    status() {
      const settings = getLoginItemSettings(options()) ?? {};
      return Object.freeze({
        enabled: settings.openAtLogin === true,
        startedAtLogin: settings.wasOpenedAtLogin === true,
        supported: process.platform === 'win32' || process.platform === 'darwin',
      });
    },

    // Toujours explicite : `enabled` doit être un booléen, jamais une valeur devinée.
    set(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('startup_enabled_must_be_boolean');
      setLoginItemSettings({
        ...options(),
        openAtLogin: enabled,
        // Démarrage discret : la fenêtre ne vole pas le focus à l'ouverture de session.
        openAsHidden: enabled,
      });
      const settings = getLoginItemSettings(options()) ?? {};
      return Object.freeze({
        enabled: settings.openAtLogin === true,
        requested: enabled,
        // Vérité, pas optimisme : si Windows n'a pas appliqué le réglage, on le dit.
        applied: settings.openAtLogin === enabled,
      });
    },

    // Le processus a-t-il été lancé PAR le démarrage automatique (pour ouvrir en arrière-plan) ?
    launchedByStartup: (argv = process.argv) => argv.includes(HIDDEN_ARG),
  });
}

export const STARTUP_HIDDEN_ARG = HIDDEN_ARG;
