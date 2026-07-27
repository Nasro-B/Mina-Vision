> 🇬🇧 **English** · [🇫🇷 Français](httpsms.fr.md)

# SMS gateway with httpSMS

Mina sends and receives SMS **natively** from a paired Android phone. **httpSMS** is a fallback
path: when that phone is offline, Mina goes through an httpSMS service to keep sending/receiving
SMS.

This guide is for **all Mina Vision users**. It is optional: without httpSMS configuration,
Mina uses native SMS only.

---

## 1. The principle (read this first)

httpSMS does **not** provide a phone number. **A phone with a SIM card IS the gateway**: the
httpSMS app installed on it sends and receives the real SMS. The httpSMS "server" only relays
API calls to that phone.

**Consequence: Mina's number = the SIM number of the gateway phone.** There is no universal
"Mina number" — each user plugs in their own phone and gets their own number. That is also why
there is no number to hand out on GitHub.

> The repository contains **only the protocol adapter** for httpSMS (client, webhook, signature
> verification). The httpSMS service itself (AGPL license) is not embedded: you either use the
> httpsms.com cloud or self-host it.

---

## 2. Two ways to do it

### Path A — httpsms.com cloud (recommended, no hosting)

1. Install the **httpSMS** app (Google Play) on the phone that will carry the gateway SIM, and
   connect it to an **httpsms.com** account.
2. On **httpsms.com** → create an **API key**.
3. Still on httpsms.com → enable the incoming **webhook** and note its **signing secret**.
4. Fill in Mina's `.env` (see section 4). `HTTPSMS_BASE_URL` stays `https://api.httpsms.com`.

The free tier is enough for personal use.

### Path B — Self-hosted (no third party)

The httpSMS server is open source (Go): `https://github.com/NdoleStudio/httpsms`.

1. Deploy it (Docker or binary) on a VPS, Render, or your own machine. It needs a
   **PostgreSQL** database and a **public HTTPS URL** (the phone and the webhooks must reach it).
2. In the phone's httpSMS app, point to **your** server instead of httpsms.com.
3. In Mina's `.env`, set `HTTPSMS_BASE_URL=https://your-server`.

Heavier (DB + domain + TLS). Reserve it for when you refuse any third-party service.

---

## 3. Incoming SMS (important)

Mina receives incoming SMS via **webhook**: the httpSMS server calls Mina back for every SMS
received. Mina's receiving server listens **locally (loopback)**, on `HTTPSMS_WEBHOOK_PORT`
(8787 by default).

- **Sending SMS**: works as soon as the 4 variables are set.
- **Receiving SMS**: the cloud webhook must be able to **reach your PC**. You therefore need to
  expose the local port through a **tunnel** (`cloudflared`, `ngrok`, …) and declare that public
  URL as the webhook target on the httpSMS side. Without that tunnel, Mina **sends** but never
  **sees** the replies.

Every received webhook is **signature-verified** (the `HTTPSMS_WEBHOOK_SECRET`) before being
processed: an unsigned call is rejected.

---

## 4. Environment variables

In your `.env` (never committed):

```bash
# The first 4 enable httpSMS (all 4 required together).
HTTPSMS_BASE_URL=https://api.httpsms.com   # or your self-hosted server URL
HTTPSMS_API_KEY=<API key from the httpSMS dashboard>
HTTPSMS_WEBHOOK_SECRET=<webhook signing secret>
HTTPSMS_FROM_NUMBER=+2135XXXXXXXX          # the SIM number of the gateway phone

# SMS routing behavior:
#   native-first  → native SMS first, httpSMS as fallback (recommended default)
#   httpsms-first → httpSMS first, native as fallback
#   native-only   → never httpSMS
#   httpsms-only  → always httpSMS
HTTPSMS_SMS_MODE=native-first

# Local port of the webhook receiver (loopback).
HTTPSMS_WEBHOOK_PORT=8787
```

As long as one of the first 4 is missing, httpSMS stays **disabled** and Mina uses native SMS
only — without ever claiming otherwise.

The sending guardrails (confirmation, allowlist, quotas, quiet hours) apply **to native and
httpSMS alike** — see `SMS_SEND_MODE`, `SMS_ALLOWLIST`, `SMS_MAX_PER_DAY`,
`SMS_MAX_PER_MINUTE`, `SMS_QUIET_HOURS_*` in `.env.example`.

---

## 5. Security

- **Sending an SMS remains a real-effect action**: Mina requires a local confirmation (or an
  allowlisted number) before sending, whether native or via httpSMS.
- The API key and the webhook secret are **secrets**: they live in `.env` (gitignored), are
  never committed, never displayed in the clear.
- An incoming webhook is **rejected** unless it is correctly signed.

---

## 6. Verify it works

1. Set the 4 variables, restart Mina.
2. The status tab must show the httpSMS SMS channel as **available** (not "degraded"/
   "unavailable" with a reason).
3. Ask Mina to send a test SMS to your own number, confirm locally, and check reception on the
   phone.
4. To test inbound: send an SMS **to** the gateway number and check that Mina sees it (active
   tunnel required).
