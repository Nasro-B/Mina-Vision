> 🇬🇧 **English** · [🇫🇷 Français](SECURITY-AUDIT.fr.md)

# Security audit report — Mina Vision

- **Origin**: initial audit by Antigravity / Gemini (Mythos mode).
- **Verification**: every verifiable claim was **replayed against the source code** by Claude (Opus) on 2026-07-25 — `file:line` references below. Two inaccuracies of the original report were corrected (see "Corrections").
- **Status**: solid, verified security structure. No real secret in the code (pre-publication audit + history purge of the fake DeepSeek fixture).

> This document is a **dated snapshot**. Vulnerability counts and distribution state evolve — the runtime sources of truth remain `LICENCES.md §3` (dependencies) and **Config → Capabilities** (domain states).

## Corrections applied to the original report

1. **npm vulnerability count: 12** (5 high, 7 moderate, 0 critical), re-measured on 2026-07-27. The figure moved 12 → 13 → 12: `ws` came back as a direct dependency, then was updated out of its vulnerable range. Source: `LICENCES.md §3`.
2. **The "strictly local and single-user" statement is obsolete.** Since 2026-07-24 the repository is **public** (GitHub), the **companion APK is published** (release v0.1.0), and the application is **multi-user** (welcome window + profiles). The security model stands (the owner remains the sole authority), but "single-user / not distributed" is false — see "Distribution context".

---

## 1. Threat model & system invariants

Mina Vision runs locally with the Windows user's privileges. Defense rests on least privilege applied to third-party code execution, environment confinement and network isolation. **The most restrictive rule always wins**; a confirmation is only valid for one action, one digest and one bounded duration (`MINA.md`).

The invariants are **executable**: `tests/security-invariants.test.mjs` locks **10 rules** (verified: 10 test cases). Unplugging a defense fails the suite. The most critical:

1. **Anti-SSRF** (`src/research/url-policy.mjs`) — loopback, `.local`, URL credentials, all private IPv4/IPv6 ranges, verified DNS resolution and re-verified final redirect.
2. **Sensitive file protection** (`src/system/storage-roots.mjs` + credentials ACL) — access refused by path AND by content for credential documents (OAuth clients, service accounts, private keys, browser databases), even renamed; read roots bounded to the project + `Documents\Mina Vision`.
3. **Capability Broker** (authority over Computer Use actions) — without a bounded session grant (mission + duration), no action reaches the executor; every sensitive action requires a local confirmation cryptographically bound to the exact action digest, consumed exactly once.

## 2. Dependency audit (npm audit)

**12 advisories** (7 moderate, 5 high, 0 critical) measured on 2026-07-27. Most are **transitive or without a published fix**; decisions are made by real reachability path (full detail: `LICENCES.md §3`).

| Package | Severity | Vulnerability | Impact path | Status |
| :--- | :--- | :--- | :--- | :--- |
| `sharp` (libvips) | High | Code execution / DoS | Encodes **only** local screenshots from the desktop worker | Controlled (`sharp` 0.35.3 direct); monitored, bumped as soon as a fix ships |
| `onnxruntime` / `@huggingface/transformers` / `kokoro-js` | High | via embedded adm-zip / models | Decompression of **local models** installed by the owner — no untrusted input | Accepted, monitored |
| `file-type` (`nut-js` → `jimp` chain) | Moderate | Infinite loop (DoS) on ASF format | Local vision — no untrusted web file ingestion | Negligible |
| `ws` (8.0.0–8.20.1) | High | Memory disclosure / DoS via fragments | `chat-server.mjs` — frames from a paired phone (LAN/USB, never open Internet) | **Mitigated**: `ws` 8.21.1 (out of range), tests green |

## 3. Vault & cryptography

Single vault `src/crypto/keyring.mjs`:

- **Double envelope layer**: master key wrapped locally under Windows **DPAPI** protection (`safeStorage`).
- **Argon2id derivation** (verified `keyring.mjs:8-10`): `type: argon2id`, `memoryCost: 65,536` (**64 MB**), `timeCost: 3`, `parallelism: 1`. If DPAPI is lost (reinstall, Windows profile rotation), re-initialization goes through a 12-word **BIP39** phrase (official English 2048-word list, NFKD normalization).
- **Atomic rotation** (`keyring.mjs`, cf. `SECURITY.md`): new key generated, batch re-encryption, progress journal, final switch, old key deleted **after** full verification. An interruption resumes at the last confirmed batch — never a silent loss nor a bricked secret.
- **Recovery phrase**: displayed **exactly once**, never journaled, never returned over IPC after the initial screen.

## 4. Confinement & virtualization (Windows Sandbox)

Third-party code execution inside disposable Windows Sandbox (WSB) machines:

- **PowerShell robustness**: system detection validates the drive letter with a strict regex `^[A-Za-z]:$` (verified `src/sandbox/windows-sandbox.mjs:30`) — no argument injection nor command restriction bypass.
- **Traversal validation**: import/export goes through `within()` (verified `src/sandbox/guest-runner.mjs` + `src/sandbox/job-workspace.mjs`) — any write attempt outside the sandbox's temporary directory fails (`sandbox_source_escape`, `sandbox_runtime_escape`, `sandbox_entrypoint_escape`, `sandbox_artifact_escape`, `sandbox_workspace_escape`).
- **Guest isolation**: network, clipboard, printer, camera, microphone, vGPU, user profile and project are unreachable from the guest (`MINA.md`).

## 5. Local database

All local SQLite queries use **prepared statements with bound values** (verified `src/usage/analytics-query.mjs:68` — `db.prepare(...).all(parameters)`): SQL injection through values is eliminated. `WHERE` clause fragments are built from a fixed column set in code, never from raw user input.

## 6. Distribution context *(replaces the original report's "single-user" claim)*

- **Distribution**: the source code is **public** (GitHub repository) and the **companion APK is published** (release v0.1.0, sideload). These are not "single-machine" artifacts — see the GPL/espeak-ng note (`LICENCES.md §1`) about the conditions for a future packaged installer.
- **Multi-user**: the application supports **multiple profiles** (name, pronouns, language, tone, theme) through the welcome window. Profiles are **personalization** — they grant **no privilege** and never modify `MINA.md`.
- **Owner / authority** (`MINA.md`): only the owner, through a **local confirmation on the PC**, authorizes a sensitive action. A remote identity (phone, Telegram) must be **linked and verified** before any access, and can never authorize a `local_only` action remotely. An active profile ≠ an owner.
- **Multi-tenant SaaS** (tenant isolation, SSR grids): **N/A** — Mina Vision is not a SaaS service; those concerns belong to other projects and are out of scope for this repository.

---

*See also: [`SECURITY.md`](SECURITY.md) (operational runbook), [`LICENCES.md`](../../LICENCES.md) (dependencies + §3 vulnerabilities), [`AUDIT-PRE-PUBLICATION.md`](AUDIT-PRE-PUBLICATION.md) (repository privacy audit).*
