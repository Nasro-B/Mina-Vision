> 🇬🇧 **English** · [🇫🇷 Français](AUDIT-PRE-PUBLICATION.fr.md)

# Pre-publication GitHub audit — 2026-07-23

> Scope: the **903 files actually tracked by git** (the ones that would land on GitHub).
> Method: pattern scan for secrets and personal data, then manual verification of every alert.
> No alert was classified without being opened.

## 1. Verdict

**No real secret in the repository.** The four CRITICAL/HIGH severity alerts are plainly fake
test fixtures, verified one by one:

| Alert | File | Actual value found | Verdict |
|---|---|---|---|
| Google key | `tests/code/code-review.test.mjs`, `code-verifier.test.mjs` | Google prefix followed by `1234567890abcdef…` | Fixture |
| OpenAI key | `tests/secret-handling.test.mjs` | OpenAI prefix followed by `abcdef1234…` | Fixture |
| PEM private key | `tests/credential-document.test.mjs` | body = literally `fixture` | Fixture |
| JWT | `tests/secret-handling.test.mjs` | payload `{"sub":"1234567890"}` | Public jwt.io example |

These fixtures are **necessary**: they prove Mina's secret detectors work. Removing them would
weaken the security tests.

## 2. Sensitive files — git tracking state

| Item | State | Verified by |
|---|---|---|
| `.env` | **ignored** | `git check-ignore -v .env` → `.gitignore:1` |
| `env/` (client_secret, service account) | **ignored** | `git check-ignore -v env/` → `.gitignore:4` |
| `.env.example` | tracked — **deliberate**, all keys empty | full read |
| `android/app/google-services.json` | ignored **before** any download | `.gitignore` |
| Vaults, databases, journals (`*.sqlite`, `*.db`, `logs/`) | ignored | `.gitignore` |
| Browser profiles (`profiles/`) | ignored | `.gitignore` |

## 3. Personal data removed

| Data | Where | Treatment |
|---|---|---|
| Samsung hardware serial | `tests/adb-mdns-peer.test.mjs` | replaced with `FIXTURESERIAL01` |
| Personal e-mail addresses | `scripts/connect-google-account.mjs` | read from `MINA_GOOGLE_ACCOUNT`, no hardcoded address left |
| Personal e-mail addresses | `tests/google-account-connector.test.mjs` | `owner@example.com` |
| Personal e-mail addresses | `docs/operations/GOOGLE-ACCOUNT.md` | `<your-account>@gmail.com` |
| Windows username | 5 test fixtures | `C:\Users\Exemple` |
| Machine paths | `scripts/restore-old-memory-vault.mjs` | derived from `%APPDATA%` / `homedir()` |

## 4. Portability — blocking issue fixed

Paths from a secondary drive (`G:\…`) were **hardcoded** in active code: trusted write roots
and sandbox (`src/ui/main.mjs`), model cache (`src/voice/local-voice-worker.mjs`). On a machine
without that drive, the application would have failed or written outside its space.

Fixed by `src/system/storage-roots.mjs`: everything lives under the application's `userData` by
default; `MINA_CACHE_ROOT`, `MINA_MODELS_ROOT`, `MINA_SANDBOX_ROOT`,
`MINA_SANDBOX_RUNTIME_ROOT` allow relocating heavy caches; `MINA_TRUSTED_WRITE_ROOTS`
explicitly declares extra write roots — a fresh install **never** inherits another
installation's trusted folders.

## 5. Removed from publication (dead code)

`agent_vision_sourire.js` (a prototype importing `@google/generative-ai`, a dependency
uninstalled on 2026-07-22: the file could no longer run), `debug_dom.js`,
`diagnostic_scroll.js`, `modal_vision_app.py`. First gitignored (untracked, unpublished), they
were **deleted from the project on 2026-07-24** (backed up outside the repository) — they
polluted Mina Code reviews with false positives. Since then, the Mina Code indexer honors
`.gitignore`, so any ignored file is excluded from analysis and review anyway.

## 6. Accepted leftovers (no risk)

- The **plans, specifications and execution log** of `docs/superpowers/` are now EXCLUDED from
  publication (`.gitignore`): internal working documents containing machine paths and the
  detailed development history. They stay on the local disk.
- Private IP addresses (`192.168.x.x`) in test fixtures and in `url-policy.mjs`: these are
  precisely the ranges the anti-SSRF policy must **refuse**; they expose no real network.

## 7. Replaying this audit

```bash
git ls-files | wc -l
```

The audit script lives in the session's temporary workspace; its logic is reproduced above
(API key/PEM/JWT/AWS patterns + personal data patterns), applied only to the output of
`git ls-files`.
