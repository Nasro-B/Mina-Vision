# Mina Usage Analytics and Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Mesurer automatiquement tokens, images, audio, calcul local, latence et coût pour chaque tentative fournisseur, appliquer des budgets avant appel et alimenter la page Analyses IA.

**Architecture:** Les adaptateurs retournent les mesures brutes. Des normaliseurs sans effet convertissent vers `UsageAttempt`. `BudgetGuard` réserve avant l’appel puis règle après. `UsageRepository` est distinct de l’audit et du RAG. Les prix sont versionnés et l’estimation est explicitement séparée du coût facturé.

**Tech Stack:** JavaScript ESM, SQLite chiffré du plan mémoire, Vitest, UI vanilla via contrôleur/IPC étroit.

## Task 1: Freeze the usage schema and provider normalizers

**Files:**
- Create: `src/usage/usage-schema.mjs`
- Create: `src/usage/normalizers/gemini.mjs`
- Create: `src/usage/normalizers/openai-compatible.mjs`
- Create: `src/usage/normalizers/huggingface.mjs`
- Create: `src/usage/normalizers/local.mjs`
- Test: `tests/usage-normalizers.test.mjs`

- [x] Write failing fixture tests for Gemini, OpenRouter, DeepSeek, Modal/HF, LM Studio and local OCR/STT/TTS. Include missing fields, cached tokens, reasoning tokens and interrupted stream.
- [x] Normalize into a frozen object with `attemptId`, session/correlation IDs, provider/model/capability, timestamps, status, units, locality and raw digest.

```js
{
  inputTokens: 120,
  cachedInputTokens: 40,
  outputTokens: 31,
  reasoningTokens: 8,
  inputImages: 1,
  inputAudioSeconds: 0,
  outputAudioSeconds: 0,
  localComputeMs: 0,
  completeness: 'final'
}
```

- [x] Never invent zero for an unavailable measure; store `null` and `completeness: 'partial'`.
- [x] Run `npx vitest run tests/usage-normalizers.test.mjs`; expected green.

Conditional commit: `feat(usage): normalize provider measurements`.

## Task 2: Version pricing and calculate estimates reproducibly

**Files:**
- Create: `src/usage/pricing-registry.mjs`
- Create: `src/usage/cost-calculator.mjs`
- Create: `config/pricing-catalog.json`
- Test: `tests/pricing-registry.test.mjs`
- Test: `tests/cost-calculator.test.mjs`

- [x] Write failing tests for effective date, currency, per-million tokens, image/audio units, unknown model and price revision retention.
- [x] Implement a checked-in catalog containing identifiers and public prices only, each row with `sourceUrl`, `retrievedAt`, `effectiveFrom`, `currency`, `unitPrices`.
- [x] Compute integer micro-units to avoid float drift. Return `costKind: 'provider_reported'|'catalog_estimate'|'unknown'`.
- [x] Local models report `providerCostMicros: 0` and separate energy/compute metrics; do not call local compute “free” in analytics text.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(usage): add versioned pricing calculator`.

## Task 3: Enforce the single global budget guard

**Files:**
- Create: `src/usage/budget-guard.mjs`
- Test: `tests/budget-guard.test.mjs`

- [x] Write failing tests for per-call, session, daily, provider and time budgets; concurrent reservations; release; settle over/under reservation; clock rollover.
- [x] Implement atomic methods `reserve(estimate)`, `settle(id, actual)`, `release(id)`, `snapshot(scope)` against an injected store/clock.
- [x] Deny before provider invocation with structured `budget_exceeded`; never silently switch to a more expensive provider.
- [x] Replace planned `src/models/cost-budget.mjs` references with this port. Skills, voice, research and Computer Use receive `BudgetGuard` by injection.
- [x] Run `npx vitest run tests/budget-guard.test.mjs`; expected green.

Conditional commit: `feat(usage): enforce global inference budgets`.

## Task 4: Record each fallback attempt independently

**Files:**
- Create: `src/usage/usage-collector.mjs`
- Create: `src/providers/routed-provider-invoker.mjs`
- Test: `tests/usage-collector.test.mjs`
- Test: `tests/provider-usage-integration.test.mjs`

- [x] Write a failing scenario cloud A timeout → local B success. Assert two attempts, distinct status/cost/latency and one correlation ID.
- [x] Implement `createRoutedProviderInvoker(...)` and instrument exactly `resolve routes → reserve → invoke one route → record → settle/release → policy-approved fallback`. Store a partial attempt when a stream fails after output.
- [x] ProviderRegistry must return provider/model actually used, not only the requested candidate.
- [x] Ensure telemetry failure does not lose the provider result but emits a durable `usage_record_pending`; background retry must be idempotent by `attemptId`.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(usage): collect every provider attempt`.

## Task 5: Persist and query analytics separately from audit and memory

**Files:**
- Create: `src/usage/usage-repository.mjs`
- Create: `src/usage/analytics-query.mjs`
- Create: `src/usage/migrations/001-usage.sql`
- Test: `tests/usage-repository.test.mjs`
- Test: `tests/analytics-query.test.mjs`

- [x] Write failing migration/repository tests using a temporary encrypted database fixture.
- [x] Persist no prompts, responses, file contents, SMS/email bodies or face data. Keep only identifiers, measures, status, error category and redacted route metadata.
- [x] Implement filters by period/provider/model/capability/channel/locality/status and aggregates totals, p50/p95 latency, success rate, fallback rate and budget consumption.
- [x] Verify re-running migration and `recordAttempt` is idempotent.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(analytics): persist privacy-safe usage metrics`.

## Task 6: Expose analytics IPC and export

**Files:**
- Create: `src/ui/pages/analytics-controller.mjs`
- Create: `src/ui/ipc/analytics-ipc.mjs`
- Test: `tests/analytics-controller.test.mjs`
- Test: `tests/analytics-ipc.test.mjs`

- [x] Write failing tests for query validation, maximum period, pagination, budgets and CSV/JSON export redaction.
- [x] Implement `query`, `budgetSnapshot`, `export`. Export requires local confirmation and writes only to a user-selected path through an injected writer.
- [x] Register only `mina:analytics:query`, `mina:analytics:budgets`, `mina:analytics:export`.
- [x] Return chart-ready series but no renderer HTML. DOM wiring is deferred to integration.
- [x] Run targeted tests; expected green.

Conditional commit: `feat(analytics): expose analysis page contracts`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
rg "cost-budget|prompt|response|messageBody" src/usage tests -g '*.mjs' -g '*.sql'
```

Expected: suites exit `0`; `cost-budget` absent; any content-field hit exists only in a negative test proving it is rejected.
