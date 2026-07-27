> 🇬🇧 **English** · [🇫🇷 Français](LICENCES.fr.md)

# Licenses and dependencies — Mina Vision

> Generated 2026-07-22 (R-17 + light SBOM), **updated 2026-07-24: the source code is now
> PUBLIC** (GitHub repository + companion APK release). Key point for the GPL: the artifacts
> actually distributed embed **no GPL code** — the public repository contains only the source
> (`node_modules` gitignored, hence no espeak-ng) and the APK is the Android app
> `fr.mina.gateway` (zero Node dependency). **No GPL obligation is therefore triggered to
> date** (§1). What remains gated: distributing a **packaged Electron installer/binary WITH
> `node_modules`** — that one would embed espeak-ng → re-read §1 BEFORE shipping such a package.

## 1. espeak-ng decision (GPL-3.0-or-later)

- `espeak-ng@1.0.2` is under **GPL-3.0-or-later**; Mina Vision is under its own
  source-available license (`package.json`: `SEE LICENSE IN LICENSE`, see [LICENSE](LICENSE)) —
  that field still said `ISC` (the `npm init` default) when this document was generated
  (2026-07-22), fixed the next day along with the dedicated LICENSE.
- Actual use: phonemization for Kokoro (local TTS). A NECESSARY dependency for the local voice
  fallback.
- **Decision: kept.** GPL obligations (source availability, license compatibility of the
  whole) are triggered by **distributing a combined binary** containing espeak-ng. Publishing
  the SOURCE (without `node_modules`) or the Android APK (no Node dependency) conveys no GPL
  code → the public release of 2026-07-24 (repository + APK release) triggered no obligation.
- **⚠️ Gate still open — distributing a packaged Electron installer/binary** (with
  `node_modules`, hence espeak-ng embedded): either distribute the whole under the GPL (sources
  included — which is in **tension with the name-protection LICENSE**, more restrictive), or
  replace the phonemizer with a non-GPL alternative. **Owner decision to make BEFORE shipping
  such a package — not settled to date.**

## 2. Direct dependency inventory (prod)

| Package | Version | License |
|---|---|---|
| @azure/msal-node | 5.4.0 | MIT |
| @google/genai | 2.11.0 | Apache-2.0 |
| @huggingface/transformers | 4.2.0 | Apache-2.0 |
| @nut-tree-fork/nut-js | 4.2.6 | Apache-2.0 |
| @scure/bip39 | 2.2.0 | MIT |
| acorn / acorn-walk | 8.15.0 / 8.3.4 | MIT |
| adm-zip | 0.6.0 | MIT |
| argon2 | 0.44.0 | MIT |
| better-sqlite3 | 12.11.1 | MIT |
| diff | 9.0.0 | BSD-3-Clause |
| docx | 9.5.1 | MIT |
| dotenv | 17.4.2 | BSD-2-Clause |
| **espeak-ng** | **1.0.2** | **GPL-3.0-or-later** (see §1) |
| firebase | 12.16.0 | Apache-2.0 |
| google-auth-library | 10.9.0 | Apache-2.0 |
| imapflow | 1.4.7 | MIT |
| kokoro-js | 1.2.1 | Apache-2.0 |
| mailparser | 3.9.14 | MIT |
| nodemailer | 9.0.3 | MIT-0 |
| officeparser | 7.3.0 | MIT |
| onnxruntime-node | 1.27.0 | MIT |
| openai | 6.46.0 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 6.1.200 | Apache-2.0 |
| playwright | 1.61.1 | Apache-2.0 |
| pngjs | 7.0.0 | MIT |
| sharp | 0.35.3 | Apache-2.0 |
| ws | 8.21.1 | MIT |
| yaml | 2.9.0 | ISC |
| zod | 4.4.3 | MIT |

Dev: @electron/rebuild (MIT), @vitest/coverage-v8 (MIT), electron 43.1.0 (MIT), fast-check
(MIT), vitest (MIT), jsdom (MIT). Removed on 2026-07-22 (R-16, zero imports):
`@google/generative-ai`, `mqtt`, `ws` — **`ws` re-introduced the very next day** (the
`mina_app` channel, 2026-07-22 evening/23): a real `WebSocketServer` in
`src/devices/chat-server.mjs`, no longer a dead import. The table above is already up to date;
the associated vulnerability is in §3. `@google/generative-ai` and `mqtt` remain absent
(verified 2026-07-24: zero occurrences in `package.json`/`src/`).

No AGPL dependency. A single GPL (espeak-ng, §1). The skill-auditor also refuses any AGPL skill
at install time (`skill_license_incompatible`).

## 3. npm audit vulnerabilities — reachability and decisions (2026-07-22, re-audited 2026-07-24)

13 advisories (7 moderate, 6 high, 0 critical) — 12 as of 2026-07-22, plus 1 that appeared with
the return of `ws` as a direct dependency (see §2). Most remain **transitive or without a
published fix** (`fixAvailable: false` unless noted); `ws` is the exception: a **direct**
dependency with a published fix. No blanket `npm audit fix` promises — each decision follows
the real reachability path:

| Advisory | Severity | Actual entry path | Decision |
|---|---|---|---|
| adm-zip "Crafted ZIP triggers 4GB memory allocation" | high | Skill install + mail quarantine = the ONLY surfaces that open untrusted zips | **Mitigated in-app**: refusal BEFORE decompression (ratio >100:1, inconsistent sizes, 20/25 MiB bounds, ≤500 entries) — the bomb is never decompressed. Watch adm-zip releases |
| onnxruntime-node (via its embedded adm-zip) | high | Decompression of LOCAL models installed by the owner — no untrusted input | Accepted, monitored |
| sharp (libvips CVE 2026-33327/28, 35590/91) | high | sharp only encodes local screenshots from the desktop worker — never an external image | Accepted, monitored; bump sharp as soon as a fix ships |
| @huggingface/transformers / kokoro-js (via onnxruntime) | high | Local TTS/embedding models | Accepted, monitored |
| file-type (ASF infinite loop) + jimp/@jimp/* / nut-js chain | moderate | jimp is only used by nut-js on local captures | Accepted; partial `fixAvailable: true` on the nut-tree chain: revisit when the fork publishes |
| ws "Uninitialized memory disclosure" (GHSA-58qx-3vcg-4xpx, moderate) + "Memory exhaustion DoS from tiny fragments" (GHSA-96hv-2xvq-fx4p, high), range 8.0.0–8.20.1 | high | `src/devices/chat-server.mjs` — the real `WebSocketServer` of the `mina_app` channel, receives frames from a paired phone (LAN/USB, never the open Internet) | **Mitigated on 2026-07-24**: `ws` updated 8.19.0 → 8.21.1 (out of the vulnerable range), chat server tests green after the update |

Re-verification: `npm audit --json` at every release wave (Wave 4 gate) — replayed on
2026-07-24 during this documentation audit (13 advisories, detail above).

## 4. Regenerating

```bash
npm ls --omit=dev --depth=0
```

```bash
npm audit --json
```

Licenses of direct dependencies: read `node_modules/<package>/package.json` (`license` field).
Update THIS file on every dependency addition/removal — the release gate checks it.
