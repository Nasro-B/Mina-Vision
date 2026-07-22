# Mina Huawei Camera and Biometrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Tout sous-agent exige l’accord explicite préalable de Nasro.

**Goal:** Fournir un vrai flux CameraX du Huawei, fusionner caméra/écran/DOM et reconnaître localement Nasro avec états prudents, sans transformer la biométrie en permission.

**Architecture:** CameraX `ImageAnalysis` produit au plus la dernière frame dans `feature:camera`; le transport média USB/LAN est séparé du contrôle. Electron échantillonne et fusionne les observations. YuNet détecte, SFace calcule un embedding local. Le coffre biométrique est isolé de mémoire/RAG/Firebase/export.

**Tech Stack:** AndroidX CameraX 1.5.3, Kotlin, foreground service caméra Android, Node `onnxruntime-node@1.27.0` et `sharp@0.35.3` chargés dynamiquement, YuNet 2026may ONNX (licence MIT du dossier) et SFace 2021dec ONNX (Apache-2.0).

## Task 1: Add the Android camera feature module

**Files:**
- Create: `android/feature/camera/build.gradle.kts`
- Modify: `android/settings.gradle.kts`
- Modify: `android/app/build.gradle.kts`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/feature/camera/src/main/kotlin/fr/mina/gateway/camera/CameraSessionController.kt`
- Create: `android/feature/camera/src/test/kotlin/fr/mina/gateway/camera/CameraSessionControllerTest.kt`

- [x] Write state-machine tests `idle → permission_required → starting → streaming → stopping → idle`, denial, camera switch and double start.
- [x] Add CameraX `camera-core`, `camera-camera2`, `camera-lifecycle` 1.5.3. Request `CAMERA` visibly; use a foreground service with `camera` type only while streaming.
- [x] Select front/rear by stable logical choice, not hardcoded numeric camera ID. Expose the Huawei’s available lenses as metadata.
- [x] Run `android\gradlew.bat :feature:camera:test :app:assembleDebug`; expected green. — Vérifié 15 juillet 2026 : `testDebugUnitTest` BUILD SUCCESSFUL après correction `GRADLE_USER_HOME` (voir EXECUTION-LOG.md).

Conditional commit: `feat(camera): add camerax session module`.

## Task 2: Encode a bounded latest-frame stream

**Files:**
- Create: `android/feature/camera/src/main/kotlin/fr/mina/gateway/camera/CameraFrameEncoder.kt`
- Create: `android/feature/camera/src/main/kotlin/fr/mina/gateway/camera/CameraStreamService.kt`
- Create: `android/feature/camera/src/test/kotlin/fr/mina/gateway/camera/CameraFrameEncoderTest.kt`
- Test: `tests/fixtures/camera/frame-envelope-v1.json`

- [x] Write tests for rotation, timestamp, lens, width/height, sequence, JPEG quality, oversized frame and backpressure.
- [x] Configure `ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST`, target 640×480, maximum 5 FPS, JPEG quality 75, maximum encoded frame 350 KiB. Drop rather than queue stale frames.
- [x] Define frame metadata `{ sessionId, sequence, capturedAt, lens, rotation, width, height, mimeType, sha256 }` signed by the paired device.
- [x] Never send frames through Firebase. Stop stream on screen lock, permission revocation, transport loss over 10 seconds or explicit emergency stop.
- [x] Run module tests; expected green. — Vérifié 15 juillet 2026 avec `testDebugUnitTest`.

Conditional commit: `feat(camera): stream bounded signed frames`.

## Task 3: Receive and sample frames on the PC

**Files:**
- Create: `src/camera/android-camera-client.mjs`
- Create: `src/camera/perception-sampler.mjs`
- Modify: `src/executors/phone-bridge.mjs`
- Test: `tests/android-camera-client.test.mjs`
- Test: `tests/perception-sampler.test.mjs`

- [x] Write failing tests for signature, sequence replay, TTL, wrong physical device, malformed JPEG, cancellation and sampling under overload.
- [x] Implement client `start({ deviceId, lens, maxFps })`, async `frames()`, `stop()`. Resolve transport through `PhysicalDeviceRegistry`.
- [x] Rename/deprecate current `startCamera()` as `openSystemCameraPreview()` so no code confuses it with sensor streaming.
- [x] Sampler selects the newest frame for a requested observation and records dropped counts; no unbounded buffer.
- [x] Run targeted tests; expected green. — Vérifié 15 juillet 2026 (npm test 118 fichiers/515 tests verts).

Conditional commit: `feat(camera): receive huawei sensor frames`.

## Task 4: Fuse screen, DOM, OCR, and camera evidence

**Files:**
- Create: `src/perception/multimodal-observation.mjs`
- Create: `src/perception/observation-fusion.mjs`
- Test: `tests/observation-fusion.test.mjs`

- [x] Write fixtures with camera and screen timestamps inside/outside a 750 ms fusion window.
- [x] Return an immutable observation with independent provenance per modality; never claim simultaneity outside the window.

```js
{
  observedAt: '...',
  modalities: {
    screen: { digest: '...', source: 'desktop' },
    web: { digest: '...', source: 'playwright' },
    camera: { digest: '...', deviceId: '...', lens: 'front' },
    ocr: { blocks: [], modelId: '...' }
  },
  synchronization: 'aligned'
}
```

- [ ] The route decides which modalities a task needs. Do not continuously send camera frames to cloud or retain them in a session transcript.
- [ ] Run targeted test; expected green.

Conditional commit: `feat(perception): fuse camera and structured observations`.

## Task 5: Install and verify local face models

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `config/models/face-yunet.json`
- Create: `config/models/face-sface.json`
- Create: `src/biometrics/face-model-loader.mjs`
- Test: `tests/face-model-loader.test.mjs`

- [x] Add exact runtime dependencies `onnxruntime-node@1.27.0` and `sharp@0.35.3` using `npm install --save-exact`; do not import them statically in startup paths.
- [x] Register YuNet/SFace manifests with upstream URL, immutable revision, SHA-256, license and local path. Download only by explicit `models.install` request through the quarantined installer.
- [x] Write tests for checksum mismatch, wrong tensor signature, missing model and unload.
- [x] Run targeted test and `npm test`; expected green without models downloaded. — Vérifié 15 juillet 2026.

Conditional commit: `build(biometrics): add local onnx face runtime`.

## Task 6: Enroll and match Nasro locally

**Files:**
- Create: `src/biometrics/face-profile-store.mjs`
- Create: `src/biometrics/face-recognizer.mjs`
- Create: `src/biometrics/liveness-check.mjs`
- Test: `tests/face-profile-store.test.mjs`
- Test: `tests/face-recognizer.test.mjs`
- Test: `tests/liveness-check.test.mjs`

- [x] Write tests for separate key domain, no raw image storage, multiple enrollment angles, unknown face, borderline score and deleted profile.
- [x] Enrollment requires visible local consent and at least 8 accepted frames across front/left/right. Store normalized embeddings and calibration metadata only, encrypted under `biometric/face-profile`.
- [x] Return only `recognized`, `unknown`, `uncertain`, with score kept local. Begin with the SFace documented cosine reference threshold as a calibration seed (0.363, LFW @99.60%, docs.opencv.org), then derive the operational threshold from Nasro’s enrollment validation set; if calibration is insufficient, always return `uncertain`.
- [x] Implement liveness as a multi-frame challenge signal (head turn/time consistency — blink deliberately not claimed: YuNet's 5-point landmarks have no eyelid contour to detect it honestly). Label it `presence_signal`, never “proof of identity”.
- [x] Verify stores/exports/RAG/Firebase reject biometric records. — **fait à la tâche 5 « architecture tests » du plan intégration v3** (`tests/architecture/storage-boundaries.test.mjs`, 15/16 juillet 2026) : scan réel du code source, zéro import croisé biometrics/camera ↔ memory/rag/backup.
- [x] Run targeted tests; expected green with synthetic embeddings, not personal photos committed to fixtures. — Vérifié 15 juillet 2026 : 25 tests neufs (face-profile-store, liveness-check, face-recognizer) + suite complète 121 fichiers/538 tests verts. `src/perception/face-recognition.mjs` (brouillon pré-plan) supprimé, remplacé par le trio ci-dessus.

Conditional commit: `feat(biometrics): add private face recognition profile`.

## Task 7: Expose camera and recognition controls safely

**Files:**
- Create: `src/ui/ipc/camera-ipc.mjs`
- Create: `src/ui/pages/camera-controller.mjs`
- Test: `tests/camera-ipc.test.mjs`

- [x] Write failing tests for device list, permission state, start/stop, lens switch, preview cadence, enrollment and profile deletion.
- [x] Expose named IPC only; send preview thumbnails at ≤ 2 FPS (rate-limited to 2/s in the controller) — object-URL revocation itself is deferred to renderer integration (v3 integration plan) as this task has no renderer yet.
- [x] Display visible camera-active state. Recognition must never call `CapabilityBroker.confirm()` or unlock home/email/payment actions — enforced structurally: `camera-controller.mjs` never depends on `CapabilityBroker` at all.
- [x] Run targeted tests; expected green. — Vérifié 15 juillet 2026 : 16/16, suite complète 122 fichiers/554 tests verts.

Conditional commit: `feat(camera): expose safe camera controls`.

## Final Gate

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Expected: both exit `0`. Manual Huawei test: front/rear stream starts visibly, preview stays bounded, USB removal stops within 10 seconds, and no camera/face payload exists in Firebase or memory exports.

