# Mina v2 — plan directeur d’implémentation

> **Statut : supersédé pour l’ordre global par [Mina v3 Implementation Plan](2026-07-14-mina-v3-master-plan.md).** Les plans noyau, mémoire et skills restent utilisables aux emplacements indiqués par v3. Le plan Android v2 Java ne doit pas être exécuté.

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans` tâche par tâche. `superpowers:subagent-driven-development` n’est utilisable qu’après autorisation explicite de Nasro, annonce du nombre d’agents et du rôle de chacun, puis feu vert. Ne jamais pousser ni déployer automatiquement.

**Objectif :** faire évoluer l’application Electron existante en agent Mina local unifié : réponses fondées sur des preuves, sessions explicites, mémoire chiffrée/RAG, lecture web et fichiers, skills validés, exécution isolée, SMS/Telegram via le Huawei et Firebase uniquement comme secours chiffré.

**Architecture :** le processus principal Electron reste l’unique autorité du PC. Il héberge un noyau à ports/adaptateurs (`sessions`, `grounding`, `memory`, `research`, `skills`, `sandbox`, `messaging`) et expose au renderer un IPC étroit. L’application Android `fr.mina.gateway` est la seule consommatrice Telegram et la seule lectrice/émettrice SMS. Les transports USB, LAN et Firebase portent des enveloppes authentifiées et chiffrées ; ils n’accordent jamais de permission.

**Socle vérifié le 14 juillet 2026 :** Node 22.14.0, npm 10.9.2, Electron 43.1.0, Vitest 4.1.10, Java 17, Android SDK 34/35, Build Tools 34/35, ADB 37.0.0. Baseline : `19` fichiers, `93` tests réussis. Le projet n’est pas un dépôt Git.

## Contraintes globales

- Source de vérité des instructions : `C:\Serveurs\Mina Vision\MINA.md`.
- Stockage applicatif : `app.getPath('userData')`; aucun secret dans le dépôt ni dans `.env.example`.
- Mémoire locale chiffrée par enregistrement ; clé maître enveloppée par Electron `safeStorage` (DPAPI sous Windows) et par une phrase de récupération de 12 mots.
- Les OTP et secrets peuvent être mémorisés parce que Nasro l’a explicitement choisi, mais ne sont jamais injectés dans un modèle distant sans confirmation dédiée.
- Le résultat d’un modèle n’est jamais une preuve. Une action n’est « terminée » qu’après observation de son effet.
- SMS : aucun outil PC, aucun skill, aucune exécution de code.
- Telegram : conversation et mémoire ; exceptions v3 bornées et activées localement pour `mail.*`, `home.read` et `home.low_risk`. Outils PC, fichiers arbitraires, skills d’action et sandbox restent bloqués.
- Sandbox : invocation locale explicite, Windows Sandbox obligatoire, réseau/presse-papiers/imprimante/caméra/micro/vGPU coupés, aucun fallback hôte.
- Firebase : transport de secours éphémère (TTL maximal 24 h) et sauvegarde chiffrée ; jamais source de vérité en clair.
- Le fork `httpsms` AGPL et `open-interpreter` servent uniquement de références conceptuelles. Aucun code AGPL ne doit être copié.
- TDD strict : test rouge ciblé, changement minimal, test vert ciblé, suite complète.
- Aucun `git init`, commit, push ou déploiement sans ordre distinct. Si Git est initialisé plus tard, utiliser `type(scope): message`.

## Dépendances figées pour l’exécution

### Bureau Node/Electron

- Runtime : `better-sqlite3@12.11.1`, `argon2@0.44.0`, `@huggingface/transformers@4.2.0`, `zod@4.4.3`, `yaml@2.9.0`, `firebase@12.16.0`.
- Développement : `@electron/rebuild@4.2.0`, `@vitest/coverage-v8@4.1.10`, `fast-check@4.9.0`.
- `better-sqlite3` doit être reconstruit pour Electron via `electron-rebuild -f -w better-sqlite3`; aucun chargement natif avant le test de compatibilité.
- Les modèles d’embedding sont chargés dynamiquement et localement ; aucun téléchargement implicite pendant une recherche.

### Android

- Java 17, package `fr.mina.gateway`, `minSdk 23`, `targetSdk 35`, `compileSdk 35`.
- Android Gradle Plugin `8.13.2`, Gradle `8.13`, Build Tools `35.0.0`.
- Room `2.8.4` avec `annotationProcessor`, WorkManager `2.11.2`, Firebase BoM `34.15.0`, Google Services `4.5.0`.
- Décision supersédée par v3 : Kotlin est obligatoire pour l’unique APK, car Google Home APIs repose sur Kotlin/Flow. Android Keystore reste utilisé directement.

## Contrats inter-domaines

### Enveloppe commune

```ts
type MinaEnvelope = {
  version: 1;
  id: string;
  correlationId: string;
  channel: 'local' | 'voice' | 'sms' | 'telegram';
  kind: string;
  createdAt: string;
  expiresAt: string | null;
  sender: { identityId: string; deviceId: string };
  payloadCiphertext: string;
  nonce: string;
  authTag: string;
  signature: string;
};
```

- UUID v7 ou identifiant monotone équivalent, horodatage ISO UTC dans les contrats, affichage en heure locale.
- AES-256-GCM pour le contenu et ECDSA P-256 pour l’identité de périphérique (support Android Keystore matériel plus prévisible), avec algorithme/version dans l’enveloppe et compteur anti-rejeu par paire de dispositifs.
- Une enveloppe expirée, dupliquée, mal signée ou avec compteur régressif est rejetée avant déchiffrement métier.

### Autorité et capacité

```ts
type CapabilityRequest = {
  sessionId: string;
  channel: MinaEnvelope['channel'];
  capability: string;
  resource?: string;
  effect: 'read' | 'write' | 'execute' | 'send';
};
```

- Toute capacité traverse `src/safety/capability-broker.mjs`.
- L’autorisation la plus restrictive gagne ; un hook, skill, transport ou modèle ne peut jamais élargir une permission.
- La confirmation est liée à `sessionId + capability + resource + digest` et expire après une seule utilisation.

### Événement de session

```ts
type SessionEvent = {
  eventId: string;
  runtimeSessionId: string;
  workSessionId: string | null;
  type: string;
  occurredAt: string;
  channel: string;
  payload: object;
};
```

- Append-only, payload secret chiffré, projection reconstruisible.
- Aucun évènement `after_tool` réussi sans observation de sortie structurée.

## Ordre d’exécution obligatoire

1. [Plan 1 — noyau, grounding et sessions](2026-07-14-mina-v2-core-grounding-sessions-plan.md).
2. [Plan 2 — mémoire locale, RAG et recherche](2026-07-14-mina-v2-memory-research-plan.md).
3. [Plan 3 — MINA.md, skills et sandbox](2026-07-14-mina-v2-skills-sandbox-plan.md).
4. Plan Android v2 supersédé : exécuter [passerelle Android Kotlin v3](2026-07-14-mina-v3-android-kotlin-gateway-plan.md).
5. [Plan 5 — intégration, durcissement et lancement](2026-07-14-mina-v2-integration-launch-plan.md).

Un plan ne démarre que si la suite du précédent est verte. Le plan Android peut être développé en parallèle logique uniquement après stabilisation des contrats d’enveloppe, mais pas via sous-agent sans autorisation explicite.

## Jalons de livraison

| Jalon | Livrable observable | Gate |
|---|---|---|
| M1 | Sessions et réponses avec ledger de preuves | tests unitaires + intégration sans réseau |
| M2 | Mémoire chiffrée, oubli, recherche web/fichiers | test restauration + test fuite plaintext |
| M3 | MINA.md validé, skills sûrs, Windows Sandbox fail-closed | tests permissions + sandbox réelle |
| M4 | APK Huawei SMS/Telegram, USB puis fallback | tests JVM + instrumentés + essai appareil |
| M5 | Mina intégrée et lancée en mode contrôlé | suite bureau, Android, smoke, checklist manuelle |

## Critères de sortie globaux

- `npm test` vert ; intégrations ciblées vertes ; couverture des nouveaux modules critiques ≥ 90 % branches.
- `gradlew.bat testDebugUnitTest lintDebug assembleDebug` vert et APK installable sur le Huawei autorisé.
- Aucun plaintext sensible retrouvé dans les bases, journaux, Firebase export ou crash reports de test.
- Redémarrage PC/téléphone : sessions inachevées récupérées sans rejouer d’action ni renvoyer de message.
- Coupure USB/LAN : passage Firebase chiffré ; retour USB : déduplication exacte.
- Un SMS ne déclenche jamais d’outil ; un Telegram ne déclenche jamais d’action PC/sandbox en v1.
- Une réponse factuelle non prouvée porte explicitement `incertain` ou est bloquée.
- Une impression, un téléchargement, un envoi, une suppression ou une écriture exige la confirmation prévue et une vérification après action.

## État des prérequis externes

- **Disponible :** JDK 17, SDK/Build Tools 35, ADB, distributions Gradle 8.13 en cache.
- **À fournir par Nasro au moment du plan 4 :** token BotFather et configuration Firebase Android ; le token est provisionné localement dans Android Keystore et ne doit pas apparaître dans le dépôt.
- **Bloquant pour exécuter réellement le plan 3 :** virtualisation firmware puis fonctionnalité Windows Sandbox activées et redémarrage. Tant que ce point n’est pas vérifié, Mina doit afficher `sandbox_unavailable` et ne rien exécuter sur l’hôte.
- **Non requis :** émulateur Android ; les tests instrumentés peuvent utiliser le Huawei physique.

## Vérification finale du plan

À la fin de chaque tâche :

```powershell
npm test
npm run test:integration
```

Sortie attendue : code `0`, aucun test ignoré sans justification. Pour Android :

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Sortie attendue : `BUILD SUCCESSFUL`. Si un prérequis externe empêche l’exécution, écrire exactement ce qui n’a pas tourné ; ne jamais déclarer le jalon terminé.
