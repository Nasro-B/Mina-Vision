import { defineConfig } from 'vitest/config';

// Concurrence BORNÉE (finding F-04 de l'audit 2026-07-27) : le gate `npm test` échouait par
// timeouts en parallélisme par défaut (un worker par cœur), alors que le même corpus passe
// intégralement en série. La suite complète pèse environ 3 Go de mémoire cumulée et plusieurs
// fichiers ouvrent de vrais serveurs (WebSocket, HTTP loopback) ou balaient tout l'arbre source :
// sous contention, ce sont les premiers à dépasser leur budget.
//
// Le choix est de rendre le gate REPRODUCTIBLE plutôt que de gonfler les timeouts, ce qui aurait
// masqué la lenteur réelle. Deux workers gardent un parallélisme utile tout en tenant dans la
// contrainte mémoire connue de ce poste. `--maxWorkers=2` est également passé dans le script
// `test:unit` de package.json pour que la valeur soit visible là où la commande est lue.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    testTimeout: 10_000,
    maxWorkers: 2,
  },
});
