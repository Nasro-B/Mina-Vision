> 🇬🇧 **English** · [🇫🇷 Français](ANDROID-HUAWEI.fr.md)

# Android gateway — Mina Vision

This document covers the operational context around the phone gateway: permissions, transports,
troubleshooting.

## Single application

`fr.mina.gateway` is the one and only Android application of Mina Vision — a single paired
physical device (`src/devices/physical-device-registry.mjs` refuses a second identity until the
owner approves it locally). It carries SMS, Telegram, CameraX and the USB/LAN/Firebase
transports; there is no second APK.

## Android permissions requested

- **SMS** (read/receive): read/draft/confirm/send, with an explicit auto-send option. An
  incoming SMS never grants any PC, files, skills, sandbox or smart-home capability
  (`tests/integration/android-channel-policy.test.mjs`).
- **Camera** (CameraX): a real sensor stream, distinct from the old `startCamera()`
  (deprecated — it only opened a photo intent).
- **Local network**: LAN transport, enabled only after the manual pairing procedure — never
  automatic at startup.
- **Notifications/foreground service**: keeps Telegram polling and the local transport alive in
  the background.

No Google/account permission is ever used as a Mina authorization — the Google Home identity
remains a feature signal, never an agent authentication channel.

## Transports and priority order

USB → LAN → Firebase (`src/devices/android-transport-client.mjs`). Each transport is tried in
that order for every send; a failure marks the endpoint unavailable and falls through to the
next immediately. Duplicate sends (lost acknowledgment) are deduplicated by envelope id — never
delivered twice.

## Telegram: what the bot cannot guarantee

- **Telegram bots are not E2EE.** Content transits Telegram's infrastructure before reaching
  the phone and then the Mina PC.
- **Delivered ≠ read.** The Bot API provides no reliable read receipt; Mina never claims a
  message was read, only that it was handed to the API.
- The BotFather token and the numeric identifiers of the two phones are stored only in the
  phone's Android Keystore — never in Gradle, never in any file of this repository.
- By default, Telegram has access only to conversation and memory. The `mail.*`, `home.read`,
  `home.low_risk` capabilities are granted only after an explicit local activation from the
  Mina PC screen.

## Common troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `windows_sandbox_feature_disabled` unrelated to Android | Unrelated — see RECOVERY.md | — |
| `.\gradlew.bat` fails with a missing binding | JVM ≠ 17 | Check `JAVA_HOME` points to JDK 17 |
| Two physical identities reported | Second phone plugged in, or badly filtered LAN | Unplug the second device; approve locally if intentional |
| LAN transport unavailable after a PC restart | Android TCP/IP debugging disabled by the phone reboot | Redo step 2 of the pairing procedure (never automatic) |
| Telegram send never delivered | Token revoked or bot blocked by the user | Check the token in BotFather, re-check the chat_id |

## Uninstall

Uninstalling the APK from the phone (Android Settings → Apps → `fr.mina.gateway` → Uninstall)
immediately removes the Telegram token and the associated Android Keystore credentials. The PC
only keeps the signed `deviceId` identity in `physical-device-registry.mjs` (in memory, never
persisted across process restarts); no PC-side action is needed after a phone-side uninstall.
