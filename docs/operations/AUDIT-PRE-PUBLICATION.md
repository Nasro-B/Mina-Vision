# Audit avant publication GitHub — 2026-07-23

> Portée : les **903 fichiers réellement suivis par git** (ceux qui partiraient sur GitHub).
> Méthode : scan par motifs de secrets et de données personnelles, puis vérification manuelle
> de chaque alerte. Aucune alerte n'a été classée sans être ouverte.

## 1. Verdict

**Aucun secret réel dans le dépôt.** Les quatre alertes de sévérité CRITIQUE/ÉLEVÉE sont des
fixtures de test manifestement factices, vérifiées une par une :

| Alerte | Fichier | Valeur réelle trouvée | Verdict |
|---|---|---|---|
| Clé Google | `tests/code/code-review.test.mjs`, `code-verifier.test.mjs` | préfixe Google suivi de la suite `1234567890abcdef…` | Fixture (suite `1234567890abcdef…`) |
| Clé OpenAI | `tests/secret-handling.test.mjs` | préfixe OpenAI suivi de `abcdef1234…` | Fixture |
| Clé privée PEM | `tests/credential-document.test.mjs` | corps = littéralement `fixture` | Fixture |
| JWT | `tests/secret-handling.test.mjs` | payload `{"sub":"1234567890"}` | Exemple public jwt.io |

Ces fixtures sont **nécessaires** : elles prouvent que les détecteurs de secrets de Mina
fonctionnent. Les retirer affaiblirait les tests de sécurité.

## 2. Fichiers sensibles — état du suivi git

| Élément | État | Vérifié par |
|---|---|---|
| `.env` | **ignoré** | `git check-ignore -v .env` → `.gitignore:1` |
| `env/` (client_secret, service account) | **ignoré** | `git check-ignore -v env/` → `.gitignore:4` |
| `.env.example` | suivi — **volontaire**, toutes les clés vides | lecture intégrale |
| `android/app/google-services.json` | ignoré **avant** tout téléchargement | `.gitignore` |
| Coffres, bases, journaux (`*.sqlite`, `*.db`, `logs/`) | ignorés | `.gitignore` |
| Profils navigateur (`profiles/`) | ignorés | `.gitignore` |

## 3. Données personnelles retirées

| Donnée | Où | Traitement |
|---|---|---|
| Serial matériel du Samsung | `tests/adb-mdns-peer.test.mjs` | remplacé par `FIXTURESERIAL01` |
| Adresses e-mail personnelles | `scripts/connect-google-account.mjs` | lue depuis `MINA_GOOGLE_ACCOUNT`, plus aucune adresse en dur |
| Adresses e-mail personnelles | `tests/google-account-connector.test.mjs` | `owner@example.com` |
| Adresses e-mail personnelles | `docs/operations/GOOGLE-ACCOUNT.md` | `<votre-compte>@gmail.com` |
| Nom d'utilisateur Windows | 5 fixtures de test | `C:\Users\Exemple` |
| Chemins machine | `scripts/restore-old-memory-vault.mjs` | dérivés de `%APPDATA%` / `homedir()` |

## 4. Portabilité — bloquant corrigé

Des chemins d'un disque secondaire (`G:\…`) étaient **en dur** dans le code actif : racines
d'écriture de confiance et sandbox (`src/ui/main.mjs`), cache des modèles
(`src/voice/local-voice-worker.mjs`). Sur une machine sans ce disque, l'application aurait
échoué ou écrit hors de son espace.

Corrigé par `src/system/storage-roots.mjs` : tout vit sous le `userData` de l'application par
défaut ; `MINA_CACHE_ROOT`, `MINA_MODELS_ROOT`, `MINA_SANDBOX_ROOT`,
`MINA_SANDBOX_RUNTIME_ROOT` permettent de déporter les caches lourds ;
`MINA_TRUSTED_WRITE_ROOTS` déclare explicitement des racines d'écriture supplémentaires — une
installation neuve n'hérite **jamais** des dossiers de confiance d'une autre.

## 5. Retirés de la publication (code mort)

`agent_vision_sourire.js` (prototype important `@google/generative-ai`, dépendance
désinstallée le 2026-07-22 : le fichier ne pouvait plus s'exécuter), `debug_dom.js`,
`diagnostic_scroll.js`, `modal_vision_app.py`. Les fichiers restent sur le disque local, ils
ne sont simplement plus suivis ni publiés.

## 6. Restes assumés (sans risque)

- Chemins machine et nom d'utilisateur dans les **plans et specs datés** de
  `docs/superpowers/` : ce sont des archives historiques du processus de développement, pas du
  code exécuté. Elles documentent honnêtement ce qui a été fait.
- Adresses IP privées (`192.168.x.x`) dans des fixtures de test et dans `url-policy.mjs` : ce
  sont précisément les plages que la politique anti-SSRF doit **refuser** ; elles n'exposent
  aucun réseau réel.

## 7. Rejouer cet audit

```bash
git ls-files | wc -l
```

Le script d'audit vit dans l'espace de travail temporaire de la session ; sa logique est
reproduite ci-dessus (motifs de clés API/PEM/JWT/AWS + motifs de données personnelles),
appliquée uniquement à la sortie de `git ls-files`.
