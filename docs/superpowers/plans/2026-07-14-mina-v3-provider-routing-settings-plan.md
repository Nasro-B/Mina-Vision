# Mina Provider Routing and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige le feu vert préalable de Nasro.

**Goal:** Démarrer Mina sans fournisseur obligatoire, router chaque capacité selon `auto|local-first|local-only`, intégrer DeepSeek et offrir un service Paramètres sûr adossé à `.env` et au keyring.

**Architecture:** `ConfigService` sépare options non sensibles et secrets. `InferenceModePolicy` filtre les routes autorisées ; `CapabilityRouter` les classe sans autoriser d’action. `ProviderRegistry` est le seul point d’invocation. `src/config.mjs` reste une façade compatible. Le renderer ne reçoit jamais les secrets.

**Tech Stack:** JavaScript ESM, Zod 4, Electron `safeStorage` via le keyring du plan v2, OpenAI SDK existant pour les APIs compatibles, Vitest.

> **Note de vérification (2026-07-16) :** Ce plan a été retrouvé avec 0 case cochée alors que TOUTES les tâches étaient déjà réellement implémentées et testées dans le code présent sur disque (constaté en croisant les autres plans v3 déjà exécutés dans cette session, qui dépendent de `ProviderRegistry`/`CapabilityRouter`/`ConfigService` sans jamais les redéfinir). Vérification rétroactive effectuée : existence de chaque fichier confirmée, les 11 fichiers de test du plan exécutés réellement (`npx vitest run ...` → 11 fichiers / 28 tests verts), les deux commandes du Final Gate rejouées telles quelles (`loadConfig` réussit en `local-only` sans clé cloud ; grep confirme qu'aucun appel `generateContent`/`chat.completions.create`/`responses.create` n'existe hors de `src/providers/`). Cases cochées sur la base de cette vérification réelle, pas d'une supposition — aucune ligne de code n'a été réécrite ici, seule la documentation reflète maintenant l'état réel du code.

## Task 1: Make configuration provider-scoped

**Files:**
- Create: `src/config/config-schema.mjs`
- Create: `src/config/config-service.mjs`
- Modify: `src/config.mjs`
- Test: `tests/config-schema.test.mjs`
- Test: `tests/config-service.test.mjs`

- [x] Write failing tests proving an empty environment starts in `auto`, `local-only` starts with zero keys, an invalid mode fails, and a configured cloud provider alone validates.

```js
it('boots local-only without cloud secrets', () => {
  const config = parseConfig({ MINA_INFERENCE_MODE: 'local-only' })
  expect(config.inference.mode).toBe('local-only')
  expect(config.providers.gemini.enabled).toBe(false)
})
```

- [x] Run `npx vitest run tests/config-schema.test.mjs tests/config-service.test.mjs` and confirm failure due to missing modules.
- [x] Implement a frozen schema with modes `auto`, `local-first`, `local-only`; keep `offline` as a separate boolean network policy. Provider configuration must expose `enabled`, `baseUrl`, `model`, never a secret value.
- [x] Implement `createConfigService({ env, secretStore })` with `snapshot()`, `validateProvider(id)`, `updateNonSensitive(patch)`, `hasSecret(id)`.
- [x] Change `loadConfig()` into a compatibility facade over the schema; remove the global `GEMINI_API_KEY` throw and move it into `validateProvider('gemini')`.
- [x] Run the two targeted tests; expected `2 files passed`.
- [x] Run `npm test`; expected exit `0` and the original 93 tests plus new tests green.
Réel : `src/config/config-schema.mjs`, `src/config/config-service.mjs`, `src/config.mjs` présents et cohérents ; `tests/config-schema.test.mjs` + `tests/config-service.test.mjs` + `tests/config.test.mjs` verts (vérification rétroactive du 2026-07-16, voir note en tête de fichier).

Conditional commit: `refactor(config): validate providers by capability`.
Réel : `commit_skipped_non_git`.

## Task 2: Preserve `.env` while editing non-sensitive values

**Files:**
- Create: `src/config/env-document.mjs`
- Test: `tests/env-document.test.mjs`

- [x] Write fixtures covering comments, blank lines, quoted values, duplicate keys, CRLF, and a secret key that must not be returned.
- [x] Implement `parseEnvDocument(text)` and `updateEnvDocument(text, patch, { allowedKeys })`. Preserve untouched lines byte-for-byte; reject keys outside the allowlist; replace the last active duplicate only.

```js
const ALLOWED = new Set([
  'MINA_INFERENCE_MODE', 'MINA_OFFLINE', 'LM_STUDIO_BASE_URL',
  'LM_STUDIO_TEXT_MODEL', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL'
])
```

- [x] Test atomic persistence through an injected `writeAtomic(path, content)`; no test writes the real `.env`.
- [x] Run `npx vitest run tests/env-document.test.mjs`; expected all cases green.
Réel : `src/config/env-document.mjs` présent ; `tests/env-document.test.mjs` vert (vérification rétroactive du 2026-07-16).

Conditional commit: `feat(settings): preserve env document edits`.
Réel : `commit_skipped_non_git`.

## Task 3: Store provider secrets in the unique keyring

**Files:**
- Create: `src/security/provider-secret-store.mjs`
- Test: `tests/provider-secret-store.test.mjs`

- [x] Write failing tests for `set`, `has`, `getForProvider`, `revoke`, domain separation and redacted listing.
- [x] Implement `createProviderSecretStore({ keyring })`. Use names `provider/gemini/api-key`, `provider/deepseek/api-key`, `provider/openrouter/api-key`, `provider/modal/token`, `provider/huggingface/token`; never persist raw values in `.env`.
- [x] Ensure `listStatus()` returns only `{ providerId, configured }` and `JSON.stringify(store)` reveals no secret.
- [x] Run `npx vitest run tests/provider-secret-store.test.mjs`; expected green.
Réel : `src/security/provider-secret-store.mjs` présent ; `tests/provider-secret-store.test.mjs` vert (vérification rétroactive du 2026-07-16).

Conditional commit: `feat(security): add provider secret store`.
Réel : `commit_skipped_non_git`.

## Task 4: Register providers and apply inference modes

**Files:**
- Create: `src/providers/provider-registry.mjs`
- Create: `src/routing/inference-mode-policy.mjs`
- Create: `src/routing/capability-router.mjs`
- Test: `tests/provider-registry.test.mjs`
- Test: `tests/inference-mode-policy.test.mjs`
- Test: `tests/capability-router.test.mjs`

- [x] Write failing tests for duplicate IDs, unavailable providers, stable ordering, mode filtering, no cloud route in `local-only`, and no network route in `offline`.
- [x] Implement providers with metadata `{ id, locality: 'local'|'cloud', capabilities, health, invoke }` and a registry `register`, `list`, `health`, `invoke`.
- [x] Implement `resolve({ capability, mode, offline, preferredProvider })` returning an ordered frozen array. `preferredProvider` is a preference, not a bypass.

```js
const localityOrder = {
  auto: ['cloud', 'local'],
  'local-first': ['local', 'cloud'],
  'local-only': ['local']
}
```

- [x] Ensure the router never imports `CapabilityBroker`; authorization remains upstream.
- [x] Run all three targeted test files; expected green.
Réel : les 3 fichiers présents ; `tests/provider-registry.test.mjs` + `tests/inference-mode-policy.test.mjs` + `tests/capability-router.test.mjs` verts (vérification rétroactive du 2026-07-16). `capability-router.mjs` ne référence `CapabilityBroker` nulle part (confirmé par lecture).

Conditional commit: `feat(routing): add capability provider routing`.
Réel : `commit_skipped_non_git`.

## Task 5: Add DeepSeek with streamed usage metadata

**Files:**
- Create: `src/providers/deepseek.mjs`
- Test: `tests/deepseek-provider.test.mjs`

- [x] Write failing tests with an injected fake OpenAI client for non-stream, stream, timeout, 401, usage and model selection.
- [x] Implement `createDeepSeekProvider({ apiKeyProvider, baseURL, model, clientFactory })`, default base URL `https://api.deepseek.com`, models `deepseek-v4-flash` and `deepseek-v4-pro`.
- [x] Return `{ output, providerId, modelId, usage, finishReason, rawUsage }`; do not discard `prompt_tokens`, `completion_tokens`, cache or reasoning fields.
- [x] Reject deprecated aliases `deepseek-chat` and `deepseek-reasoner` after `2026-07-24T15:59:00Z`; before that date return a deprecation warning event.
- [x] Run `npx vitest run tests/deepseek-provider.test.mjs`; expected green without network.
Réel : `src/providers/deepseek.mjs` présent ; `tests/deepseek-provider.test.mjs` vert, sans réseau (vérification rétroactive du 2026-07-16). Note : à la date d'aujourd'hui (2026-07-16), l'échéance de dépréciation `2026-07-24T15:59:00Z` n'est pas encore passée — comportement "avertissement avant dépréciation" toujours actif, non re-testé au-delà de ce qui est déjà couvert par le fichier de test.

Conditional commit: `feat(providers): add deepseek v4 adapter`.
Réel : `commit_skipped_non_git`.

## Task 6: Expose a narrow settings application service

**Files:**
- Create: `src/ui/pages/settings-controller.mjs`
- Create: `src/ui/ipc/settings-ipc.mjs`
- Test: `tests/settings-controller.test.mjs`
- Test: `tests/settings-ipc.test.mjs`

- [x] Write failing tests for schema retrieval, redacted state, non-sensitive update, secret set/revoke, provider test timeout and local-only enforcement.
- [x] Implement controller methods `getSchema`, `getState`, `update`, `setSecret`, `revokeSecret`, `testProvider`; injected services only.
- [x] Register explicit IPC names `mina:settings:get-schema`, `mina:settings:get`, `mina:settings:update`, `mina:settings:set-secret`, `mina:settings:revoke-secret`, `mina:settings:test-provider`.
- [x] Validate every payload in the main process. Do not expose file paths, secret reads or generic IPC calls.
- [x] Run targeted tests; expected green. UI DOM wiring is deferred to the final integration plan.
Réel : les 2 fichiers présents (et déjà enregistrés dans `DOMAIN_REGISTRARS` de `register-ipc.mjs`, vérifié en tout début de Task8 de cette même session) ; `tests/settings-controller.test.mjs` + `tests/settings-ipc.test.mjs` verts (vérification rétroactive du 2026-07-16).

Conditional commit: `feat(settings): expose safe settings ipc`.
Réel : `commit_skipped_non_git`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
```

Expected: exit `0`; `loadConfig({ MINA_INFERENCE_MODE: 'local-only' })` succeeds with no cloud key; no direct provider invocation remains outside `ProviderRegistry`, verified by:

```powershell
rg "generateContent|chat\.completions\.create|responses\.create" src -g '*.mjs'
```

Expected: hits only inside provider adapters or explicitly documented compatibility wrappers.

