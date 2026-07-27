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
    coverage: {
      provider: 'v8',
      // DÉNOMINATEUR HONNÊTE (finding F-08 de l'audit 2026-07-27). Par défaut, V8 ne rapporte que
      // les fichiers CHARGÉS pendant les tests : cinq modules trackés — dont le processus
      // principal Electron et deux workers, qui ne peuvent pas être importés hors d'Electron —
      // disparaissaient purement du calcul, tandis que quatre modules alors ignorés par git y
      // figuraient. Le taux publié ne décrivait donc pas le dépôt.
      // `all: true` force TOUT le source applicatif dans le dénominateur : un fichier jamais
      // exécuté apparaît à 0 %, ce qui est la vérité, au lieu d'être silencieusement absent.
      all: true,
      include: ['src/**/*.mjs', 'src/**/*.js', 'src/**/*.cjs'],
      // Exclusions explicites : contenu non applicatif seulement.
      exclude: ['src/**/*.test.mjs', 'src/ui/**/*.html', 'src/ui/**/*.css'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
