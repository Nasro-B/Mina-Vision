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

For this installation, the target project must be **`mina-vision`** with the operator account
**`mina.vision.ai@gmail.com`**. Do not use an OAuth client from another project, including
`mina-vission`: the connector refuses it when the downloaded file exposes its `project_id`.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with
   `mina.vision.ai@gmail.com`.
2. Select the Google Cloud/Firebase project **`mina-vision`**.
3. **APIs & Services → Library**: enable *Gmail API*, *Google Calendar API*, *People API*,
   *Google Tasks API*.
4. **APIs & Services → OAuth consent screen**:
   - Type: *External* (standard Gmail account, not Google Workspace).
   - Fill in the app name ("Mina Vision") and a contact e-mail.
   - Add `mina.vision.ai@gmail.com` as a **test user** (avoids Google's verification review
     for personal use).
   - If Google shows `Error 403: access_denied` with "Mina Vision has not completed Google's
     verification process", the address currently used in Chrome is not yet in the OAuth test-user
     list for the project owning the **Client ID**. Add the address, save, wait a few seconds, then
     run `npm run connect:google` again.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app** — not "Web application". This type automatically accepts
     any `127.0.0.1` port, so there is no redirect URI to enter manually.
   - Download Google's `client_secret_*.json` file and place it in
     `C:\Serveurs\Mina Vision\env\`. For `mina-vision`, this file is required: the connector
     blocks manual Client ID/Secret entry to avoid reconnecting Mina to an OAuth client from the
     wrong project.
   - If an old `client_secret_*.json` from another project is present in `env\`, move it out of
     `env\` or into `env\archive-oauth-mismatch\` before retrying.

## Step 2 — Connect the account

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
$env:MINA_GOOGLE_ACCOUNT='mina.vision.ai@gmail.com'
npm run connect:google
```

- First run: the `client_secret_*.json` file must be present in `env\`. The tool uses it without
  printing the secret, then stores it encrypted for next time. If `FIREBASE_PROJECT_ID=mina-vision`
  and the JSON file is absent, the tool stops before Chrome with `client_config_file_required`.
- The Gmail address can be provided through `MINA_GOOGLE_ACCOUNT` or typed at prompt if the variable is missing.
- The default browser opens on the Google consent screen — sign in with
  `mina.vision.ai@gmail.com`, accept the requested permissions (Gmail, Calendar, Contacts,
  Tasks).
- Once validated, a "Account connected" tab appears — the terminal confirms the connection and
  the encrypted token is stored in the local vault.

## After connecting

The credentials are stored in the local vault and the main process already composes the Gmail,
Calendar, Contacts and Tasks adapters through `createGoogleRuntimeAdapters`. The capability becomes
operational only when the vault contains both the OAuth client and the connected account; otherwise
`npm run verify` prints the exact reason (`google_oauth_client_config_missing`,
`mail_account_missing`, etc.).

## Google Home SDK (separate, for the smart home)

The Google Home SDK 1.9 is a separate download from an authenticated Google page (not the same
thing as the OAuth above):

1. Sign in on the official Google Home Developer page with `mina.vision.ai@gmail.com`.
2. Download SDK 1.9.
3. Drop its contents under `%USERPROFILE%\.mina\sdk\google-home\1.9` (or set
   `MINA_GOOGLE_HOME_SDK_PATH` to the directory containing `manifest.json`). Mina's probe only
   reports the SDK as ready if this `manifest.json` exists.
