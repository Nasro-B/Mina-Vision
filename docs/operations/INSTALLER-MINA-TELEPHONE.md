> 🇬🇧 **English** · [🇫🇷 Français](INSTALLER-MINA-TELEPHONE.fr.md)

# Install Mina Vision on your phone (Android APK)

This guide is for the **end user**. The phone application ("Mina Vision.apk", package
`fr.mina.gateway`) acts as a private gateway between your phone and the Mina Vision
application running on your PC: conversation, memory, media — encrypted, paired to **one
single PC**.

> The APK is **not** in the code repository (only the source code is). You install it from a
> **GitHub release** or from a file given to you by the person who built the app.

## What you need

- An **Android 10 or newer** phone (minSdk 29).
- The **Mina Vision app running on the PC**, on the **same Wi-Fi network** as the phone.
- The **`Mina Vision.apk`** file (see below where to get it).

## 1. Get the APK

- **From GitHub**: the repository's **Releases** page → latest version → download
  **`Mina Vision.apk`** (GitHub may display it as `Mina.Vision.apk` — same file).
- **Or**: the `Mina Vision.apk` file handed to you directly (USB stick, message, etc.).

## 2. Allow the installation

Android blocks apps from outside the Play Store by default. One time only:

1. Open the `Mina Vision.apk` file (**Files** app → Downloads).
2. Android offers **"Allow from this source"** / **"Unknown sources"** → enable it for the app
   opening the file (Files or Chrome).
3. Go back, reopen the file, **Install**.

> **Cable alternative (adb)**, if you prefer: phone in USB debugging, then on the PC
> `adb install "Mina Vision.apk"`.

## 3. Pair with the PC

Mina only talks to a **paired PC** — nothing connects on its own.

1. On the **PC**: **Config → "Mina app on phone"** tab → **Open pairing**.
   The PC displays an **address** (e.g. `192.168.1.20`), a **port**, and a **code**.
2. On the **phone**: open Mina Vision → enter the **address**, the **port** and the **code**.
3. Paired. You can close pairing on the PC.

> You type the address yourself: **no IP is hardcoded** in the app.

## Good to know

- **Signature**: the APK is **signed with the Android debug key** — normal for an install
  outside the Play Store, safe for local use. (A Play Store signature would require a dedicated
  keystore, not configured to date.)
- **Privacy**: the app contains no hardcoded personal data; everything exchanged is encrypted
  and bound to the paired PC. Revoking the device on the PC side cuts it off from all
  subsequent messages.
- **Updating**: simply install the newer APK on top (same `applicationId`).
- **Unpairing**: revoke the device in the PC's Config tab, or uninstall the app (removes the
  credentials stored in the Android Keystore).

## For whoever builds the APK (reminder)

```bash
cd android
./gradlew packageMinaApk        # produces build/dist/Mina Vision.apk
```

Then publish as a GitHub release (manual action, never automatic):

```bash
gh release create v0.1.0 "android/app/build/dist/Mina Vision.apk" --title "Mina Vision 0.1.0" --notes "Phone application — sideload, local pairing."
```

The binary stays **out of the repository** (`*.apk` gitignored): only the release distributes it.
