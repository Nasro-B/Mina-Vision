> 🇬🇧 **English** · [🇫🇷 Français](README.fr.md)

# Mina Vision

**A local voice agent that drives your computer.** Mina listens, watches the screen, and acts:
she controls the browser, any Windows application, and an Android phone connected over ADB.
Everything runs on your machine — locally encrypted memory, your choice of models, no dependency
on any central service.

> Created by **Nasro Berkoun**, in collaboration with **Sol** and **Fable**. See [LICENSE](LICENSE): free to use, study and modify;
> the product name and its creator's name are protected.

---

## What Mina actually does

| Domain | Capability |
|---|---|
| **Voice** | Real-time conversation, instant interruption ("stop"), pause mode, local voice fallback |
| **Browser** | Voice-driven missions: navigate, search, click, type, extract |
| **Windows desktop** | Opens and drives any application (mouse, keyboard, shortcuts) |
| **Android phone** | Camera, SMS, commands over ADB (USB or Wi-Fi) |
| **SMS without internet** | Reach Mina and get her replies by SMS, with no internet connection at all: cellular network → gateway (SIM) → PC on the local network. Every reply is confirmed on the PC by default, one reply per SMS, and no PC actions can ever be triggered from an SMS |
| **Memory** | Local encrypted vault (argon2 + AEAD), semantic search, recovery phrase |
| **Code** | Indexes and analyzes its own code: search, call graph, tests, security review |
| **Documents** | Generates real PDF and Word files; quarantines received documents |
| **Diagnostics** | Activity journal, technical errors explained with a concrete remedy |

One principle runs through the whole project: **the display tells the truth**. A domain that
does not work shows as "unavailable" with the exact missing dependency — never an optimistic
state, never an invented answer.

## Security by construction

- **Single authority over actions**: no action reaches the machine without a time-bounded
  session grant. A sensitive action requires a confirmation cryptographically bound to that
  exact action, consumable exactly once.
- **Hard denials**: password managers, terminals and security tools are refused at the code
  level, whatever the request.
- **Untrusted external content**: an e-mail, a web page or a message can never grant a
  permission nor trigger a tool.
- **Confidential journal**: no conversation text is ever written to disk in the clear; the
  full content is encrypted with a key derived from the vault.
- **Anti-SSRF**: private addresses, loopback and cloud metadata endpoints are refused in web
  research.
- **Cross-cutting emergency stop**: `Ctrl + Alt + Esc` kills voice, missions and actions.

## Requirements

- **Windows 10/11**
- **Node.js 22**
- Optional: **ADB** for the phone, **Windows Sandbox** for isolated execution,
  **LM Studio** for 100% local models

## Install

```bash
npm install
```

```bash
cp .env.example .env
```

Set at least one AI provider key in `.env` (Gemini, OpenRouter, DeepSeek…), then confirm that
these keys are truly yours and have never been shared:

```env
MINA_KEYS_ROTATED=true
```

Without this marker the interface starts, but the AI providers stay deliberately blocked.

## Run

```bash
npm start
```

On first start: **Config → Memory → Initialize**, and **write down the recovery phrase shown
exactly once** — it is the only way to reopen the vault if Windows encryption changes (profile
migration, reinstall).

To start Mina automatically with Windows: **Config → Windows System**.

Global stop: `Ctrl + Alt + Esc` or the **Emergency stop** button.

## Advanced configuration

By default all data lives under the application's user folder. To move heavy caches to another
drive:

| Variable | Effect |
|---|---|
| `MINA_CACHE_ROOT` | Common root for all caches |
| `MINA_MODELS_ROOT` | Local models (voice, embeddings) |
| `MINA_SANDBOX_ROOT` | Sandbox workspace |
| `MINA_TRUSTED_WRITE_ROOTS` | Extra folders writable without confirmation (separated by `;`) |
| `MINA_APPROVED_READ_ROOTS` | Extra folders readable without confirmation |
| `MINA_SAMSUNG_ADB_SERIAL` | Second phone kept connected over Wi-Fi |

## Voice — the essentials

Enable **Live Stream**, then talk:

- "Mina, open YouTube and search for a recipe"
- **Cut her off**: "stop", "hush", "quiet", "silence"
- **Total silence**: "put yourself on pause" → she ignores everything until you say "Mina"
- **Stop everything**: "Mina, stop"

Mina understands phrasings that appear nowhere in this list: understanding is dynamic, not a
fixed lexicon. While a mission is running, a new instruction never launches a second concurrent
mission — it is handed to the mission already in progress.

## Android phone

1. Enable developer options on the phone.
2. **Wi-Fi (Android 11+)**: enable *wireless debugging* — Mina then detects it without a cable
   via mDNS and connects to it. **USB**: plug in, unlock, and accept the ADB RSA fingerprint.
   *(Android 10, like the Huawei: a first activation of Wi-Fi debugging over USB is still
   required — the platform does not expose it any other way.)*
3. In Mina: **Detect phone** (searches USB **and** Wi-Fi), then **Open camera**.

A second device can stay connected over Wi-Fi (`MINA_SAMSUNG_ADB_SERIAL`). Mina falls back to
its last known address if the network announcement stays silent, always with identity
verification before reconnecting.

## Mina app on your phone

An Android application (`android/`) lets you talk with Mina from a paired phone, end-to-end
encrypted.

**📥 Download the app**: [**Mina Vision.apk** (latest release)](https://github.com/Nassreallah-B/Mina-Vision/releases/latest) — or directly [`Mina.Vision.apk` v0.1.0](https://github.com/Nassreallah-B/Mina-Vision/releases/download/v0.1.0/Mina.Vision.apk). Android 10+, debug-key signed (sideload: allow unknown sources). Step-by-step guide: [docs/operations/INSTALLER-MINA-TELEPHONE.md](docs/operations/INSTALLER-MINA-TELEPHONE.md).

Rebuild from source:

```bash
cd android && ./gradlew assembleDebug        # or ./gradlew packageMinaApk → build/dist/Mina Vision.apk
```

The binary stays out of the repository (`*.apk` is gitignored); it is distributed through
[GitHub releases](https://github.com/Nassreallah-B/Mina-Vision/releases).

**Pairing.** On the PC: *Configuration & memory* tab › *Windows System* › **Open pairing** — a
6-digit code appears, valid for 5 minutes and single-use. On the phone: enter the PC address and
that code.

**What the protocol guarantees.**

- The phone stores **ciphertext only**; plaintext exists only in RAM.
- The conversation key is delivered wrapped with a key derived via **ECDH P-256**: no secret
  travels during pairing, and a network observer cannot reconstruct it.
- Every message is **signed**; the signature is verified **before** any decryption.
- Conversation keys derive from the memory vault: **vault locked, channel closed** — announced
  as such rather than silently inert.
- **PC off**: the message stays in a durable queue on the phone and is sent when the PC comes
  back. Nothing is lost, and no stand-in ever answers in Mina's place.
- A message delivered twice (retransmission) produces exactly **one** reply.
- **Revoking** a device opens a new key epoch: it can no longer read subsequent messages (no
  pretense of erasing what it already read).

**Two paths, one reply.** The normal path is the direct link on the local network. When the
phone is not on that network (4G, foreign Wi-Fi), the message goes through a Firestore relay.
The relay carries **exactly the same encrypted and signed envelope**: Firebase never sees
plaintext and cannot inject anything, since the signature is verified before any decryption. A
message that arrives via both paths gets only **one** reply — both share the same ledger of
processed events.

The relay is optional: without `google-services.json`, the channel stays strictly local and the
System tab says so, instead of implying a fallback that does not exist. The published Firestore
rules live in [`firebase/firestore.rules`](firebase/firestore.rules) — they limit abuse (shape,
size, append-only) but are **not** the channel's security, which rests on encryption and
signatures.

Settings: `MINA_CHAT_PORT` (8771 by default), `MINA_CHAT_HOST` (`0.0.0.0`),
`MINA_GOOGLE_SERVICES` (path to `google-services.json`, else `env/google-services.json`).

## Tests

```bash
npm test
```

Runs the unit suite **then** the integration tests — "green" cannot lie by omission. Fast loop
during development:

```bash
npm run test:unit
```

## Documentation

| Resource | Contents |
|---|---|
| Built-in guide (⚙️ button in the app) | Capabilities, voice commands, limits |
| [GitHub releases](https://github.com/Nassreallah-B/Mina-Vision/releases) | Published versions and APK download |
| [MINA.md](MINA.md) | Constitution: security rules and authorized channels |
| [docs/operations/INSTALLATION.md](docs/operations/INSTALLATION.md) | Step-by-step installation |
| [docs/guides/httpsms.md](docs/guides/httpsms.md) | httpSMS gateway (cloud or self-hosted) |
| [docs/guides/lm-studio.md](docs/guides/lm-studio.md) | Local models (text, vision, embeddings) via LM Studio |
| [docs/guides/sandbox-runtimes.md](docs/guides/sandbox-runtimes.md) | Unlock the Windows Sandbox (Python/Node/PowerShell runtimes) |
| [docs/guides/face-model.md](docs/guides/face-model.md) | Local face recognition: provisioning an ONNX model |
| [docs/operations/TELEGRAM.md](docs/operations/TELEGRAM.md) | Telegram channel (conversation and commands) |
| [docs/operations/FIREBASE.md](docs/operations/FIREBASE.md) | Encrypted backup and Firebase relay |
| [docs/operations/ANDROID-HUAWEI.md](docs/operations/ANDROID-HUAWEI.md) | Android phone: pairing, camera, SMS |
| [docs/operations/INSTALLER-MINA-TELEPHONE.md](docs/operations/INSTALLER-MINA-TELEPHONE.md) | Install the APK on a phone (end user, sideload) |
| [docs/operations/RECOVERY.md](docs/operations/RECOVERY.md) | Memory vault recovery |
| [docs/operations/SECURITY.md](docs/operations/SECURITY.md) | Security model and invariants |
| [LICENCES.md](LICENCES.md) | Dependency licenses and decisions |
| [docs/operations/AUDIT-PRE-PUBLICATION.md](docs/operations/AUDIT-PRE-PUBLICATION.md) | Repository privacy audit |
| [docs/operations/SECURITY-AUDIT.md](docs/operations/SECURITY-AUDIT.md) | Security audit report (threats, crypto, sandbox, dependencies) |

## Project status

Mina Vision is a real project, used daily by its author, with an extensive test suite and a
principle of systematic verification against reality. Some domains are shipped and proven,
others are deliberately published as "unavailable" while a dependency is missing —
**Config → Capabilities** shows the exact state of each one.

Mina's Chrome profile is separated from the personal profile. Screenshots stay in memory;
sensitive applications are blocked, including at launch.

## Contributing

Contributions are welcome. Two non-negotiable rules from the license: the project name and its
creator's name stay intact, and no contribution may weaken the security guardrails described
above.

## License

Source-available license — see [LICENSE](LICENSE). Use, study, modification and redistribution
allowed; **the names "Mina", "Mina Vision" and "Nasro Berkoun" are protected** and may not be
removed, replaced or misused. A published derivative work must carry a distinct name and credit
"Based on Mina Vision, created by Nasro Berkoun, in collaboration with Sol and Fable".

Claims and customer service: mina.vision.ai@gmail.com
