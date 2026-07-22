# Connecter un compte Google — Mina Vision

Couvre Gmail, Google Calendar, Google Contacts (People API) et Google Tasks en une seule connexion. Aucune de ces étapes ne demande le mot de passe Google à Mina Vision — la connexion se fait toujours dans le navigateur de Nasro, avec l'écran de consentement officiel Google.

## Prérequis — une seule fois

1. **Initialiser le coffre local Mina Vision** (si pas déjà fait) : ouvrir l'app (icône bureau) → section « Mémoire » → « Initialiser » → noter la phrase de récupération affichée **une seule fois**, hors du PC. Sans cette étape, aucun secret (Google inclus) ne peut être stocké.

## Étape 1 — Créer un client OAuth dans Google Cloud Console (Nasro uniquement)

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com), se connecter avec `mina.vision.ai@gmail.com`.
2. Créer un projet (ex. « Mina Vision ») ou en sélectionner un existant.
3. **APIs et services → Bibliothèque** : activer *Gmail API*, *Google Calendar API*, *People API*, *Google Tasks API*.
4. **APIs et services → Écran de consentement OAuth** :
   - Type : *Externe* (compte Gmail standard, pas Google Workspace).
   - Renseigner nom de l'app (« Mina Vision »), e-mail de contact.
   - Ajouter `mina.vision.ai@gmail.com` comme **utilisateur de test** (évite la revue de vérification Google pour un usage personnel).
5. **APIs et services → Identifiants → Créer des identifiants → ID client OAuth** :
   - Type d'application : **Application de bureau** (« Desktop app ») — pas « Application Web ». Ce type accepte automatiquement n'importe quel port `127.0.0.1`, donc aucune URI de redirection à saisir manuellement.
   - Noter le **Client ID** et le **Client Secret** affichés.

## Étape 2 — Connecter le compte

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm run connect:google
```

- Première exécution : l'outil demande le Client ID et le Client Secret de l'étape 1 (saisie visible dans ce terminal, jamais journalisée ni transmise ailleurs), puis les enregistre chiffrés pour les prochaines fois.
- Le navigateur par défaut s'ouvre sur l'écran de consentement Google — se connecter avec `mina.vision.ai@gmail.com`, accepter les permissions demandées (Gmail, Calendrier, Contacts, Tâches).
- Une fois validé, un onglet « Compte connecté » s'affiche — le terminal confirme la connexion et le jeton chiffré est enregistré dans le coffre local.

## Ce qui reste après la connexion

Les identifiants sont stockés et prêts, mais le câblage de `src/ui/main.mjs` pour utiliser réellement ce compte Gmail/Calendrier/Contacts/Tâches dans l'application n'est pas encore fait (les adaptateurs `gmail.mjs`/`google-personal.mjs` existent et sont testés, mais ne sont pas encore branchés dans le process principal — même limite documentée pour tous les domaines v4 dans `docs/superpowers/EXECUTION-LOG.md`). Ce câblage est la suite logique, pas bloqué sur toi.

## Google Home SDK (séparé, pour la maison connectée)

Le SDK Google Home 1.9 est un téléchargement distinct depuis une page Google authentifiée (pas la même chose que l'OAuth ci-dessus) :

1. Se connecter sur la page officielle Google Home Developer avec `mina.vision.ai@gmail.com`.
2. Télécharger le SDK 1.9.
3. Déposer le contenu sous `C:\Users\Nasro\.mina\sdk\google-home\1.9`.

Détail : voir `Pour Nasro.md`.
