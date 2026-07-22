# Mina v3 Implementation Plan

> **Extension approuvée :** après les gates v3, poursuivre avec [Mina v4 Extensions Implementation Plan](2026-07-14-mina-v4-master-plan.md) pour mode ombre, automatisations, organisation personnelle, documents/urgence, approbations Samsung, connecteurs privés et personnalité.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Dans ce projet, `subagent-driven-development` exige d’abord l’autorisation explicite de Nasro, l’annonce du nombre d’agents et de leur rôle, puis son feu vert.

**Goal:** Achever Mina comme agent multimodal local/cloud, omnicanal et domotique, sans dupliquer les frontières de sécurité déjà définies par les plans v2.

**Architecture:** Electron/Node ESM reste l’autorité PC. `CapabilityBroker` autorise une capacité, puis `CapabilityRouter` choisit un moteur. Tous les appels IA traversent `ProviderRegistry`, `UsageCollector` et l’unique `BudgetGuard`. L’unique application Android Kotlin `fr.mina.gateway` porte SMS, Telegram, CameraX et Google Home ; `PhysicalDeviceRegistry` fusionne ses transports USB/LAN/Firebase. Les domaines ne touchent le composition root et le renderer qu’au plan final.

**Tech Stack:** Node 22, Electron 43, JavaScript ESM, Vitest 4, HTML/CSS/JS vanilla, SQLite chiffré du plan mémoire, Android Kotlin/JVM 17, Gradle 8.13, AGP 8.13.2, compile/target SDK 35, minSdk 29 pour le Huawei Android 10.

## Global Constraints

- Ne jamais rejouer `2026-07-14-mina-agent-implementation.md` : il décrit le socle déjà présent et contient des chemins UI périmés.
- Ne pas exécuter `2026-07-14-mina-v2-android-messaging-plan.md` : il est remplacé par le plan Android Kotlin v3.
- `local-only` interdit l’inférence cloud mais autorise le LAN local ; `offline` coupe tout réseau, y compris Home Assistant et le Huawei Wi-Fi.
- Aucun fournisseur cloud n’est obligatoire au démarrage. Chaque capacité valide ses propres prérequis.
- Un seul coffre : `src/crypto/keyring.mjs`. `ProviderSecretStore` et `FaceProfileStore` en sont des façades à domaines de clés séparés.
- Un seul budget : `src/usage/budget-guard.mjs`. Aucun `src/models/cost-budget.mjs`.
- L’embedder RAG est obtenu via `ModelRegistry`; aucun modèle codé en dur dans le plan mémoire.
- La reconnaissance faciale est un signal de personnalisation/présence, jamais une autorisation ni une confirmation.
- SMS et email entrants n’accordent aucune capacité PC ou domotique. Telegram n’accorde que les capacités explicitement activées `mail.*`, `home.read` et `home.low_risk`.
- Une action physique n’est réussie qu’après relecture de l’état attendu. Un ACK HTTP, MQTT, Android ou modèle ne suffit pas.
- Aucun secret dans `.env.example`, les journaux, les tests ou Firebase. Firebase ne porte que des enveloppes chiffrées à TTL.
- TDD strict : test rouge ciblé, changement minimal, test vert ciblé, suite complète après chaque tâche.
- Le projet n’est pas un dépôt Git. Ne pas exécuter `git init`, commit, push ou déploiement sans ordre explicite. Les checkpoints de commit des sous-plans sont conditionnels.

## Canonical Contracts

```js
// Autoriser d’abord, router ensuite.
await capabilityBroker.authorize(request)
const routes = capabilityRouter.resolve({ capability, mode, constraints })
for (const route of routes) {
  const reservation = await budgetGuard.reserve(route.estimate)
  try {
    const result = await providerRegistry.invoke(route, input)
    await usageCollector.recordAttempt({ route, result, reservation })
    await budgetGuard.settle(reservation, result.usage)
    return result
  } catch (error) {
    await usageCollector.recordAttempt({ route, error, reservation })
    await budgetGuard.release(reservation)
    if (!route.retryPolicy.allowsFallback(error)) throw error
  }
}
throw new Error('no_route_succeeded')
```

```js
// Une action domotique explicite et idempotente.
{
  operation: 'set_power',
  target: { room: 'salon', name: 'lampe principale' },
  parameters: { value: true },
  idempotencyKey: 'session:event',
  expectedState: { power: 'on' }
}
```

## Mandatory Execution Order

1. Exécuter [noyau, grounding et sessions v2](2026-07-14-mina-v2-core-grounding-sessions-plan.md).
2. Exécuter [mémoire/RAG v2](2026-07-14-mina-v2-memory-research-plan.md) avec l’embedder injecté par `ModelRegistry`, jamais codé en dur.
3. Exécuter [routage fournisseurs et paramètres](2026-07-14-mina-v3-provider-routing-settings-plan.md).
4. Exécuter [modèles locaux, OCR et Computer Use](2026-07-14-mina-v3-local-models-computer-use-plan.md).
5. Exécuter [mesures, coûts et budgets](2026-07-14-mina-v3-usage-analytics-budgets-plan.md).
6. Exécuter [voix locale](2026-07-14-mina-v3-local-voice-plan.md).
7. Exécuter [MINA.md, skills et sandbox v2](2026-07-14-mina-v2-skills-sandbox-plan.md), en remplaçant tout budget propre par `BudgetGuard`.
8. Exécuter [passerelle Android Kotlin et messagerie](2026-07-14-mina-v3-android-kotlin-gateway-plan.md).
9. Exécuter [caméra Huawei et biométrie](2026-07-14-mina-v3-camera-biometrics-plan.md).
10. Exécuter [email](2026-07-14-mina-v3-email-gateway-plan.md).
11. Exécuter [maison connectée](2026-07-14-mina-v3-smart-home-plan.md).
12. Exécuter [intégration finale v3](2026-07-14-mina-v3-integration-launch-plan.md).

Un plan ne démarre que si son gate final est vert. Les plans Android, caméra et maison partagent le même module Gradle et sont donc strictement séquentiels.

## Superseded Decisions

| Ancienne décision | Décision v3 canonique |
|---|---|
| Android Java uniquement, minSdk 23 | Kotlin obligatoire, minSdk 29, car Google Home APIs sont Kotlin/Flow et exigent Android 10+ |
| Telegram conversation/mémoire uniquement | Exceptions bornées après activation locale : `mail.*`, `home.read`, `home.low_risk` |
| Embedder RAG fixe | Port embedding résolu par `ModelRegistry`, fallback lexical local |
| `src/models/cost-budget.mjs` | Supprimé du plan ; `src/usage/budget-guard.mjs` est l’unique autorité |
| `startCamera()` = caméra | Déprécié : il ouvre seulement l’intent photo ; CameraX fournit le vrai flux capteur |

## Milestones

| Jalon | Résultat observable | Gate |
|---|---|---|
| V3-1 | Mina démarre sans clé cloud en `local-only`; Paramètres teste chaque fournisseur | tests config/routage + smoke Electron |
| V3-2 | Texte, vision, OCR et Computer Use local routés dynamiquement | fixtures sans réseau + mission navigateur locale |
| V3-3 | Tokens/coûts/budgets par tentative et page Analyses IA | tests normaliseurs + agrégats déterministes |
| V3-4 | STT/TTS local interruptible depuis le bouton micro | test audio fixture + essai manuel |
| V3-5 | APK Kotlin : SMS, Telegram, USB/LAN/Firebase, CameraX | JVM + lint + assemble + appareil Huawei |
| V3-6 | Email IMAP/SMTP/Gmail et mémoire cross-canal | tests transports simulés + test réel opt-in |
| V3-7 | Google Home découvre/contrôle et relit l’état ; Home Assistant devient prioritaire quand configuré | tests fake adapters + essai lumière réel |
| V3-8 | UI intégrée, arrêt global et redémarrage sans rejeu | suite complète + checklist manuelle |

## Specification Coverage Matrix

| Spécification validée | Plan(s) d’exécution |
|---|---|
| Agent, souris/clavier, lecture page/fichiers | noyau v2, modèles/Computer Use v3, intégration v3 |
| Grounding, anti-hallucination, session start/during/end | noyau v2, intégration v3 tâche 4 |
| Mémoire courte/longue, RAG et rappel intercanal | mémoire/RAG v2 + embedder `ModelRegistry` v3 |
| `MINA.md`, skills validés, sandbox isolée | skills/sandbox v2 + `BudgetGuard` v3 |
| Modèles cloud/local, HF, DeepSeek, modes dynamiques | routage/paramètres v3 + modèles locaux v3 |
| Tokens, coûts, durée et page Analyses IA | usage/analytics/budgets v3 |
| Voix locale et bouton micro | voix locale v3 + intégration UI v3 |
| Huawei USB/Wi‑Fi, SMS, Telegram, Firebase | passerelle Android Kotlin v3 |
| CameraX, fusion vision/écran, reconnaissance de Nasro | caméra/biométrie v3 |
| Gmail, Microsoft, IMAP/SMTP et trois modes | email v3 |
| Google Home, Home Assistant/Matter, MQTT et risques | maison connectée v3 |
| Pages Paramètres, Analyses, Caméra, Email, Maison | intégration v3 |

## Global Verification Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
```

Expected: exit code `0`; aucun test critique ignoré. Après création du module Android :

```powershell
Set-Location 'C:\Serveurs\Mina Vision\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: `BUILD SUCCESSFUL`. Les essais avec clés/API/appareils réels sont opt-in et documentent précisément les prérequis manquants.

## Conditional Commit Checkpoint

À la fin de chaque tâche, exécuter d’abord :

```powershell
git rev-parse --is-inside-work-tree
```

Expected aujourd’hui: échec `not a git repository`; aucun commit. Si Nasro a depuis initialisé Git et autorisé les commits, utiliser uniquement le message Conventional Commit indiqué dans le sous-plan. Aucun push.
