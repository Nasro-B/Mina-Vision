// Injection de faute de boot (plan de durcissement T1.1). Primitive PURE et testable qui permet
// de prouver, à chaque étape nommée du démarrage, que la fenêtre reste vivante quand cette étape
// échoue. Sans elle, l'invariant « le boot ne meurt jamais » ne serait qu'une intention : ici il
// devient vérifiable, étape par étape.
//
// Contrat : `bootFault('nom-etape')` lève UNIQUEMENT si la variable d'environnement
// `MINA_BOOT_FAULT` vaut exactement ce nom (ou le contient dans une liste séparée par des virgules).
// En production, la variable est absente → la fonction est un no-op à coût nul. C'est un hook de
// TEST borné : il ne lit qu'une variable d'environnement, ne prend aucune entrée réseau ni fichier,
// et ne peut qu'ajouter un throw là où il est explicitement appelé — jamais élargir un privilège.

const ENV_KEY = 'MINA_BOOT_FAULT';

function faultSet(env) {
  const raw = env?.[ENV_KEY];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const names = raw.split(',').map((name) => name.trim()).filter(Boolean);
  return names.length ? new Set(names) : null;
}

// Vrai si une faute est armée pour cette étape. Extrait pour que les tests interrogent la décision
// sans provoquer le throw.
export function bootFaultArmed(step, env = process.env) {
  const set = faultSet(env);
  return set !== null && typeof step === 'string' && set.has(step);
}

export function bootFault(step, env = process.env) {
  if (bootFaultArmed(step, env)) {
    // Message reconnaissable et NON sensible : il nomme l'étape injectée, rien d'autre.
    throw new Error(`boot_fault_injected:${step}`);
  }
}

export const BOOT_FAULT_ENV_KEY = ENV_KEY;
