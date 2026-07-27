# Preuves de commandes — audit Mina Vision du 2026-07-27

Ce fichier contient les commandes réellement exécutées et les sorties utiles non reformulées.
Les secrets ne sont jamais affichés. Le périmètre final est le commit
`f2c99d9f79374a126a314d30919dc8341bd78b70`.

> **Une seule caviardage avant publication** (dépôt public) : l'adresse IP du téléphone sur le
> réseau local de l'auteur est remplacée par `192.168.X.X` en § 8. La valeur de preuve est
> intacte — ce qui est démontré là est l'état `unauthorized` du transport ADB, pas l'adresse.
> Aucune autre sortie n'est modifiée.

## 1. Périmètre Git et absence de dérive du code

```powershell
git rev-parse HEAD
git rev-parse origin/master
git log -1 --format='%H%n%ad%n%s' --date=iso-strict
git status --short
```

```text
f2c99d9f79374a126a314d30919dc8341bd78b70
f2c99d9f79374a126a314d30919dc8341bd78b70
f2c99d9f79374a126a314d30919dc8341bd78b70
2026-07-27T05:14:04+01:00
docs(i18n): licence traduite — LICENSE.en.md (courtoisie) + LICENCES bilingue
?? docs/operations/AUDIT-COMPLET-2026-07-27.md
?? docs/operations/audit-2026-07-27/
```

Les inventaires et les suites longues ont été produits au SHA `fd5866d`. Les arbres consommés
par ces mesures sont byte-identiques au SHA final :

```powershell
$base = 'fd5866d2580127142e46b58848da2471488f70c0'
$current = git rev-parse HEAD
foreach ($path in 'src','tests','android','package-lock.json') {
  git rev-parse "${base}:$path"
  git rev-parse "${current}:$path"
}
```

```text
Path              BaseHash                                 CurrentHash                              Identical
----              --------                                 -----------                              ---------
src               6bc268ec292c17f5777a65a5f04be5d07c060f46 6bc268ec292c17f5777a65a5f04be5d07c060f46      True
tests             cd33fe1dd7dcc6df52c7016fb3f7aaeb1f52c9ff cd33fe1dd7dcc6df52c7016fb3f7aaeb1f52c9ff      True
android           c5a612c3174af8f039e2a70f29cc3d52dc718e44 c5a612c3174af8f039e2a70f29cc3d52dc718e44      True
package-lock.json 89db6f35367e79abff82e09638c46d63bfadc466 89db6f35367e79abff82e09638c46d63bfadc466      True
```

Le clone E2E Electron part de `2beded1`. La même comparaison donne exactement les quatre mêmes
hashes et `Identical=True`.

## 2. Inventaire exhaustif

Commande de validation des CSV générés par analyse Acorn :

```powershell
$modules = Import-Csv docs/operations/audit-2026-07-27/modules.csv
$functions = Import-Csv docs/operations/audit-2026-07-27/functions.csv
$androidModules = Import-Csv docs/operations/audit-2026-07-27/android-modules.csv
$androidFunctions = Import-Csv docs/operations/audit-2026-07-27/android-function-declarations.csv
$trackedFiles = @(git ls-files)
$trackedJs = @(git ls-files 'src/*.mjs' 'src/*.js' 'src/*.cjs')
$lineEquivalent = ($modules | Measure-Object -Property wc_line_equivalent -Sum).Sum
$sourceBytes = ($modules | Measure-Object -Property bytes -Sum).Sum
```

```text
Head                          : f2c99d9f79374a126a314d30919dc8341bd78b70
InventoryAuditSha             : fd5866d2580127142e46b58848da2471488f70c0
TrackedFiles                  : 1074
TrackedSourceJs               : 446
ModuleRows                    : 446
FunctionRows                  : 4837
SourceWcLineEquivalent        : 42137
SourceBytes                   : 1866014
MissingImportModules          : 1
MissingImportEdges            : 4
CoverageMissingTrackedModules : 5
AndroidFiles                  : 92
AndroidDeclarations           : 462
KotlinDeclarations            : 447
JavaDeclarations              : 15

MISSING_IMPORTS
path                     : src/core/compose-governance-domains.mjs
missing_relative_imports : 4
missing_specifiers       : ../emergency/network-policy.mjs;../emergency/device-guard.mjs;
                           ../emergency/emergency-mode.mjs;../emergency/emergency-corpus.mjs

COVERAGE_MISSING
src/biometrics/face-embedder-factory.mjs
src/executors/desktop-worker.mjs
src/messaging/httpsms/provider.mjs
src/ui/main.mjs
src/voice/local-voice-worker.mjs
```

Comptage des tests trackés :

```powershell
$allTests = @(git ls-files 'tests/*.test.mjs' 'tests/**/*.test.mjs' | Sort-Object -Unique)
```

```text
TrackedTestFiles     : 393
UnitTestFiles        : 376
IntegrationTestFiles : 17

Name         Count
----         -----
architecture     4
code            30
integration     17
root           342
```

L’extracteur Android est un regex assaini, pas un parseur Kotlin. Onze lignes espacées ont été
relues dans leur source : 11/11 vrais positifs. Une contre-mesure `rg` a trouvé trois méthodes Java
omises (`byState`, deux `allForTest`) ; le CSV a été corrigé de 459 à 462 déclarations. Le regex
Kotlin brut trouvait 444 lignes ; les trois lignes supplémentaires du CSV étaient de vraies
extensions (`toMessage`, `toRow`, `toEvent`), absentes du regex brut.

## 3. Suites JavaScript

### 3.1 Commande officielle

```powershell
npm test
```

```text
Test Files  6 failed | 370 passed (376)
Tests       6 failed | 3089 passed | 9 skipped (3104)
Errors      1 error
Duration    264.38s
```

Échecs observés : six timeouts de tests/hook (`security-invariants`,
`main-host-write-policy-contract`, deux cas `skill-installer`,
`architecture/no-direct-provider`, `architecture/storage-boundaries`) et le hook de
`code-services-real-project` à 180 s. L’étape intégration de `npm test` n’a pas démarré, car
`test:unit` a renvoyé un code non nul.

### 3.2 Rejeu série exact des six fichiers en échec

```powershell
npx vitest run `
  tests/security-invariants.test.mjs `
  tests/main-host-write-policy-contract.test.mjs `
  tests/skill-installer.test.mjs `
  tests/architecture/no-direct-provider.test.mjs `
  tests/architecture/storage-boundaries.test.mjs `
  tests/code/code-services-real-project.test.mjs `
  --no-file-parallelism --testTimeout=60000 --hookTimeout=300000
```

```text
Test Files  6 passed (6)
Tests       35 passed (35)
Duration    159.91s
```

### 3.3 Suite unitaire sérialisée avec couverture

```powershell
npx vitest run --coverage --exclude tests/integration/** `
  --no-file-parallelism --testTimeout=60000 --hookTimeout=300000
```

```text
Test Files  376 passed (376)
Tests       3104 passed (3104)
Duration    454.08s
% Coverage report from v8
All files   | 80.04 | 74.88 | 78.22 | 85.06
```

### 3.4 Intégration et critique

```powershell
npm run test:integration
npm run test:critical
```

```text
test:integration
Test Files  17 passed (17)
Tests       48 passed (48)
Duration    126.01s

test:critical
Test Files  16 passed (16)
Tests       182 passed (182)
Duration    9.44s
```

## 4. Couverture réellement attribuable aux fichiers trackés

```powershell
node docs/operations/audit-2026-07-27/summarize-coverage.mjs
```

```json
{
  "trackedSourceModules": 446,
  "coverageSourceEntries": 445,
  "instrumentedTrackedModules": 441,
  "missingTrackedModules": [
    "src/biometrics/face-embedder-factory.mjs",
    "src/executors/desktop-worker.mjs",
    "src/messaging/httpsms/provider.mjs",
    "src/ui/main.mjs",
    "src/voice/local-voice-worker.mjs"
  ],
  "extraUntrackedOrIgnoredModules": [
    "src/emergency/device-guard.mjs",
    "src/emergency/emergency-corpus.mjs",
    "src/emergency/emergency-mode.mjs",
    "src/emergency/network-policy.mjs"
  ],
  "trackedOnlySummary": {
    "statements": { "covered": 16688, "total": 20851, "pct": 80.03 },
    "branches": { "covered": 13258, "total": 17696, "pct": 74.92 },
    "functions": { "covered": 3460, "total": 4429, "pct": 78.12 },
    "lines": { "covered": 14698, "total": 17279, "pct": 85.06 }
  },
  "reportSummaryIncludingExtraModules": {
    "statements": { "covered": 16829, "total": 21024, "pct": 80.04 },
    "branches": { "covered": 13349, "total": 17825, "pct": 74.88 },
    "functions": { "covered": 3488, "total": 4459, "pct": 78.22 },
    "lines": { "covered": 14823, "total": 17425, "pct": 85.06 }
  }
}
```

Importeurs directs :

```text
Modules                         : 446
WithDirectTestImporter          : 417
WithoutDirectTestImporter       : 29
WithoutDirectButInstrumented    : 25
WithoutDirectAndNotInstrumented : 4
```

## 5. E2E Electron réel, isolé

L’instance Mina ouverte par Nasro n’a pas été arrêtée. Le clone d’audit utilise deux adaptations
temporaires visibles dans son `git diff` : dossier `userData` isolé et désactivation du verrou
single-instance uniquement quand `MINA_AUDIT_ALLOW_MULTI_INSTANCE=true`. Les quatre modules
`src/emergency` locaux ont été copiés dans ce clone, car ils ne sont pas dans Git.

```powershell
node docs/operations/audit-2026-07-27/e2e-electron-welcome.mjs
```

```json
{
  "welcomeVisible": true,
  "profileCount": 1,
  "activeProfile": true,
  "welcomeCompleted": true,
  "recoveryPhraseWordCount": 12,
  "activatedViews": [
    "mission",
    "config",
    "automation",
    "today",
    "diagnostic",
    "code"
  ],
  "memoryUnlocked": true,
  "runtimeOk": true,
  "webPreferences": {
    "nodeIntegration": false,
    "contextIsolation": true,
    "sandbox": true,
    "webSecurity": true,
    "allowRunningInsecureContent": false
  },
  "pageErrors": []
}
```

La phrase elle-même n’a jamais été imprimée dans le journal d’audit.

## 6. Android

```powershell
cd android
.\gradlew.bat test lintDebug assembleDebug
```

```text
BUILD SUCCESSFUL in 9m 56s
524 actionable tasks: 524 executed
```

Rejeu sans cache des tests :

```powershell
.\gradlew.bat test --rerun-tasks
```

```text
BUILD SUCCESSFUL in 8m 26s
321 actionable tasks: 321 executed
```

Agrégation directe des XML JUnit :

```text
XmlReports : 46
ParsedRows : 46

Variant Suites Tests Failures Errors Skipped
------- ------ ----- -------- ------ -------
debug       23    91        0      0       0
release     23    91        0      0       0
```

Agrégation des sept XML lint :

```text
LintXmlReports : 7
TotalWarnings  : 69
TotalErrors    : 0
```

La seule alerte de compatibilité API relevée :

```text
Id       : InlinedApi
Severity : Warning
Message  : Field requires API level 30 (current min is 29):
           android.content.pm.ServiceInfo#FOREGROUND_SERVICE_TYPE_CAMERA
File     : android/feature/camera/src/main/kotlin/fr/mina/gateway/camera/CameraStreamService.kt
Line     : 202
```

L’instrumentation physique a été lancée mais n’a pas pu s’exécuter :

```powershell
.\gradlew.bat connectedDebugAndroidTest
adb devices -l
```

```text
FAILURE: Build failed with an exception.
No connected devices!

List of devices attached
192.168.X.X:5555      unauthorized transport_id:2
```

APK construit :

```text
ApkBytes  : 53794848
ApkSha256 : D460C833DEF2FAA8527ABFF52BD99F12F53120C165A180B8B22F78D9D516E41D
```

## 7. Reproduction critique : clone Git propre inutilisable

```powershell
git clone --quiet --no-local . node_modules/.cache/mina-audit-clean-f2c99d9
git check-ignore -v `
  src/emergency/device-guard.mjs `
  src/emergency/emergency-corpus.mjs `
  src/emergency/emergency-mode.mjs `
  src/emergency/network-policy.mjs
git ls-files -- 'src/emergency/*'
git log --all --format='%H' -- 'src/emergency/*'
node --input-type=module -e "import('./src/core/compose-governance-domains.mjs')"
```

```text
CloneHead               : f2c99d9f79374a126a314d30919dc8341bd78b70
TrackedEmergencyFiles   : 0
EmergencyHistoryCommits : 0
CloneEmergencyFiles     : 0

.gitignore:39:emergency/ src/emergency/device-guard.mjs
.gitignore:39:emergency/ src/emergency/emergency-corpus.mjs
.gitignore:39:emergency/ src/emergency/emergency-mode.mjs
.gitignore:39:emergency/ src/emergency/network-policy.mjs

Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\src\emergency\network-policy.mjs'
imported from ...\src\core\compose-governance-domains.mjs

Node.js v22.14.0
CleanCloneImportExit=1
```

Les quatre imports sont aux lignes 15–18 de `src/core/compose-governance-domains.mjs`, lui-même
importé statiquement par `src/ui/main.mjs:117`.

## 8. Reproduction haute : révocation WebSocket contournée

```powershell
node docs/operations/audit-2026-07-27/repro-chat-revocation.mjs
```

```json
{
  "before": {
    "approved": true,
    "keyEpoch": 1,
    "connected": true
  },
  "revoked": {
    "ok": true,
    "keyEpoch": 2
  },
  "afterRevoke": {
    "approved": false,
    "keyEpoch": 2,
    "connected": true
  },
  "receivedAfterRevocation": [
    "ack",
    "encrypted_reply"
  ],
  "responseGenerated": 1,
  "decryptedReply": "reponse-apres-revocation"
}
```

Le harnais emploie le vrai serveur WebSocket, la vraie poignée de main P-256/ECDH, le vrai
chiffrement/signature et une trame à l’ancienne époque. Il n’injecte aucun faux registre.

## 9. Reproduction IA : preuve perdue dans Computer Use

```powershell
node docs/operations/audit-2026-07-27/repro-computer-use-evidence.mjs
```

```json
{
  "openai": {
    "start": {
      "keys": ["goal", "environment", "viewport", "url"],
      "markerPresent": false
    },
    "continue": {
      "keys": ["goal", "environment", "viewport", "url", "previousCall", "actionResult"],
      "markerPresent": false
    }
  },
  "local": {
    "start": {
      "keys": ["phase", "goal", "environment", "observation", "evidence", "outputContract"],
      "markerPresent": true
    },
    "continue": {
      "keys": ["phase", "goal", "environment", "previousCall", "actionResult", "observation", "outputContract"],
      "markerPresent": false
    }
  }
}
```

Le fournisseur Gemini a un test positif distinct : `tests/gemini-computer-use.test.mjs` vérifie
que la preuve est séparée du but et marquée « source non fiable ».

## 10. Skills/plugins

```powershell
node --input-type=module -e "
  import { auditSkillPackage } from './src/skills/skill-auditor.mjs';
  import { createSkillRegistry } from './src/skills/skill-registry.mjs';
  // audit du dossier pianiste puis scan du registre
"
```

```json
{
  "audit": {
    "error": "skill_metadata_fields_invalid"
  },
  "registeredNames": [
    "file-analysis",
    "massage-robot-domicile",
    "mythos",
    "research-summary",
    "sandbox-code"
  ],
  "pianistRegistered": false
}
```

Audit des six dossiers :

```text
file-analysis            installable=true  issues=[] files=1 bytes=922
massage-robot-domicile   installable=true  issues=[] files=2 bytes=10024
mythos-mina-skill        installable=true  issues=[] files=4 bytes=46786
pianiste-volonte-lumiere error=skill_metadata_fields_invalid
research-summary         installable=true  issues=[] files=1 bytes=1004
sandbox-code             installable=true  issues=[] files=1 bytes=1121
```

Le script Python du skill pianiste a aussi été exécuté isolément avec `python -B` : module
importable, piste MIDI de 49 octets, 480 ticks/beat, tempo 72, marqueur end-of-track présent,
pitch invalide refusé. Ce résultat valide le script, pas son manifeste Mina.

## 11. Perte silencieuse httpSMS

```powershell
npx vitest run tests/httpsms-webhook-server.test.mjs `
  --no-file-parallelism --reporter=verbose
```

```text
✓ returns 500-safe (still 202 to httpSMS) when the callback throws, so httpSMS does not retry-storm

Test Files  1 passed (1)
Tests       11 passed (11)
Duration    1.06s
```

Le code attrape toute exception de `onInboundMessage`, ne journalise rien, ne met rien en file et
renvoie quand même `202`. Dans la composition réelle, le callback commence par
`memoryController.rememberRemoteMessage`; si cette écriture échoue, l’événement `sms_received`
n’est pas émis et le fournisseur ne retentera pas.

## 12. Intégrations externes

État global :

```powershell
npm run verify
```

```json
{
  "cloudKeys": { "ready": true },
  "lmStudio": { "ready": false, "reason": "lm_studio_unreachable" },
  "androidTransport": {
    "ready": false,
    "reason": "no_authorized_android_device",
    "transports": []
  },
  "wifi": { "ready": false, "reason": "wifi_transport_not_connected" },
  "googleHomeSdk": { "ready": false, "reason": "google_home_sdk_unavailable" },
  "mailAccounts": {
    "ready": false,
    "reason": "mail_accounts_not_yet_configurable_from_cli"
  },
  "firebase": {
    "ready": false,
    "optional": true,
    "reason": "firebase_unconfigured"
  },
  "summary": {
    "allRequiredReady": false,
    "notReady": [
      "lmStudio",
      "androidTransport",
      "wifi",
      "googleHomeSdk",
      "mailAccounts"
    ]
  }
}
```

Sondes d’authentification sans affichage des clés :

```powershell
node docs/operations/audit-2026-07-27/probe-provider-auth.mjs
```

```json
[
  { "name": "gemini", "configured": true, "status": 200, "durationMs": 430 },
  { "name": "openrouter", "configured": true, "status": 200, "durationMs": 80 },
  { "name": "groq", "configured": true, "status": 200, "durationMs": 234 },
  { "name": "deepgram", "configured": true, "status": 200, "durationMs": 683 },
  { "name": "deepseek", "configured": false },
  { "name": "modal", "configured": true, "status": 503, "durationMs": 634 }
]
```

Une inférence Computer Use réelle a été lancée pendant la même passe :

```text
Gemini     accepted=true  durationMs=9638  firstCall=take_screenshot  interactionIdPresent=true
OpenRouter accepted=true  durationMs=9954  responseReceived=true     completed=true
Modal      accepted=false durationMs=1176  status=503
```

httpSMS, Telegram propriétaire, YouTube Data, Home Assistant, MQTT et Firebase n’étaient pas
configurés au moment du test. `verify` rapporte les comptes mail comme non encore configurables
depuis le CLI ; aucun compte mail live n’a été testé. Aucune réussite live n’est revendiquée pour
ces surfaces.

```json
{
  "httpsms": {
    "enabled": false,
    "baseUrlConfigured": true,
    "apiKeyConfigured": false,
    "webhookSecretConfigured": false,
    "fromNumberConfigured": false
  },
  "telegramOwnerConfigured": false,
  "youtubeConfigured": false,
  "homeAssistantConfigured": false,
  "mqttConfigured": false,
  "firebaseProjectConfigured": false,
  "firebaseBucketConfigured": false,
  "firebaseServiceAccountExists": true,
  "googleHomeSdkConfigured": false
}
```

Le compte de service Firebase local existe, mais l’état Git a été prouvé séparément :

```text
Exists             : True
TrackedCount       : 0
HistoryCommitCount : 0
.gitignore:6:env/ env/mina-vission-5355334a72f5.json
```

Il n’est donc ni tracké ni présent dans l’historique Git interrogé. Firebase reste non configuré
car les identifiants projet/bucket sont absents.

## 13. GitHub et chaîne de livraison

```powershell
gh repo view --json nameWithOwner,visibility,defaultBranchRef,url
gh api repos/Nassreallah-B/Mina-Vision/actions/workflows
gh api repos/Nassreallah-B/Mina-Vision/branches/master/protection
gh api repos/Nassreallah-B/Mina-Vision
gh api repos/Nassreallah-B/Mina-Vision/automated-security-fixes
gh api repos/Nassreallah-B/Mina-Vision/releases/latest
```

```text
visibility=PUBLIC
defaultBranchRef=master
workflow total_count=0
required_signatures.enabled=false
enforce_admins.enabled=false
required_linear_history.enabled=false
allow_force_pushes.enabled=false
allow_deletions.enabled=false
dependabot_security_updates.status=disabled
secret_scanning.status=enabled
secret_scanning_push_protection.status=enabled
automated-security-fixes.enabled=false
latest release=v0.1.0
assets=["Mina.Vision.apk"]
```

Il n’existe donc aucun workflow GitHub Actions et aucune exigence de check/review sur `master`.
Les protections contre force-push et suppression sont bien désactivées explicitement dans l’API
comme autorisations (`allow_force_pushes=false`, `allow_deletions=false`) ; ce ne sont pas des
findings.

## 14. Dépendances, signatures et licences

```powershell
npm audit --json
npm audit signatures --json
npm ls --depth=0 --json
npm outdated --json
```

```text
NpmAuditExit           : 1
Critical               : 0
High                   : 5
Moderate               : 7
Low                    : 0
Total                  : 12
Dependencies           : 693
AuditSignaturesExit    : 0
InvalidSignatures      : 0
MissingSignatures      : 0
NpmLsExit              : 0
DirectDependencies     : 37
NpmOutdatedExit        : 1
OutdatedDirectPackages : 13

@huggingface/transformers          high      direct=true  fix=false
adm-zip                            high      direct=false fix=false
kokoro-js                          high      direct=true  fix=false
onnxruntime-node                   high      direct=true  fix=false
sharp                              high      direct=false fix=false
@jimp/core                         moderate  direct=false fix=false
@jimp/custom                       moderate  direct=false fix=false
@nut-tree-fork/nut-js              moderate  direct=true  fix=false
@nut-tree-fork/provider-interfaces moderate  direct=false fix=true
@nut-tree-fork/shared              moderate  direct=false fix=true
file-type                          moderate  direct=false fix=false
jimp                               moderate  direct=false fix=false
```

Licences des directes lues dans leurs `package.json` installés :

```json
{
  "directPackages": 37,
  "nonPermissive": [
    {
      "name": "espeak-ng",
      "version": "1.0.2",
      "license": "GPL-3.0-or-later",
      "scope": "prod"
    }
  ]
}
```

La release live ne contient que l’APK Android. Aucun binaire Electron distribué contenant
`espeak-ng` n’a été trouvé ; aucune violation GPL actuelle n’est donc affirmée. La distribution
future d’un binaire Electron reste un gate juridique documenté.

## 15. Secret scanning

```powershell
gh api repos/Nassreallah-B/Mina-Vision/secret-scanning/alerts?state=open
node docs/operations/audit-2026-07-27/probe-secret-alert.mjs
```

```text
open alerts=1
secret_type_display_name=Google API Key
state=open
publicly_leaked=true
validity=unknown
locations:
  tests/code/code-verifier.test.mjs:51
  tests/code/code-review.test.mjs:26
  docs/operations/AUDIT-PRE-PUBLICATION.md:14
```

```json
{
  "trackedUniqueGoogleKeyCandidates": 1,
  "anyCandidateEqualsConfiguredGeminiKey": false,
  "probes": [
    {
      "status": 400,
      "reason": "API_KEY_INVALID"
    }
  ]
}
```

Conclusion bornée : GitHub ne renvoie pas la valeur brute de l’alerte. Les trois locations
coïncident avec la fixture actuelle ; l’identité entre l’alerte et ce candidat est donc une
inférence, pas une comparaison de valeurs. Le candidat actuel est invalide et différent de la clé
configurée. Cela ne prouve pas qu’aucun secret n’a jamais existé ailleurs.

## 16. Firebase

```powershell
rg -n "allow read|allow create|allow update|allow delete|request\.auth" firebase/firestore.rules
rg -n "allow read|allow write|request\.auth|ownerId" firebase.storage.rules
```

```text
firebase/firestore.rules:49: allow read: if request.auth != null;
firebase/firestore.rules:50: allow create: if request.auth != null && wellFormed();
firebase/firestore.rules:53: allow update: if false;
firebase/firestore.rules:55: allow delete: if request.auth != null;

firebase.storage.rules:4: match /owners/{ownerId}/devices/{deviceId}/{objectPath=**} {
firebase.storage.rules:5: allow read, write: if request.auth != null
firebase.storage.rules:6:   && request.auth.uid == ownerId;
```

Le risque Firestore est conditionnel : toute session authentifiée peut lire/supprimer tout
document `relay`. Le dépôt explique explicitement que Firebase est un tuyau non fiable et que la
confidentialité/intégrité viennent du chiffrement et des signatures. Firebase était non configuré,
donc aucun état live déployé n’est affirmé.

## 17. Performances

```powershell
npm run benchmark:blind-index
npm run benchmark:vector-scan
npm run benchmark:vector-scan
```

```text
{"documents":10000,"indexMs":1536.24,"searchMs":253.57,"matches":104,"first":"chunk-0"}
{"vectors":100000,"dimensions":32,"topK":100,"measuredRuns":10,
 "p95Ms":371.63,"minMs":241.24,"maxMs":371.63}
{"vectors":100000,"dimensions":32,"topK":100,"measuredRuns":10,
 "p95Ms":319.44,"minMs":230.08,"maxMs":319.44}
```

Le script fait `durations.slice(2)` puis garde 10 mesures et calcule
`ceil(10 × 0.95) - 1 = 9` : le « p95 » publié est donc toujours le maximum de l’échantillon.

## 18. Nouveaux commits documentaires `56178b8` et `f2c99d9`

```powershell
git show --stat --oneline 56178b8
git diff --check fd5866d..HEAD
```

```text
56178b8 docs(i18n): documentation bilingue — anglais principal, français en .fr.md (16 paires)
32 files changed, 1920 insertions(+), 707 deletions(-)

ChangedFiles  : 32
FrenchFiles   : 16
CompletePairs : 16
MissingPairs  : 0

git diff --check: aucune sortie, exit 0
```

Ce contrôle prouve la présence des paires, l’absence d’erreur whitespace détectée par Git et les
liens relatifs. Il ne constitue pas une certification professionnelle de fidélité juridique ou
linguistique des traductions.

```powershell
git show --stat --oneline HEAD
npx vitest run tests/license-protection.test.mjs --no-file-parallelism
```

```text
f2c99d9 docs(i18n): licence traduite — LICENSE.en.md (courtoisie) + LICENCES bilingue
 LICENCES.fr.md                       | 107 +++++++++++++++++++++++++++++++
 LICENCES.md                          | 119 ++++++++++++++++++-----------------
 LICENSE.en.md                        | 106 +++++++++++++++++++++++++++++++
 README.fr.md                         |   5 +-
 README.md                            |  10 +--
 docs/operations/SECURITY-AUDIT.fr.md |  10 +--
 6 files changed, 288 insertions(+), 69 deletions(-)

Test Files  1 passed (1)
Tests       4 passed (4)
Duration    1.12s
```

Contrôle indépendant de tous les liens Markdown trackés :

```text
TrackedMarkdownFiles   : 54
RelativeMarkdownLinks  : 87
MissingRelativeTargets : 0
```

Le texte juridique canonique `LICENSE` n’a pas été modifié. Le commit est cohérent sur les liens,
mais `LICENCES.md`, `LICENCES.fr.md` et les deux rapports SECURITY-AUDIT conservent « 13 avis »,
alors que `npm audit --json` mesure actuellement 12 (5 high, 7 moderate).
