> 🇬🇧 **English** · [🇫🇷 Français](lm-studio.fr.md)

# Local models with LM Studio

Mina Vision can run with **100% local** AI models, without any cloud key, via
[LM Studio](https://lmstudio.ai). It is optional: Mina starts without it, and
falls back to the cloud (Gemini, DeepSeek, …) when local is absent.

Three uses, each optional and independent:
- **text** (conversation, reasoning);
- **vision** (analyzing images/screenshots);
- **embeddings** (semantic memory — search by meaning, not just by words).

---

## 1. Install and start LM Studio

1. Install LM Studio, download a model (text, and/or vision, and/or embeddings).
2. In LM Studio → **Local Server** tab → **Start**. By default it listens on
   `http://127.0.0.1:1234`.
3. Load the desired model(s) into the server.

> Mina only accepts a server on **local loopback** (`127.0.0.1`/`localhost`) over
> **HTTP**: the whole point is running everything on your machine, never exposed
> to the network.

---

## 2. Environment variables

In your `.env` (see also `.env.example`):

```bash
# Enables local model discovery (true by default).
LM_STUDIO_ENABLED=true

# LM Studio local server URL (loopback + HTTP required).
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1

# Names of the models loaded in LM Studio (leave empty = that use disabled).
LM_STUDIO_TEXT_MODEL=
LM_STUDIO_VISION_MODEL=
LM_STUDIO_EMBEDDING_MODEL=

# Max duration of a local request (ms). Default 240000 (4 min) — a large model
# on CPU can be slow.
LM_STUDIO_TIMEOUT_MS=240000
```

Each model field is independent: fill in only the ones you use. The name must
match **exactly** the model identifier shown by the LM Studio server.

---

## 3. Choosing local or cloud

The global inference variable decides the priority:

```bash
# auto        → local when available, otherwise cloud (default)
# local-first → local first, cloud only as fallback
# local-only  → never cloud (100% offline for AI)
MINA_INFERENCE_MODE=auto

# Cuts ALL AI network calls, whatever the mode above.
MINA_OFFLINE=false
```

For fully local, private operation: `MINA_INFERENCE_MODE=local-only` with the
LM Studio models configured.

---

## 4. Verify

1. LM Studio running, model(s) loaded, server started.
2. Variables set, Mina restarted.
3. **Config → Capabilities** must show the local inference domain as
   **available**. If it stays "unavailable" or "degraded", the exact reason is
   displayed (server unreachable, model not found, timeout) — never an
   optimistic state.
