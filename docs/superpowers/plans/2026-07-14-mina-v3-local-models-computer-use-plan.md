# Mina Local Models, OCR, and Computer Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Rendre texte, embeddings, OCR, vision et Computer Use disponibles localement, avec LM Studio comme serveur OpenAI-compatible et des runtimes spécialisés HF strictement catalogués.

**Architecture:** `ModelRegistry` décrit les modèles installés et leur rôle. `LocalRuntimeSupervisor` sonde/démarre uniquement les runtimes déclarés. Les adaptateurs locaux implémentent les mêmes ports que les fournisseurs cloud. Le navigateur enrichit ses observations avec DOM/accessibilité/code lisible ; les fichiers passent par des lecteurs bornés et le `CapabilityBroker`.

**Tech Stack:** LM Studio HTTP local, `@huggingface/transformers` chargé dynamiquement, Playwright existant, ONNX/Transformers.js selon compatibilité modèle, JavaScript ESM, Vitest.

## Task 1: Build the canonical model catalog

**Files:**
- Create: `src/models/model-registry.mjs`
- Create: `src/models/model-manifest.mjs`
- Test: `tests/model-registry.test.mjs`

- [x] Write failing tests for unique IDs, role validation, local path confinement, license metadata, checksum requirement and state transitions `missing|installed|loaded|failed`.
- [x] Implement `createModelRegistry({ workspaceRoot, manifests, clock })` with `list`, `resolve(role, constraints)`, `markInstalled`, `markLoaded`, `markFailed`.
- [x] Support roles `text`, `reasoning`, `embedding`, `ocr`, `vision`, `stt`, `tts`, `computer-use`, `face-detection`, `face-recognition`.
- [x] Reject a local manifest without `source`, `revision`, `sha256`, `license`, `estimatedRamMb`, `runtime`.
- [x] Run `npx vitest run tests/model-registry.test.mjs`; expected green.

Conditional commit: `feat(models): add canonical model registry`.

## Task 2: Supervise LM Studio and specialized local runtimes

**Files:**
- Create: `src/runtime/local-runtime-supervisor.mjs`
- Create: `src/providers/lm-studio.mjs`
- Test: `tests/local-runtime-supervisor.test.mjs`
- Test: `tests/lm-studio-provider.test.mjs`

- [x] Write failing tests for closed port, health timeout, wrong model, process already running, bounded shutdown and no auto-launch when disabled.
- [x] Implement supervisor methods `probe`, `ensureAvailable`, `status`, `stopOwned`. Never kill a process it did not start.
- [x] Implement LM Studio against `/v1/models` and `/v1/chat/completions`, default `http://127.0.0.1:1234/v1`; inject `fetch` for tests.
- [x] Return standardized provider results including actual model and token usage. A connection refusal marks only that route unhealthy and allows policy-approved fallback.
- [x] Test that `local-only` returns `local_runtime_unavailable`, never a cloud route.
- [x] Run both targeted test files; expected green without LM Studio running.

Conditional commit: `feat(local): add lm studio runtime adapter`.

## Task 3: Install HF artifacts only through a quarantined model service

**Files:**
- Create: `src/models/model-installer.mjs`
- Create: `src/models/model-loader.mjs`
- Test: `tests/model-installer.test.mjs`
- Test: `tests/model-loader.test.mjs`

- [x] Write failing tests using local fixture archives for checksum mismatch, path traversal, missing license, interrupted download and atomic promotion.
- [x] Implement download through an injected client into `<userData>/models/.quarantine/<jobId>`; verify revision, declared files and SHA-256 before rename to `<userData>/models/<modelId>`.
- [x] Default network off. Download requires an explicit local request and the `models.install` capability. Never execute repository code or trust `trust_remote_code`.
- [x] Load `@huggingface/transformers` dynamically only when a specialized model is invoked.
- [x] Enforce one heavy model loaded at a time on the target 16 GB RAM PC; unload on pressure and expose `estimatedRamMb`.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(models): quarantine local model installation`.

## Task 4: Provide local embedding, OCR, and vision ports

**Files:**
- Create: `src/providers/local-embedding.mjs`
- Create: `src/providers/local-ocr.mjs`
- Create: `src/providers/local-vision.mjs`
- Test: `tests/local-embedding.test.mjs`
- Test: `tests/local-ocr.test.mjs`
- Test: `tests/local-vision.test.mjs`

- [x] Write contract tests with injected pipelines. Embeddings must be deterministic dimensions; OCR must return text plus boxes/confidence; vision must return claims plus uncertainty, never a raw success string.
- [x] Use `ModelRegistry.resolve(role)` in every adapter. No model ID may be hardcoded in the RAG or dental pipeline.

```js
{
  text: 'Recette gâteau au chocolat',
  blocks: [{ text: 'Recette', box: [12, 8, 82, 31], confidence: 0.97 }],
  modelId: 'local-ocr',
  usage: { inputImages: 1, localComputeMs: 41 }
}
```

- [x] Preserve `createDentalVision().classify()` as a compatibility facade routed by capability `vision.classify`.
- [x] Add a lexical RAG fallback when no embedding model is installed; never download implicitly during recall.
- [x] Run the three targeted test files; expected green.

Conditional commit: `feat(vision): add local embedding ocr and vision ports`.

## Task 5: Read page structure and source without relying on camera vision

**Files:**
- Create: `src/perception/web-observer.mjs`
- Modify: `src/executors/browser-executor.mjs`
- Test: `tests/web-observer.test.mjs`
- Test: `tests/browser-observation.test.mjs`

- [x] Write a Playwright fixture page containing shadow-free DOM, ARIA names, form controls, scripts, styles and hidden secrets.
- [x] Implement a bounded observation containing URL, title, accessibility snapshot, visible text, interactive elements and sanitized DOM. Cap each section and mark truncation.
- [x] Never return cookies, localStorage, sessionStorage, authorization headers, password values or hidden inputs to a model.
- [x] Add explicit operations `inspect_dom`, `inspect_accessibility`, `read_visible_text`, `get_page_source`. `get_page_source` requires `web.source.read` and redaction before any cloud route.
- [x] Preserve screenshot observation for visual tasks and fuse it with structured page evidence.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(browser): expose structured page observations`.

## Task 6: Read accessible PC files through bounded readers

**Files:**
- Create: `src/files/file-reader-registry.mjs`
- Create: `src/files/text-reader.mjs`
- Create: `src/files/document-reader.mjs`
- Create: `src/files/file-read-policy.mjs`
- Test: `tests/file-reader-registry.test.mjs`
- Test: `tests/file-read-policy.test.mjs`

- [x] Write failing tests for text, binary rejection, symlink/junction escape, file-size limit, encoding, extension allowlist, redaction and cancellation.
- [x] Implement `read({ path, purpose, maxBytes, signal })` after `CapabilityBroker` authorization `files.read`. Resolve the final real path before policy evaluation.
- [x] Treat “tous les fichiers accessibles” as user-authorized scope, not automatic ingestion: every mission resolves an explicit path/resource; protected OS credential stores and browser profiles remain denied.
- [x] Load heavy PDF/Office readers dynamically and return chunks with source offsets and digests for grounding.
- [x] Ensure no reader writes, executes macros or follows network links.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(files): add bounded grounded file readers`.

## Task 7: Route local Computer Use through the existing orchestrator

**Files:**
- Create: `src/providers/local-computer-use.mjs`
- Create: `src/providers/routed-computer-use.mjs`
- Modify: `src/core/orchestrator.mjs`
- Test: `tests/local-computer-use.test.mjs`
- Test: `tests/routed-computer-use.test.mjs`
- Test: `tests/integration/local-computer-use.test.mjs`

- [x] Write contract tests proving both adapters implement `start({ goal, environment, observation })` and `continue({ interactionId, call, actionResult, observation, environment })`.
- [x] Local output must be parsed into the same action vocabulary consumed by `normalizeAction()`. Reject prose, unknown operations, coordinates outside bounds and missing expected effects.
- [x] Keep all mouse, keyboard, URL entry, download and print operations in existing executors/policies. Do not create a second action loop.
- [x] Add `createRoutedComputerUse({ capabilityRouter, providerRegistry })` that pins one interaction to its chosen provider unless failure policy explicitly creates a new interaction.
- [x] Integration fixture: “ouvre la page locale et cherche recette gâteau”; verify navigation, text entry, evidence readback and no network/cloud in `local-only`.
- [x] Display a non-interactive Mina virtual cursor during preview/confirmation/execution, then hide it before post-action evidence capture.
- [x] Run targeted and integration tests; expected green.

Conditional commit: `feat(computer-use): route local planning through existing loop`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
```

Expected: exit `0`; tests use fixtures/fake pipelines and do not download models. Manual opt-in smoke when LM Studio is running:

```powershell
Invoke-RestMethod http://127.0.0.1:1234/v1/models
```

Expected: a model list. If the port is closed or no model is installed, record `local_runtime_unavailable`; do not mark the implementation failed.
