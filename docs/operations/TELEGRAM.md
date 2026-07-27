> 🇬🇧 **English** · [🇫🇷 Français](TELEGRAM.fr.md)

# Telegram — Mina Vision

## What Telegram is not

- **Not E2EE.** A Telegram bot sees content in the clear on Telegram's infrastructure before it reaches the phone. Never route through it a secret that Mina herself would otherwise redact (see `src/security/redactor.mjs`).
- **No reliable read receipt.** The Bot API confirms delivery to Telegram, never that the user read it. Mina never claims "read", only "sent"/"delivered".
- **Not a PC authorization.** The mere fact that a message arrives via Telegram grants no capability by itself — see the channel policy below.

## Token provisioning

1. Create the bot via `@BotFather` (`/newbot` command), note the token shown **exactly once**.
2. Never paste the token into a file of this repository, a test, or a shared screenshot.
3. The token is entered from the local Mina Vision screen and stored encrypted in the Android Keystore on the phone (never in Gradle, never in a persistent PC environment variable) — see `docs/operations/ANDROID-HUAWEI.md`.
4. Rotation: revoke via `@BotFather` (`/revoke`) then set the new token through the same screen. No capability is lost for already-active automations — only the transport identity changes.

## Channel policy (what Telegram may request)

`src/safety/channel-policy.mjs` (`classifyChannelCapability`):

- By default: conversation and memory recall only (`conversation.`, `memory.` prefixes).
- Additional capabilities (`mail.*`, `home.read`, `home.low_risk`): refused until explicitly enabled and scoped locally from the PC screen. An unlisted capability stays refused (`decision: 'deny'`), never a permissive default.
- `local_only` is always refused remotely, including from the owner's own Telegram — `src/approvals/remote-approval-service.mjs` (`approval_local_only_forbidden_remote`).

## Remote approvals (one-shot)

For risky capabilities requiring a Samsung/Telegram confirmation: window ≤ 5 minutes, digest bound to the exact action, never reusable, `local_only` always refused remotely.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot stops answering | Token revoked, bot blocked by the user, or polling stopped on the phone |
| Capability unexpectedly refused | Check the local activation of the scoped capability (`telegramCapabilities`) — nothing is permissive by default |
| Invalid confirmation callback | Digest expired (window > 5 min) or already consumed — never replayable |
