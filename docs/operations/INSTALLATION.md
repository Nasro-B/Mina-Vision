> 🇬🇧 **English** · [🇫🇷 Français](INSTALLATION.fr.md)

# Installation and rebuild — Mina Vision

## Requirements

- Node 22, npm.
- Windows 10/11 (Electron `sandbox:true` and Windows Sandbox require Windows).
- For the Android module: JVM 17, Gradle 8.13 (wrapper provided under `android/`).

## Initial install

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm install
```

`npm install` automatically triggers `postinstall` → `node scripts/rebuild-native.mjs`, which rebuilds `better-sqlite3` for the current Electron ABI (`process.versions.modules`). Without this binding, `src/ui/main.mjs` refuses to start (`Binding SQLite Electron ABI ... introuvable`).

## Manual rebuild of the native binding

After an Electron or Node update:

```powershell
npm run rebuild:native
```

The binding is looked up under several candidate roots (`scripts/native-cache-paths.mjs`) before failing explicitly — never a silent substitution by another storage.

## Startup

Three modes; each runs `scripts/verify-mina.ps1` before `npm start` and refuses to start if a blocking prerequisite is missing:

```powershell
npm run start:auto          # cloud allowed when configured, otherwise local
npm run start:local-first    # local preferred, cloud as fallback
npm run start:local-only     # never cloud (-Offline forced, incompatible with -Mode Auto)
```

`npm start` (`electron .`) launches directly without prior verification — reserved for development once the environment is already validated.

## Environment verification

```powershell
npm run verify
```

Runs `scripts/verify-mina.mjs`: versions, paths, port health, model manifests, physical devices and per-feature availability — without ever printing a secret or a full serial number.

## Android module (optional, required for SMS/Telegram/CameraX/Google Home)

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: `BUILD SUCCESSFUL`. The debug APK produced under `android/app/build/outputs/apk/debug` installs on the phone via `adb install`.

### Packaging the APK for distribution (readable name)

To distribute the app to users (GitHub Release / sideload) with a clean name instead of `app-debug.apk`:

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat packageMinaApk
```

Produces `android/app/build/dist/Mina Vision.apk` (a copy of the debug build, debug-key signed → sideload-installable; **not** a Play Store signature — that would require a dedicated `signingConfig` + keystore, not configured to date). The binary stays **out of the repository** (`*.apk` gitignored); it is distributed through a **GitHub release** (`gh release create …`, a manual action). End-user install guide: [`INSTALLER-MINA-TELEPHONE.md`](INSTALLER-MINA-TELEPHONE.md).

## Uninstall

1. Close Mina Vision (`Ctrl+Alt+Esc` then quit, or close the window).
2. Delete the project folder.
3. Delete the Electron `userData` folder (contains the encrypted `mina-keyring.json` and the local memory database) — exact path via `app.getPath('userData')`, specific to each Windows profile.
4. On the phone, uninstall the `fr.mina.gateway` APK if it was installed; this removes the Telegram token and the credentials stored in Android Keystore.
5. No data is sent automatically to any remote service on uninstall — whatever was backed up to Firebase (if configured) stays there until explicit manual deletion.
