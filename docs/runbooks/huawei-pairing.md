# Appairage Huawei de Mina Vision

Ce runbook concerne le Huawei `MAR-LX1A` qui reste près du PC. Mina Vision ne désactive jamais le Wi-Fi du PC, ne modifie pas le pare-feu Windows et n’active pas automatiquement le débogage réseau Android.

## 1. Vérification USB en lecture seule

1. Déverrouiller le Huawei et accepter l’empreinte ADB du PC.
2. Installer puis ouvrir l’APK debug Mina Vision afin de créer l’identité P-256 dans Android Keystore.
3. Depuis `C:\Serveurs\Mina Vision`, lancer `powershell -NoProfile -File scripts\android\verify-huawei.ps1`.
4. Le résultat doit montrer une seule `deviceId`, le modèle attendu, API 29+, GMS, l’APK et une preuve d’identité. Les numéros de série sont remplacés par une empreinte courte.

Toute seconde identité physique est refusée. Un second endpoint n’est accepté que s’il présente exactement la même identité signée que l’USB. Une seconde identité exige une nouvelle validation locale de Nasro.

## 2. Activation volontaire du débogage Wi-Fi

À exécuter une seule fois, manuellement, uniquement sur le réseau privé de Nasro :

```powershell
adb -s <SERIAL_USB> tcpip 5555
adb connect <IP_HUAWEI>:5555
```

Relancer ensuite le vérificateur. L’état attendu est une seule identité physique avec deux transports ordonnés : `usb`, puis `lan`. USB reste prioritaire ; le LAN prend le relais quand USB devient indisponible.

Ne pas exposer le port 5555 sur un Wi-Fi public ou invité. Pour couper l’écoute réseau du téléphone, utiliser manuellement `adb -s <SERIAL_USB> usb`. Cette commande concerne le téléphone et ne coupe jamais le réseau du PC.

## 3. Telegram et Firebase

Le token BotFather et les identifiants Telegram numériques des deux téléphones sont provisionnés depuis l’écran local Mina Vision vers Android Keystore. Ils ne figurent ni dans Gradle, ni dans ce runbook. Firebase reste optionnel et ne transporte que des enveloppes chiffrées à TTL ; son absence ne bloque pas le build debug.
