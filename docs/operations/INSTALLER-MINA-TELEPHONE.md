# Installer Mina Vision sur ton téléphone (APK Android)

Ce guide s'adresse à l'**utilisateur final**. L'application téléphone (« Mina Vision.apk »,
paquet `fr.mina.gateway`) sert de passerelle privée entre ton téléphone et l'application Mina
Vision qui tourne sur ton PC : conversation, mémoire, médias — chiffrés, appairés à **un seul PC**.

> L'APK n'est **pas** dans le dépôt de code (seul le code source y est). On l'installe depuis une
> **release GitHub** ou un fichier que t'a transmis la personne qui a construit l'app.

## Ce qu'il te faut

- Un téléphone **Android 10 ou plus récent** (minSdk 29).
- L'application **Mina Vision lancée sur le PC**, sur le **même réseau Wi-Fi** que le téléphone.
- Le fichier **`Mina Vision.apk`** (voir ci-dessous où le récupérer).

## 1. Récupérer l'APK

- **Depuis GitHub** : page **Releases** du dépôt → dernière version → télécharger
  **`Mina Vision.apk`** (GitHub peut l'afficher `Mina.Vision.apk` — c'est le même fichier).
- **Ou** : le fichier `Mina Vision.apk` transmis directement (clé USB, message, etc.).

## 2. Autoriser l'installation

Android bloque par défaut les apps hors Play Store. Une seule fois :

1. Ouvre le fichier `Mina Vision.apk` (appli **Fichiers** → Téléchargements).
2. Android propose **« Autoriser cette source »** / **« Sources inconnues »** → active pour
   l'appli qui ouvre le fichier (Fichiers ou Chrome).
3. Reviens en arrière, rouvre le fichier, **Installer**.

> **Alternative câble (adb)**, si tu préfères : téléphone en débogage USB, puis sur le PC
> `adb install "Mina Vision.apk"`.

## 3. Appairer avec le PC

Mina ne parle **qu'à un PC appairé** — rien ne se connecte tout seul.

1. Sur le **PC** : onglet **Config → « Application Mina sur téléphone »** → **Ouvrir l'appairage**.
   Le PC affiche une **adresse** (ex. `192.168.1.20`), un **port**, et un **code**.
2. Sur le **téléphone** : ouvre Mina Vision → saisis l'**adresse**, le **port** et le **code**.
3. C'est appairé. Tu peux fermer l'appairage sur le PC.

> Tu tapes l'adresse toi-même : **aucune IP n'est codée en dur** dans l'app.

## Bon à savoir

- **Signature** : l'APK est **signé avec la clé debug d'Android** — normal pour une installation
  hors Play Store, sûr en usage local. (Une signature Play Store demanderait un keystore dédié,
  non configuré à ce jour.)
- **Vie privée** : l'app ne contient aucune donnée personnelle en dur ; tout ce qui est échangé
  est chiffré et lié au PC appairé. Révoquer l'appareil côté PC coupe la lecture des messages suivants.
- **Mettre à jour** : installe simplement l'APK plus récent par-dessus (même `applicationId`).
- **Désappairer** : révoque l'appareil dans l'onglet Config du PC, ou désinstalle l'app
  (retire les identifiants stockés dans l'Android Keystore).

## Pour celui qui construit l'APK (rappel)

```bash
cd android
./gradlew packageMinaApk        # produit build/app/build/outputs → build/dist/Mina Vision.apk
```

Puis publier en release GitHub (action manuelle, jamais automatique) :

```bash
gh release create v0.1.0 "android/app/build/dist/Mina Vision.apk" --title "Mina Vision 0.1.0" --notes "Application téléphone — sideload, appairage local."
```

Le binaire reste **hors dépôt** (`*.apk` gitignoré) : seule la release le distribue.
