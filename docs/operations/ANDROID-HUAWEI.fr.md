> [🇬🇧 English](ANDROID-HUAWEI.md) · 🇫🇷 **Français**

# Passerelle Android Huawei — Mina Vision

Procédure d'appairage pas à pas : `docs/runbooks/huawei-pairing.md`. Ce document couvre le contexte opérationnel autour de cette procédure : permissions, transports, dépannage.

## Application unique

`fr.mina.gateway` est l'unique application Android de Mina Vision — un seul appareil physique appairé (`src/devices/physical-device-registry.mjs` refuse une seconde identité tant que Nasro ne l'a pas approuvée localement). Elle porte SMS, Telegram, CameraX et les transports USB/LAN/Firebase ; il n'y a pas de seconde APK.

## Permissions Android demandées

- **SMS** (lecture/réception) : lecture/brouillon/confirmation/envoi, avec option d'envoi automatique explicite. Un SMS entrant n'accorde jamais de capacité PC, fichiers, skills, sandbox ou domotique (`tests/integration/android-channel-policy.test.mjs`).
- **Caméra** (CameraX) : flux capteur réel, distinct de l'ancien `startCamera()` (dépréciée — n'ouvrait qu'un intent photo).
- **Réseau local** : transport LAN, activé uniquement après la procédure manuelle du runbook — jamais automatique au démarrage.
- **Notifications/foreground service** : maintien du polling Telegram et du transport local en arrière-plan.

Aucune permission Google/compte n'est utilisée comme autorisation Mina — l'identité Google Home reste un signal de fonctionnalité, jamais un canal d'authentification de l'agent.

## Transports et ordre de priorité

USB → LAN → Firebase (`src/devices/android-transport-client.mjs`). Chaque transport est essayé dans cet ordre pour chaque envoi ; un échec marque l'endpoint indisponible et bascule immédiatement sur le suivant. Les envois dupliqués (accusé de réception perdu) sont dédupliqués par identifiant d'enveloppe — jamais livrés deux fois.

## Telegram : ce que le bot ne peut pas garantir

- **Les bots Telegram ne sont pas E2EE.** Le contenu transite par l'infrastructure Telegram avant d'atteindre le téléphone puis Mina PC.
- **Livré ≠ lu.** L'API Bot ne fournit aucun accusé de lecture fiable ; Mina ne prétend jamais qu'un message a été lu, seulement qu'il a été transmis à l'API.
- Le token BotFather et les identifiants numériques des deux téléphones (Samsung propriétaire, Huawei passerelle) sont stockés uniquement dans Android Keystore côté téléphone — jamais dans Gradle, jamais dans un fichier de ce dépôt.
- Par défaut, Telegram n'a accès qu'à la conversation et à la mémoire. Les capacités `mail.*`, `home.read`, `home.low_risk` ne sont accordées qu'après activation locale explicite depuis l'écran Mina PC.

## Dépannage courant

| Symptôme | Cause probable | Action |
|---|---|---|
| `windows_sandbox_feature_disabled` sans rapport avec Android | Sans rapport — voir RECOVERY.md | — |
| `.\gradlew.bat` échoue avec un binding introuvable | JVM ≠ 17 | Vérifier `JAVA_HOME` pointe vers JDK 17 |
| `verify-huawei.ps1` rapporte deux identités physiques | Second téléphone branché ou LAN mal filtré | Débrancher le second appareil, approuver localement si intentionnel |
| Transport LAN indisponible après redémarrage du PC | Débogage TCP/IP Android désactivé au redémarrage du téléphone | Refaire l'étape 2 du runbook d'appairage (jamais automatique) |
| Envoi Telegram jamais livré | Token révoqué ou bot bloqué par l'utilisateur | Vérifier le token dans BotFather, revérifier le chat_id |

## Désinstallation

Désinstaller l'APK depuis le téléphone (Paramètres Android → Applications → `fr.mina.gateway` → Désinstaller) retire immédiatement le token Telegram et les identifiants Android Keystore associés. Le PC ne conserve que l'identité `deviceId` signée dans `physical-device-registry.mjs` (en mémoire, jamais persistée entre redémarrages du processus) ; aucune action côté PC n'est nécessaire après une désinstallation côté téléphone.
