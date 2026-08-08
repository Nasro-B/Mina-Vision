# Mina Encrypted Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** remplacer la note vocale temporaire par du PCM chiffré.

**Architecture:** Android chiffre chaque chunk avant son écriture ; le PC vérifie avant transcription.

**Tech Stack:** Kotlin, AudioRecord, AES-GCM, Node ESM, Vitest.

## Global Constraints

- Aucun fichier audio clair ne doit être écrit.
- Aucun micro au boot ou en arrière-plan.
- Aucun push, déploiement ou réinstallation APK.
- Source normative : sections 17 et 19 de docs/superpowers/specs/2026-07-22-mina-vision-native-chat-design.md et Task 20 du plan natif du 22 juillet.
- Le format de voix est exactement audio/L16;rate=16000;channels=1 : PCM signed little-endian, mono, 16 000 Hz et 16 bits.
- Les limites sont exactement 300 ms minimum, 30 minutes maximum et 50 MiB maximum ; la première limite atteinte termine la capture.
- RECORD_AUDIO existe déjà dans android/app/src/main/AndroidManifest.xml ; la demande runtime reste exclusivement déclenchée par l'action utilisateur.
- Les artefacts persistants de capture portent l'extension .bin et contiennent uniquement nonce et ciphertext AES-GCM.
- Perte de focus audio, arrêt de l'Activity, appel système, micro indisponible, erreur AudioRecord ou annulation déclenchent le même abandon : stop, release, abandon focus, effacement buffer et suppression des chunks.
- PC arrêté signifie outbox locale et attente visible ; il n'existe aucun fallback IA cloud.
- Firebase ne reçoit que des enveloppes E2EE existantes et n'est pas utilisé pour du flux audio live.
- Image et audio/mp4 historiques restent compatibles ; seul le nouveau PCM reçoit les limites voix.
- TDD : rouge observé, code minimal, vert et gate impacté avant chaque commit. Aucun secret ni lecture de env.
- Aucun sous-agent sans autorisation explicite de Nasro.

---

## Structure de fichiers cible

| Fichier | Responsabilité |
|---|---|
| android/core/protocol/.../VoicePcmFormat.kt | constantes et validation du format interopérable |
| android/core/protocol/.../MediaChunker.kt | manifeste/chunks stream sans ByteArray audio global |
| android/core/protocol/.../MediaAssembler.kt | validation PCM jusqu'à 50 MiB |
| android/core/chat/.../EncryptedAttachmentStore.kt | chunks et manifeste locaux intégralement chiffrés |
| android/core/chat/.../ChatRepository.kt | ULID de reprise, manifeste puis outbox E2EE |
| android/feature/voice/.../VoiceNoteRecorder.kt | AudioRecord, focus, bornes, buffers |
| android/feature/voice/.../VoiceNoteViewModel.kt | état note/PTT et retry local |
| android/feature/voice/.../PcmVoicePlayer.kt | AudioTrack sans fichier temporaire |
| android/feature/chat/.../ChatScreen.kt | permission utilisateur, lifecycle, contrôles |
| src/chat/voice-pcm.mjs | validation MIME et PCM16LE vers Float32Array |
| src/chat/voice-transcriber.mjs | transcription PCM sans renderer |
| src/chat/chat-media-handler.mjs | complétion média exactement une fois |
| src/devices/chat-server.mjs | ACK direct média après persistance PC |
| src/devices/chat-relay.mjs | décodage média v2 par Firebase |

### Task 1: Stabiliser le contrat PCM interopérable

**Files:**
- Create: android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/VoicePcmFormat.kt
- Create: android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/VoicePcmFormatTest.kt
- Modify: android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/MediaChunker.kt
- Modify: android/core/protocol/src/main/kotlin/fr/mina/gateway/protocol/MediaAssembler.kt
- Modify: android/core/protocol/src/test/kotlin/fr/mina/gateway/protocol/MediaAssemblerTest.kt
- Create: src/chat/voice-pcm.mjs
- Create: tests/voice-pcm.test.mjs
- Modify: src/chat/media-chunker.mjs
- Modify: src/chat/media-assembler.mjs
- Modify: tests/media-chunker.test.mjs

**Interfaces:**
- Produces Kotlin VoicePcmFormat.MIME, SAMPLE_RATE_HZ, CHANNEL_COUNT, BYTES_PER_SAMPLE, CHUNK_BYTES, MAX_BYTES and isCanonicalMime(mime).
- Produces Node VOICE_PCM_MIME, VOICE_SAMPLE_RATE_HZ, VOICE_CHUNK_BYTES, VOICE_MAX_BYTES, isVoicePcmMime(mime), pcm16leToFloat32(bytes).
- MediaChunker exposes encodeMeta(mediaId, mime, sizeBytes, sha256, chunkCount, chunkBytes, extraMeta) and encodeChunk(mediaId, index, binary).

- [x] **Step 1: Write the failing tests**

    @Test
    fun voicePcmConstantsAreFixed() {
        assertEquals("audio/L16;rate=16000;channels=1", VoicePcmFormat.MIME)
        assertEquals(16_000, VoicePcmFormat.SAMPLE_RATE_HZ)
        assertEquals(32_000, VoicePcmFormat.CHUNK_BYTES)
        assertTrue(VoicePcmFormat.isCanonicalMime(VoicePcmFormat.MIME))
        assertFalse(VoicePcmFormat.isCanonicalMime("audio/L16;rate=8000;channels=1"))
    }

    it('converts signed little-endian PCM16 without a renderer', () => {
      expect(pcm16leToFloat32(Buffer.from([0x00, 0x80, 0xff, 0x7f])))
        .toEqual(new Float32Array([-1, 32767 / 32768]));
    });

    it('accepts 50 MiB only for canonical PCM and preserves 5 MiB images', () => {
      expect(parseMeta(voiceMeta({ sizeBytes: 50 * 1024 * 1024 }))).toMatchObject({ mime: VOICE_PCM_MIME });
      expect(() => parseMeta(voiceMeta({ sizeBytes: 50 * 1024 * 1024 + 1 }))).toThrow('media_taille_invalide');
      expect(() => parseMeta(imageMeta({ sizeBytes: 5 * 1024 * 1024 + 1 }))).toThrow('media_taille_invalide');
    });

- [x] **Step 2: Run tests to verify the red state**

    Run: android\gradlew.bat :core:protocol:testDebugUnitTest --tests "*VoicePcmFormatTest"

    Expected: compilation fails because VoicePcmFormat does not exist.

    Run: npx vitest run tests/voice-pcm.test.mjs tests/media-chunker.test.mjs

    Expected: FAIL because src/chat/voice-pcm.mjs is absent and the MIME is refused.

- [x] **Step 3: Write minimal compatible implementation**

    object VoicePcmFormat {
        const val MIME = "audio/L16;rate=16000;channels=1"
        const val SAMPLE_RATE_HZ = 16_000
        const val CHANNEL_COUNT = 1
        const val BYTES_PER_SAMPLE = 2
        const val CHUNK_BYTES = SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE
        const val MAX_BYTES = 50 * 1024 * 1024
        const val MIN_DURATION_MS = 300L
        const val MAX_DURATION_MS = 30L * 60L * 1_000L
        fun isCanonicalMime(mime: String) = mime == MIME
    }

    export const VOICE_PCM_MIME = 'audio/L16;rate=16000;channels=1';
    export function pcm16leToFloat32(bytes) {
      const source = Buffer.from(bytes);
      if (source.length === 0 || source.length % 2 !== 0) throw new Error('voice_pcm_invalide');
      const output = new Float32Array(source.length / 2);
      for (let offset = 0; offset < source.length; offset += 2) {
        output[offset / 2] = source.readInt16LE(offset) / 32768;
      }
      return output;
    }

    Make both assemblers use a mimeLimit helper: 50 MiB and 32 000-byte chunks only for canonical PCM, 5 MiB for images and legacy audio/mp4. Keep the historical audio/mp4 event mapping.

- [x] **Step 4: Run focused tests green**

    Run: android\gradlew.bat :core:protocol:testDebugUnitTest

    Expected: BUILD SUCCESSFUL.

    Run: npx vitest run tests/voice-pcm.test.mjs tests/media-chunker.test.mjs

    Expected: all tests pass, including refusal of noncanonical PCM parameters.

- [x] **Step 5: Commit**

    git add android/core/protocol src/chat/voice-pcm.mjs src/chat/media-chunker.mjs src/chat/media-assembler.mjs tests/voice-pcm.test.mjs tests/media-chunker.test.mjs
    git commit -m "feat(voice): define encrypted PCM media contract"

### Task 2: Chiffrer la capture locale et reprendre l'envoi sans duplication

**Files:**
- Create: android/core/chat/src/main/kotlin/fr/mina/gateway/chat/EncryptedAttachmentStore.kt
- Create: android/core/chat/src/test/kotlin/fr/mina/gateway/chat/EncryptedAttachmentStoreTest.kt
- Modify: android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatEngine.kt
- Modify: android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatRepository.kt
- Modify: android/core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatDatabase.kt
- Modify: android/core/chat/src/test/kotlin/fr/mina/gateway/chat/ChatRepositoryTest.kt

**Interfaces:**
- EncryptedVoiceAttachmentSink.append(buffer, byteCount), complete(durationMs), discard().
- StoredVoiceAttachment has mediaId, mime, sizeBytes, sha256, chunkCount, chunkBytes, durationMs and withDeliveryPlan(eventIds).
- ChatRepository.beginVoiceCapture(threadId) creates the sink. ChatRepository.enqueueVoice(capture) returns mediaId after every event/outbox row exists.

- [x] **Step 1: Write failing encrypted-storage tests**

    @Test
    fun appendPersistsCiphertextOnlyAndClearsCallerBuffer() = runTest {
        val input = "secret-voice".encodeToByteArray()
        val capture = store.createVoiceCapture("thread-main")
        capture.append(input, input.size)
        assertArrayEquals(ByteArray(input.size), input)
        assertFalse(root.walkTopDown().any { it.extension in setOf("pcm", "wav", "m4a", "mp4") })
        assertFalse(root.walkTopDown().filter { it.isFile }.any { it.readBytes().containsSlice("secret-voice".encodeToByteArray()) })
    }

    @Test
    fun sameDeliveryPlanResumesWithoutDuplicateEventIds() = runTest {
        val capture = completedCaptureWithTwoChunks()
        failingDao.failAfterSuccessfulOutgoingWrites = 1
        assertFailsWith<IOException> { repository.enqueueVoice(capture) }
        repository.enqueueVoice(capture)
        assertEquals(3, dao.readThread("thread-main").map { it.eventId }.distinct().size)
        assertEquals(3, dao.dueOutbox(Long.MAX_VALUE, 10).map { it.eventId }.distinct().size)
    }

    @Test
    fun cancelDeletesManifestAndEncryptedChunks() = runTest {
        val capture = store.createVoiceCapture("thread-main")
        capture.append(ByteArray(32_000) { 7 }, 32_000)
        capture.discard()
        assertEquals(emptyList<File>(), root.listFiles()?.toList() ?: emptyList())
    }

- [x] **Step 2: Run the new tests red**

    Run: android\gradlew.bat :core:chat:testDebugUnitTest --tests "*EncryptedAttachmentStoreTest" --tests "*ChatRepositoryTest"

    Expected: compilation fails because the attachment store and voice repository APIs do not exist.

- [x] **Step 3: Implement ciphertext-only store and outbox bridge**

    Use context.noBackupFilesDir/mina-chat-attachments. A capture directory has only manifest.bin and chunk-000000.bin names. Every append uses AES/GCM/NoPadding with a fresh 12-byte nonce and AAD mina-voice-v1|mediaId|index. The manifest uses AAD mina-voice-v1|mediaId|manifest and stores threadId, key epoch, digest, sizes, duration and optional immutable event IDs as ciphertext.

    val nonce = ByteArray(12).also(secureRandom::nextBytes)
    cipher.init(ENCRYPT_MODE, SecretKeySpec(epochKey, "AES"), GCMParameterSpec(128, nonce))
    cipher.updateAAD(("mina-voice-v1|" + mediaId + "|" + index).encodeToByteArray())
    val sealed = cipher.doFinal(buffer, 0, byteCount)
    writeAtomically(chunkFile(index), nonce + sealed)
    buffer.fill(0, 0, byteCount)

    ChatEngine injects vault::epochKey into the store. ChatRepository protects enqueueVoice with a Mutex, reserves ordered ULIDs in the encrypted manifest before output, emits metadata first, decrypts one chunk at a time and uses the reserved event ID in the established E2EE sealing path. A retry skips an event ID already in Room. Delete the capture directory only after every planned event is durable.

    Order ChatDao.dueOutbox with queued_at_ms ASC then event_id ASC so a same-millisecond manifest ULID is emitted before its chunk ULIDs:

    SELECT * FROM chat_outbox
    WHERE next_attempt_at_ms <= :nowMs
    ORDER BY queued_at_ms ASC, event_id ASC
    LIMIT :limit

- [ ] **Step 4: Run focused Android tests green**

    Run: android\gradlew.bat :core:chat:testDebugUnitTest

    Expected: BUILD SUCCESSFUL. The retry test proves stable event IDs and the source test proves no clear audio artifact.

- [x] **Step 5: Commit**

    git add android/core/chat
    git commit -m "feat(voice): persist captured PCM as encrypted chunks"

### Task 3: Remplacer MediaRecorder par AudioRecord, note et PTT

**Files:**
- Create: android/feature/voice/src/main/kotlin/fr/mina/gateway/feature/voice/VoiceNoteRecorder.kt
- Create: android/feature/voice/src/main/kotlin/fr/mina/gateway/feature/voice/VoiceNoteViewModel.kt
- Create: android/feature/voice/src/main/kotlin/fr/mina/gateway/feature/voice/PcmVoicePlayer.kt
- Create: android/feature/voice/src/test/kotlin/fr/mina/gateway/feature/voice/VoiceNoteRecorderTest.kt
- Create: android/feature/voice/src/test/kotlin/fr/mina/gateway/feature/voice/VoiceNoteViewModelTest.kt
- Delete: android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/VoiceNoteRecorder.kt
- Modify: android/feature/chat/src/androidTest/kotlin/fr/mina/gateway/feature/chat/ChatScreenTest.kt (PTT : le composable est dans ce module)
- Modify: android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ChatScreen.kt
- Modify: android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ChatViewModel.kt

**Interfaces:**
- VoiceNoteRecorder.start(sink), stop(), cancel() exposent Idle, Recording, Completed, Failed et DiscardedTooShort.
- VoiceNoteViewModel.beginNote(), beginPushToTalk(), endPushToTalk(), cancel(), onHostStopped() and retryPendingSend() own UI state.
- PcmVoicePlayer.play(bytes) uses AudioTrack MODE_STREAM and fills bytes in finally.

- [x] **Step 1: Write failing recorder and UI tests**

    @Test
    fun focusRefusedDoesNotStartAudioRecord() = runTest {
        val recorder = recorder(audioFocus = FakeFocus(granted = false))
        assertEquals(VoiceCaptureResult.Failed("voice_audio_focus_refuse"), recorder.start(fakeSink))
        assertEquals(0, fakeAudioRecord.startCalls)
    }

    @Test
    fun captureBelow300MillisecondsIsDiscarded() = runTest {
        val recorder = recorder(clock = { 299L })
        recorder.start(fakeSink)
        assertEquals(VoiceCaptureResult.DiscardedTooShort, recorder.stop())
        assertEquals(0, fakeSink.completed)
        assertEquals(1, fakeSink.discarded)
    }

    @Test
    fun focusLossReadErrorHostStopAndCancelDiscardOnce() = runTest {
        for (stop in listOf(::loseAudioFocus, ::readError, ::hostStop, ::cancel)) {
            val recorder = recorder()
            recorder.start(fakeSink)
            stop(recorder)
            assertEquals(1, fakeSink.discarded)
            assertFalse(recorder.isRecording)
        }
    }

    composeTestRule.onNodeWithContentDescription("Maintenir pour parler").performTouchInput {
        down(center)
        advanceEventTime(500)
        up()
    }
    composeTestRule.onNodeWithText("Note vocale en file").assertExists()

- [x] **Step 2: Run tests red**

    Résultats réellement observés avant les corrections :
    - `:feature:chat:assembleDebugAndroidTest` a échoué car les nouveaux paramètres de `ChatScreen` n'existaient pas encore.
    - le test `focus loss during startup does not open a capture` a échoué avant l'ajout de l'état d'ouverture atomique.

    L'hypothèse initiale « classes inexistantes » n'a pas été rejouée : les classes étaient déjà présentes dans l'arbre de travail au moment de la reprise.

- [x] **Step 3: Implement foreground audio lifecycle**

    val minBuffer = AudioRecord.getMinBufferSize(
        VoicePcmFormat.SAMPLE_RATE_HZ,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
    )
    val recorder = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        VoicePcmFormat.SAMPLE_RATE_HZ,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minBuffer * 2, 32 * 1024),
    )

    Request AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE before AudioRecord.startRecording. A failed request returns voice_audio_focus_refuse. AUDIOFOCUS_LOSS, AUDIOFOCUS_LOSS_TRANSIENT, ERROR_BAD_VALUE, ERROR_DEAD_OBJECT, ERROR_INVALID_OPERATION, uninitialized recorder and ON_STOP all run cancel exactly once.

    The I/O job sends at most 32 000 bytes to sink.append, tracks bytes and duration, completes at 50 MiB or 30 minutes and zeroes its current buffer. It never constructs File, MediaRecorder or MediaPlayer.

    ChatViewModel calls repository.beginVoiceCapture(MAIN_THREAD_ID), then repository.enqueueVoice after recorder completion and engine.start. A local enqueue remains successful PC off. A failed enqueue retains its completed capture for retry.

    ChatScreen retains the current note action but renders Stop and Cancel after start. Add Maintenir pour parler with awaitEachGesture: start on down, stop/send on up, cancel on pointer cancellation. Add LifecycleEventObserver ON_STOP to call onHostStopped. The existing permission launcher is the only RECORD_AUDIO prompt.

    Replace incoming temporary-file playback with PcmVoicePlayer. It accepts only the canonical MIME and writes to AudioTrack MODE_STREAM. It fills the returned ByteArray in finally. A legacy audio/mp4 bubble displays honest unavailable legacy playback and never writes a temporary file.

- [x] **Step 4: Run Android tests green**

    Run: android\gradlew.bat :feature:voice:testDebugUnitTest :feature:chat:testDebugUnitTest :feature:voice:assembleDebugAndroidTest

    Résultat : `:feature:voice:testDebugUnitTest :feature:chat:testDebugUnitTest :feature:voice:assembleDebugAndroidTest :feature:chat:assembleDebugAndroidTest` = `BUILD SUCCESSFUL` (1 min 55 s). L'assemblage d'APK de test n'est pas une validation sur appareil physique.

- [x] **Step 5: Commit**

    git add android/feature/voice android/feature/chat
    git commit -m "feat(voice): capture and queue encrypted PCM notes"

### Task 4: Unifier direct, Firebase et le traitement PCM PC

**Files:**
- Modify: src/chat/voice-transcriber.mjs
- Modify: src/chat/chat-media-handler.mjs
- Modify: src/devices/chat-server.mjs
- Modify: src/devices/chat-relay.mjs
- Modify: src/devices/chat-channel.mjs
- Modify: src/ui/main.mjs
- Modify: tests/voice-transcriber.test.mjs
- Modify: tests/chat-media-handler.test.mjs
- Modify: tests/chat-server.test.mjs
- Modify: tests/chat-relay.test.mjs
- Modify: tests/chat-channel.test.mjs

**Interfaces:**
- createVoiceTranscriber uses pcm16leToFloat32 for canonical PCM and preserves decodeAudio only for legacy formats.
- createChatMediaHandler uses completeOnce(mediaId, work), where work returns the string complete after onComplete resolves.
- createChatRelay receives handleMedia and supplies the same object shape as createChatServer.

- [x] **Step 1: Write failing PC tests**

    it('transcribes verified PCM without renderer IPC', async () => {
      const decodeAudio = vi.fn();
      const transcribe = createVoiceTranscriber({
        enabled: true,
        decodeAudio,
        loadPipeline: async () => async (pcm, options) => ({ text: pcm.length + ':' + options.sampleRate }),
      });
      await expect(transcribe({ audio: Buffer.from([0, 0, 0xff, 0x7f]), mimeType: VOICE_PCM_MIME }))
        .resolves.toBe('2:16000');
      expect(decodeAudio).not.toHaveBeenCalled();
    });

    it('relay sends voice chunks to media handler, not text generation', async () => {
      await relay.handleDocument(encryptedMediaChunk());
      expect(handleMedia).toHaveBeenCalledWith(expect.objectContaining({ type: 'media.chunk' }));
      expect(respond).not.toHaveBeenCalled();
    });

    it('redelivery of one completed mediaId invokes perception once', async () => {
      await completeSameVoiceTwice(handler);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('direct media ACK follows successful handler completion', async () => {
      const pending = deferred();
      const socket = await connectServer({ handleMedia: () => pending.promise });
      socket.send(encryptedMediaChunk());
      expect(await noMessageFor(socket, 20)).toBe(true);
      pending.resolve();
      await expect(nextMessage(socket)).resolves.toMatchObject({ type: 'ack' });
    });

- [x] **Step 2: Run tests red**

    Run: npx vitest run tests/voice-transcriber.test.mjs tests/chat-media-handler.test.mjs tests/chat-server.test.mjs tests/chat-relay.test.mjs tests/chat-channel.test.mjs

    Résultat observé : 5 échecs ciblés et 37 tests existants verts : ACK direct anticipé, relais ne routant pas v2, traitement/perception doublé, et PCM passant encore par le décodeur renderer.

- [x] **Step 3: Implement a single verified media path**

    const decoded = isVoicePcmMime(mimeType)
      ? { pcm: pcm16leToFloat32(audio), sampleRate: 16_000 }
      : await decodeAudio({ bytesBase64: audio.toString('base64'), mimeType });

    In createChatMediaHandler, call completeOnce after assembler.finalize and encrypted store.save. Its work awaits onComplete and returns complete. A replay does not call perception or response generation.

    In chat-server, decode with verifyAndDecryptBytes then decodeChatPayload. For payload.version 2, await handleMedia before ACK and return without respond. Preserve the text ACK and ledger flow exactly.

    In chat-relay, use verifyAndDecryptBytes and decodeChatPayload. For payload.version 2, await handleMedia, remove the Firestore document only after success and return without a text reply. In chat-channel, pass one handler instance and completeOnce backed by ledger.once("media:" + mediaId, work) to server and relay.

    Keep renderer decode IPC in ui/main.mjs exclusively for compressed legacy audio. Canonical PCM remains inside the PC process after digest verification.

- [x] **Step 4: Run PC tests green**

    Run: npx vitest run tests/voice-pcm.test.mjs tests/voice-transcriber.test.mjs tests/chat-media-handler.test.mjs tests/chat-server.test.mjs tests/chat-relay.test.mjs tests/chat-channel.test.mjs tests/chat-media-perception.test.mjs

    Résultat : 8 fichiers / 75 tests verts. Cela prouve les contrats locaux direct/relais, pas un runtime Firebase déployé.

- [x] **Step 5: Commit**

    git add src/chat src/devices src/ui/main.mjs tests
    git commit -m "feat(voice): process encrypted PCM notes once on PC"

### Task 5: Vérifier, réconcilier et distinguer le téléphone réel

**Files:**
- Modify: docs/superpowers/execution/2026-07-29-mina-native-chat-scope-ledger.md
- Modify: docs/superpowers/execution/2026-08-02-mina-remaining-work.md seulement si une affirmation d'état courant devient factuellement fausse.

- [x] **Step 1: Run full automated gates**

    Run: android\gradlew.bat :core:protocol:testDebugUnitTest :core:chat:testDebugUnitTest :feature:voice:testDebugUnitTest :feature:chat:testDebugUnitTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon --max-workers=1 --console=plain

    Expected: BUILD SUCCESSFUL. Record exact lint errors and keep pre-existing warnings distinct.

    Run: npx vitest run tests/voice-pcm.test.mjs tests/media-chunker.test.mjs tests/voice-transcriber.test.mjs tests/chat-media-handler.test.mjs tests/chat-server.test.mjs tests/chat-relay.test.mjs tests/chat-channel.test.mjs tests/chat-media-perception.test.mjs

    Expected: all listed tests pass.

    Résultat 2026-08-09 : la gate Android a fini avec `BUILD SUCCESSFUL in 4m 27s`
    (`343` tâches actionnables) et la gate PC avec `8` fichiers / `75` tests verts.

- [x] **Step 2: Run source and diff safety checks**

    Run: rg -n "createTempFile|MediaRecorder|\\.m4a|\\.wav|\\.pcm" android/feature/chat android/feature/voice android/core/chat

    Expected: no capture or playback implementation creates a clear audio file. A legacy UI label is not a file operation.

    Run: git diff --check

    Expected: no whitespace error.

    Résultat 2026-08-09 : aucune correspondance pour les APIs/fichiers audio temporaires
    `createTempFile|MediaPlayer|setOutputFile|setOutputFormat|setAudioEncoder|.m4a|.wav|.pcm`.
    Le seul usage de `MediaRecorder` est sa constante `AudioSource.VOICE_RECOGNITION` pour
    `AudioRecord`; le contrôle `git diff --check` est vert.

- [ ] **Step 3: Perform physical validation only with an attached device**

    Run: adb devices -l

    Expected: a nonempty device row. No row means physical validation is not executed.

    On a connected test phone, manually deny RECORD_AUDIO, accept then cancel, record below 300 ms, release PTT, background the app while recording, induce audio focus loss, send with PC off, restart PC and verify one transcription and one response. Do not reinstall the user's reference APK or overwrite its local secret configuration.

    Résultat 2026-08-09 : `adb devices -l` n'a retourné aucune ligne appareil. La validation
    physique n'a donc pas été exécutée.

- [x] **Step 4: Update evidence-based ledger and commit**

    Mark Task 20 partial only after the source scan and automated gates are green. Keep Task 21 unchecked. If adb has no device row, state exactly that physical validation is pending.

    git add docs/superpowers/execution
    git commit -m "docs(voice): reconcile encrypted note verification"

## Self-review

### Spec coverage

- Foreground PCM16 capture, immediate encryption, no clear temporary audio and all recording limits are handled by Tasks 1 to 3.
- Separate note and PTT controls, offline outbox and lifecycle/focus cancellation are handled by Task 3.
- Verified PC processing, PC-only local STT, direct/Firebase parity and durable idempotence are handled by Task 4.
- Automated evidence and conditional physical testing are handled by Task 5. Live voice remains Task 21 and is not counted here.

### Placeholder scan

No step defers an implementation behind a marker, generic wording or an undeclared type. Each introduced API is declared in the Files and Interfaces sections and has a red-test command, implementation instructions and a green-test command.

### Type consistency

VoicePcmFormat.MIME and VOICE_PCM_MIME use the same literal. ChatRepository.beginVoiceCapture produces EncryptedVoiceAttachmentSink, VoiceNoteRecorder consumes it, complete produces StoredVoiceAttachment and ChatRepository.enqueueVoice queues it. completeOnce consistently receives mediaId plus work returning complete.
