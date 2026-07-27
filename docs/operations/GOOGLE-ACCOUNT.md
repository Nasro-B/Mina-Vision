> 🇬🇧 **English** · [🇫🇷 Français](GOOGLE-ACCOUNT.fr.md)

# Connecting a Google account — Mina Vision

Covers Gmail, Google Calendar, Google Contacts (People API) and Google Tasks in a single
connection. None of these steps ever asks Mina Vision for the Google password — sign-in always
happens in your own browser, on the official Google consent screen.

## Prerequisite — once

1. **Initialize the local Mina Vision vault** (if not already done): open the app → "Memory"
   section → "Initialize" → write down the recovery phrase shown **exactly once**, away from
   the PC. Without this step, no secret (Google included) can be stored.

## Step 1 — Create an OAuth client in Google Cloud Console (owner only)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with
   `<your-account>@gmail.com`.
2. Create a project (e.g. "Mina Vision") or select an existing one.
3. **APIs & Services → Library**: enable *Gmail API*, *Google Calendar API*, *People API*,
   *Google Tasks API*.
4. **APIs & Services → OAuth consent screen**:
   - Type: *External* (standard Gmail account, not Google Workspace).
   - Fill in the app name ("Mina Vision") and a contact e-mail.
   - Add `<your-account>@gmail.com` as a **test user** (avoids Google's verification review for
     personal use).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app** — not "Web application". This type automatically accepts
     any `127.0.0.1` port, so there is no redirect URI to enter manually.
   - Note the displayed **Client ID** and **Client Secret**.

## Step 2 — Connect the account

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm run connect:google
```

- First run: the tool asks for the Client ID and Client Secret from step 1 (typed visibly in
  this terminal, never logged nor transmitted anywhere else), then stores them encrypted for
  next time.
- The default browser opens on the Google consent screen — sign in with
  `<your-account>@gmail.com`, accept the requested permissions (Gmail, Calendar, Contacts,
  Tasks).
- Once validated, a "Account connected" tab appears — the terminal confirms the connection and
  the encrypted token is stored in the local vault.

## What remains after connecting

The credentials are stored and ready, but the wiring in `src/ui/main.mjs` to actually use this
Gmail/Calendar/Contacts/Tasks account in the application is not done yet (the
`gmail.mjs`/`google-personal.mjs` adapters exist and are tested, but are not yet plugged into
the main process). That wiring is the logical next step, not blocked on you.

## Google Home SDK (separate, for the smart home)

The Google Home SDK 1.9 is a separate download from an authenticated Google page (not the same
thing as the OAuth above):

1. Sign in on the official Google Home Developer page with `<your-account>@gmail.com`.
2. Download SDK 1.9.
3. Drop its contents under `%USERPROFILE%\.mina\sdk\google-home\1.9`.
