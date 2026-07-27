> 🇬🇧 **English** · [🇫🇷 Français](BROWSER-PROFILE-MIGRATION.fr.md)

# Browser profiles — inventory and migration (Task 21)

> Generated 2026-07-22. Tool: `node scripts/inventory-browser-profiles.mjs` (read-only: path,
> size, date, categories — never the contents). **No automatic deletion, ever**: the decision
> belongs to the owner, recorded in the changelog.

## Inventory of 2026-07-22

| Profile | Size | Last modified | Data present | Status |
|---|---|---|---|---|
| `profiles/` (project root) | 150 MB | 2026-07-18 | no Chromium database detected at the root | **legacy, archive candidate** |
| `userData/mina-chrome-profile` | 118 MB | 2026-07-22 | Login Data, Web Data, History | **ACTIVE** — the one browser missions use (`browser-profile-auth`) |

## Rules

1. The ACTIVE profile is `userData/mina-chrome-profile` — never move it while the app is open.
2. `profiles/` (project) is no longer referenced by active code; it is ignored by git.
3. Possible migration: close Mina AND every Chromium process before any copy; prefer the
   browser's official export mechanisms; after the owner's explicit agreement, move to a
   recoverable quarantine (`profiles.perdu-<date>/`) before any real deletion.
4. ACL hardening of the active profile: app CLOSED only (lesson from the 2026-07-22 icacls
   incident).

## Pending decision (owner)

- [ ] Archive or keep `profiles/` (150 MB, last used 07-18). If archiving: it is moved to a
      recoverable quarantine on order, never deleted directly.
