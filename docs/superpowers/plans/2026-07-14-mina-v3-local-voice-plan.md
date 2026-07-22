# Mina Local Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Fournir écoute, transcription et synthèse locales interruptibles, tout en conservant Gemini Live comme adaptateur cloud facultatif et le bouton micro actuel comme unique point d’entrée UI.

**Architecture:** `VoiceOrchestrator` pilote une `VoiceSession`, normalise le PCM, choisit STT/TTS via `CapabilityRouter` et diffuse des événements. Les wake phrases existantes déclenchent Mina mais ne constituent jamais une confirmation sensible. Tous les flux sont bornés et annulables.

**Tech Stack:** Node ESM, Web Audio/MediaRecorder côté renderer existant, modèles locaux résolus par `ModelRegistry`, Gemini Live facultatif, Vitest avec fixtures WAV.

## Task 1: Normalize and bound audio input

**Files:**
- Create: `src/voice/audio-normalizer.mjs`
- Create: `tests/fixtures/audio/mina-16k-mono.wav`
- Test: `tests/audio-normalizer.test.mjs`

- [x] Write failing tests for WAV parsing, mono conversion, 16 kHz resampling, maximum duration, silence and malformed input.
- [x] Implement `normalizeAudio({ bytes, mimeType, maxSeconds })` returning signed PCM16 mono, sample rate, duration and digest. Reject input over the bound before allocating a second full copy.
- [x] Run `npx vitest run tests/audio-normalizer.test.mjs`; expected green.

Conditional commit: `feat(voice): normalize bounded audio input`.

## Task 2: Define interchangeable STT and TTS providers

**Files:**
- Create: `src/voice/stt-provider.mjs`
- Create: `src/voice/tts-provider.mjs`
- Create: `src/providers/local-stt.mjs`
- Create: `src/providers/local-tts.mjs`
- Test: `tests/voice-provider-contract.test.mjs`

- [x] Write contract tests for `transcribe({ audio, language, signal })` and `synthesize({ text, voice, format, signal })`; include cancellation and partial output.
- [x] Resolve models by roles `stt` and `tts`; load heavy runtimes dynamically. Return actual model, latency, audio seconds and completeness for usage analytics.
- [x] Keep language `fr` default with auto-detection opt-in. Reject arbitrary local model code.
- [x] Run the contract test; expected green with fake pipelines.

Conditional commit: `feat(voice): add local stt and tts ports`.

## Task 3: Create session lifecycle and interruption semantics

**Files:**
- Create: `src/voice/voice-session.mjs`
- Create: `src/voice/voice-orchestrator.mjs`
- Modify: `src/voice/wake-phrases.mjs`
- Test: `tests/voice-session.test.mjs`
- Test: `tests/voice-orchestrator.test.mjs`

- [x] Write failing tests for `idle → listening → transcribing → thinking → speaking → idle`, double start, stop at every state, timeout and barge-in.
- [x] Implement activation phrases exactly: `Salut Mina`, `Bonjour Mina`, `Mina comment ça va`, accent/case/punctuation tolerant.
- [x] Wake phrase opens a session only. Sensitive actions still require `CapabilityBroker` confirmation bound to a digest.
- [x] Route STT/TTS independently, so local STT may pair with cloud text or local TTS according to mode.
- [x] Emit `session_start`, incremental transcript, `session_end` and failure reasons; never store raw audio in long-term memory by default.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(voice): orchestrate interruptible voice sessions`.

## Task 4: Adapt Gemini Live to the common voice contract

**Files:**
- Modify: `src/providers/gemini-live.mjs`
- Test: `tests/gemini-live-contract.test.mjs`

- [x] Write failing tests proving Gemini Live conforms to the session contract and returns final/partial usage metadata.
- [x] Preserve current behavior behind an adapter; remove any assumption that it is the central voice engine.
- [x] Ensure `local-only` never constructs the Gemini client and `offline` rejects it before network.
- [x] Run targeted test; expected green without a real API call.

Conditional commit: `refactor(voice): adapt gemini live to voice contract`.

## Task 5: Expose narrow voice IPC without a second microphone UI

**Files:**
- Create: `src/ui/ipc/voice-ipc.mjs`
- Modify: `src/ui/controller.mjs`
- Test: `tests/voice-ipc.test.mjs`

- [x] Write failing tests for start, chunks, stop, stale session ID, oversized chunk and emergency cancellation.
- [x] Reuse `mina:voice-start`, `mina:voice-stop`, `mina:voice-input` and existing voice events; add no generic stream channel.
- [x] Ensure renderer capture is active only after an explicit button/wake action and displays the active STT/TTS/model mode.
- [x] Keep DOM modifications for the final integration plan.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(voice): harden voice ipc session flow`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
```

Expected: exit `0`. Manual opt-in: click the existing microphone, say “Salut Mina”, interrupt Mina while speaking, then confirm the UI returns to `idle` and no raw WAV appears under user data.
