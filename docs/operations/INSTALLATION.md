# Installation et reconstruction — Mina Vision

## Prérequis

- Node 22, npm.
- Windows 10/11 (Electron `sandbox:true` et Windows Sandbox nécessitent Windows).
- Pour le module Android : JVM 17, Gradle 8.13 (wrapper fourni sous `android/`).

## Installation initiale

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm install
```

`npm install` déclenche automatiquement `postinstall` → `node scripts/rebuild-native.mjs`, qui reconstruit `better-sqlite3` pour l'ABI Electron courante (`process.versions.modules`). Sans ce binding, `src/ui/main.mjs` refuse de démarrer (`Binding SQLite Electron ABI ... introuvable`).

## Reconstruction manuelle du binding natif

Après une mise à jour d'Electron ou de Node :

```powershell
npm run rebuild:native
```

Le binding est recherché sous plusieurs racines candidates (`scripts/native-cache-paths.mjs`) avant d'échouer explicitement — jamais de substitution silencieuse par un autre stockage.

## Démarrage

Trois modes, chacun exécute `scripts/verify-mina.ps1` avant `npm start` et refuse de démarrer si un prérequis bloquant manque :

```powershell
npm run start:auto          # cloud autorisé si configuré, sinon local
npm run start:local-first    # local préféré, cloud en secours
npm run start:local-only     # jamais de cloud (-Offline forcé, incompatible avec -Mode Auto)
```

`npm start` (`electron .`) lance directement sans vérification préalable — réservé au développement une fois l'environnement déjà validé.

## Vérification de l'environnement

```powershell
npm run verify
```

Exécute `scripts/verify-mina.mjs` : versions, chemins, santé des ports, manifestes de modèles, appareils physiques et disponibilité par fonctionnalité — sans jamais imprimer de secret ni un numéro de série complet.

## Module Android (optionnel, requis pour SMS/Telegram/CameraX/Google Home)

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Attendu : `BUILD SUCCESSFUL`. L'APK debug produit sous `android/app/build/outputs/apk/debug` s'installe sur le Huawei via `adb install` — voir `docs/runbooks/huawei-pairing.md`.

### Emballer l'APK pour distribution (nom lisible)

Pour distribuer l'app aux utilisateurs (GitHub Release / sideload) avec un nom propre plutôt que `app-debug.apk` :

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat packageMinaApk
```

Produit `android/app/build/dist/Mina Vision.apk` (copie du build debug, signé clé debug → installable en sideload ; **pas** une signature Play Store — il faudrait un `signingConfig` + keystore dédié, non configuré à ce jour). Le binaire reste **hors dépôt** (`*.apk` gitignoré) ; il se distribue via une **release GitHub** (`gh release create …`, action manuelle). Guide utilisateur d'installation : [`INSTALLER-MINA-TELEPHONE.md`](INSTALLER-MINA-TELEPHONE.md).

## Désinstallation

1. Fermer Mina Vision (`Ctrl+Alt+Échap` puis quitter, ou fermer la fenêtre).
2. Supprimer le dossier du projet.
3. Supprimer le dossier `userData` Electron (contient `mina-keyring.json` chiffré et la base mémoire locale) — chemin exact via `app.getPath('userData')`, propre à chaque profil Windows.
4. Sur le Huawei, désinstaller l'APK `fr.mina.gateway` si elle a été installée ; cela retire le token Telegram et les identifiants stockés dans Android Keystore.
5. Aucune donnée n'est envoyée automatiquement à un service distant lors de la désinstallation — ce qui a été sauvegardé sur Firebase (si configuré) y reste jusqu'à suppression manuelle explicite.
