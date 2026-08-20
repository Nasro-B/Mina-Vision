> [🇬🇧 English](GOOGLE-ACCOUNT.md) · 🇫🇷 **Français**

# Connecter un compte Google — Mina Vision

Couvre Gmail, Google Calendar, Google Contacts (People API) et Google Tasks en une seule connexion. Aucune de ces étapes ne demande le mot de passe Google à Mina Vision — la connexion se fait toujours dans le navigateur de Nasro, avec l'écran de consentement officiel Google.

## Prérequis — une seule fois

1. **Initialiser le coffre local Mina Vision** (si pas déjà fait) : ouvrir l'app (icône bureau) → section « Mémoire » → « Initialiser » → noter la phrase de récupération affichée **une seule fois**, hors du PC. Sans cette étape, aucun secret (Google inclus) ne peut être stocké.

## Étape 1 — Créer un client OAuth dans Google Cloud Console (Nasro uniquement)

Pour cette installation, le projet cible doit être **`mina-vision`** avec le compte opérateur
**`mina.vision.ai@gmail.com`**. Ne pas utiliser un client OAuth d'un autre projet, y compris
`mina-vission` : le connecteur le refuse quand le fichier téléchargé expose son `project_id`.

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com), se connecter avec `mina.vision.ai@gmail.com`.
2. Sélectionner le projet Google Cloud/Firebase **`mina-vision`**.
3. **APIs et services → Bibliothèque** : activer *Gmail API*, *Google Calendar API*, *People API*, *Google Tasks API*.
4. **APIs et services → Écran de consentement OAuth** :
   - Type : *Externe* (compte Gmail standard, pas Google Workspace).
   - Renseigner nom de l'app (« Mina Vision »), e-mail de contact.
   - Ajouter `mina.vision.ai@gmail.com` comme **utilisateur de test** (évite la revue de vérification Google pour un usage personnel).
   - Si Google affiche `Erreur 403 : access_denied` avec « Mina Vision n'a pas terminé la procédure de validation de Google », l'adresse utilisée dans Chrome n'est pas encore dans cette liste de testeurs OAuth du projet du **Client ID**. Ajouter l'adresse, enregistrer, attendre quelques secondes, puis relancer `npm run connect:google`.
5. **APIs et services → Identifiants → Créer des identifiants → ID client OAuth** :
   - Type d'application : **Application de bureau** (« Desktop app ») — pas « Application Web ». Ce type accepte automatiquement n'importe quel port `127.0.0.1`, donc aucune URI de redirection à saisir manuellement.
   - Télécharger le JSON Google `client_secret_*.json` et le placer dans `C:\Serveurs\Mina Vision\env\`. Pour `mina-vision`, ce fichier est obligatoire : le connecteur bloque la saisie manuelle Client ID/Secret afin d'éviter de reconnecter Mina à un client OAuth d'un autre projet.
   - Si un ancien `client_secret_*.json` d'un autre projet est présent dans `env\`, le déplacer hors de `env\` ou dans `env\archive-oauth-mismatch\` avant de relancer.

## Étape 2 — Connecter le compte

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
$env:MINA_GOOGLE_ACCOUNT='mina.vision.ai@gmail.com'
npm run connect:google
```

- Première exécution : le JSON `client_secret_*.json` doit être présent dans `env\`. L'outil l'utilise sans afficher le secret, puis l'enregistre chiffré pour les prochaines fois. Si `FIREBASE_PROJECT_ID=mina-vision` et que le JSON est absent, l'outil s'arrête avant Chrome avec `client_config_file_required`.
- L'adresse Gmail peut être fournie via `MINA_GOOGLE_ACCOUNT` ou saisie à l'invite si la variable n'est pas définie.
- Le navigateur par défaut s'ouvre sur l'écran de consentement Google — se connecter avec `mina.vision.ai@gmail.com`, accepter les permissions demandées (Gmail, Calendrier, Contacts, Tâches).
- Une fois validé, un onglet « Compte connecté » s'affiche — le terminal confirme la connexion et le jeton chiffré est enregistré dans le coffre local.

## Après la connexion

Les identifiants sont stockés dans le coffre local et le process principal compose déjà les adaptateurs
Gmail, Calendar, Contacts et Tasks via `createGoogleRuntimeAdapters`. La capacité devient
opérationnelle seulement si le coffre contient à la fois le client OAuth et le compte connecté ; sinon
`npm run verify` affiche la raison exacte (`google_oauth_client_config_missing`,
`mail_account_missing`, etc.).

## Google Home SDK (séparé, pour la maison connectée)

Le SDK Google Home 1.9 est un téléchargement distinct depuis une page Google authentifiée (pas la même chose que l'OAuth ci-dessus) :

1. Se connecter sur la page officielle Google Home Developer avec `mina.vision.ai@gmail.com`.
2. Télécharger le SDK 1.9.
3. Déposer le contenu sous `%USERPROFILE%\.mina\sdk\google-home\1.9` (ou définir `MINA_GOOGLE_HOME_SDK_PATH` vers le dossier contenant `manifest.json`). La sonde Mina ne déclare le SDK prêt que si ce `manifest.json` existe.

Détail : voir `Pour Nasro.md`.
