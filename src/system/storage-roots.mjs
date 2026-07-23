// Racines de stockage PORTABLES. Mina Vision doit démarrer sur n'importe quelle machine :
// aucun chemin de disque en dur. Chaque racine est résolue dans cet ordre —
//   1. variable d'environnement explicite (permet de déporter les caches lourds sur un autre
//      disque, ce que fait la machine d'origine avec un disque secondaire) ;
//   2. sous-dossier du userData de l'application (défaut portable, toujours inscriptible).

import { join } from 'node:path';

export function resolveStorageRoots({ userDataPath, env = process.env } = {}) {
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new TypeError('storage_roots_user_data_required');
  }
  const fromEnv = (name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  // Racine commune optionnelle : un seul réglage suffit à tout déporter.
  const cacheRoot = fromEnv('MINA_CACHE_ROOT') ?? join(userDataPath, 'cache');

  return Object.freeze({
    cacheRoot,
    // Modèles locaux (Kokoro, embeddings) — volumineux, souvent déportés.
    modelsRoot: fromEnv('MINA_MODELS_ROOT') ?? join(cacheRoot, 'models'),
    // Espace de travail du bac à sable Windows : doit être NTFS et inscriptible.
    sandboxRoot: fromEnv('MINA_SANDBOX_ROOT') ?? join(cacheRoot, 'sandbox'),
    sandboxRuntimeRoot: fromEnv('MINA_SANDBOX_RUNTIME_ROOT') ?? join(cacheRoot, 'sandbox-runtime'),
    // Racines d'écriture supplémentaires approuvées (séparateur « ; »), vides par défaut :
    // aucune machine tierce n'hérite des racines de confiance d'une autre installation.
    extraTrustedRoots: Object.freeze(
      (fromEnv('MINA_TRUSTED_WRITE_ROOTS') ?? '')
        .split(';')
        .map((root) => root.trim())
        .filter(Boolean),
    ),
  });
}
