package fr.mina.gateway.chat

import com.google.firebase.database.ChildEventListener
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import fr.mina.gateway.protocol.AssistantResponseFrame
import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.ChatEventCodec
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

private const val MAX_CIPHERTEXT_CHARS = 16_384
private const val MAX_TTL_MS = 10L * 60L * 1_000L
private const val MAX_SEQUENCE = 999
private val IDENTIFIER = Regex("^[A-Za-z0-9._:-]{1,160}$")
private val ULID = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")

/** Trame RTDB transitoire : l'enveloppe mina_app reste chiffrée et signée dans [ciphertext]. */
data class FirebaseResponseStreamFrame(
    val sequence: Int,
    val ciphertext: String,
    val expiresAtMs: Long,
)

fun interface FirebaseResponseStreamSubscription {
    fun close()
}

/** Frontière testable du SDK RTDB : l'authentification reste celle de la session Firebase existante. */
interface FirebaseResponseStreamSource {
    fun watch(
        ownerId: String,
        responseId: String,
        onFrame: (FirebaseResponseStreamFrame) -> Unit,
        onError: () -> Unit,
    ): FirebaseResponseStreamSubscription
}

private class FirebaseDatabaseResponseStreamSource(
    private val database: FirebaseDatabase = FirebaseDatabase.getInstance(),
) : FirebaseResponseStreamSource {
    override fun watch(
        ownerId: String,
        responseId: String,
        onFrame: (FirebaseResponseStreamFrame) -> Unit,
        onError: () -> Unit,
    ): FirebaseResponseStreamSubscription {
        val reference = database.reference
            .child("streams")
            .child(ownerId)
            .child(responseId)
            .child("frames")
        val listener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) {
                val sequence = (snapshot.child("sequence").value as? Number)?.toLong() ?: return
                val expiresAtMs = (snapshot.child("expiresAt").value as? Number)?.toLong() ?: return
                val ciphertext = snapshot.child("ciphertext").value as? String ?: return
                if (sequence !in 1L..MAX_SEQUENCE.toLong() || snapshot.key != sequence.toString()) return
                onFrame(FirebaseResponseStreamFrame(sequence.toInt(), ciphertext, expiresAtMs))
            }

            override fun onCancelled(error: DatabaseError) = onError()
            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onChildRemoved(snapshot: DataSnapshot) = Unit
        }
        reference.addChildEventListener(listener)
        return FirebaseResponseStreamSubscription { reference.removeEventListener(listener) }
    }
}

/**
 * Lit les fragments RTDB sans jamais déchiffrer ni persister leur contenu.
 * La signature est encore vérifiée par [ChatEngine] avant que l'événement atteigne le dépôt.
 */
class FirebaseResponseStream(
    private val source: FirebaseResponseStreamSource = FirebaseDatabaseResponseStreamSource(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()
    private val subscriptions = mutableMapOf<String, PendingSubscription>()

    fun watchFrames(
        ownerId: String,
        responseId: String,
        afterSequence: Int = 0,
        onEvent: (ChatEvent) -> Unit,
    ) {
        require(IDENTIFIER.matches(ownerId)) { "firebase_response_stream_owner_invalid" }
        require(ULID.matches(responseId)) { "firebase_response_stream_response_invalid" }
        require(afterSequence in 0..MAX_SEQUENCE) { "firebase_response_stream_cursor_invalid" }
        stop(responseId)
        val pending = PendingSubscription()
        synchronized(lock) { subscriptions[responseId] = pending }
        val subscription = try {
            source.watch(
                ownerId = ownerId,
                responseId = responseId,
                onFrame = { frame ->
                    if (frame.sequence > afterSequence) decodeFrame(frame)?.let(onEvent)
                },
                onError = { cancel(responseId, pending) },
            )
        } catch (error: Exception) {
            cancel(responseId, pending)
            throw error
        }
        val closeNow = synchronized(lock) {
            pending.subscription = subscription
            pending.cancelled
        }
        if (closeNow) subscription.close()
    }

    fun stop(responseId: String) {
        val pending = synchronized(lock) { subscriptions.remove(responseId) }
        close(pending)
    }

    fun stopAll() {
        val active = synchronized(lock) {
            subscriptions.values.toList().also { subscriptions.clear() }
        }
        active.forEach(::close)
    }

    private fun cancel(responseId: String, pending: PendingSubscription) {
        val active = synchronized(lock) {
            if (subscriptions[responseId] !== pending) null else subscriptions.remove(responseId)
        }
        close(active)
    }

    private fun close(pending: PendingSubscription?) {
        val subscription = synchronized(lock) {
            pending?.cancelled = true
            pending?.subscription
        }
        subscription?.close()
    }

    private fun decodeFrame(frame: FirebaseResponseStreamFrame): ChatEvent? {
        val current = now()
        if (frame.sequence !in 1..MAX_SEQUENCE
            || frame.expiresAtMs <= current
            || frame.expiresAtMs > current + MAX_TTL_MS
            || frame.ciphertext.length !in 1..MAX_CIPHERTEXT_CHARS
        ) return null
        val bytes = decodeCanonicalBase64(frame.ciphertext) ?: return null
        return try {
            val event = ChatEventCodec.decode(decodeUtf8(bytes))
            if (event.routingClass != "stream" || event.expiresAtMs <= current) null else event
        } catch (_: Exception) {
            null
        } finally {
            bytes.fill(0)
        }
    }

    private fun decodeCanonicalBase64(value: String): ByteArray? = try {
        val bytes = Base64.getDecoder().decode(value)
        if (Base64.getEncoder().encodeToString(bytes) == value) bytes else null
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun decodeUtf8(bytes: ByteArray): String = try {
        StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
            throw IllegalArgumentException("firebase_response_stream_utf8_invalid")
    }

    private class PendingSubscription {
        var cancelled = false
        var subscription: FirebaseResponseStreamSubscription? = null
    }
}

/** Raccorde le `started` signé au flux RTDB sans jamais créer une session Firebase. */
internal class FirebaseResponseStreamController(
    private val deviceId: String,
    private val stream: FirebaseResponseStream?,
    private val resolveSession: (String, (FcmSyncTarget?) -> Unit) -> Unit = { expectedDeviceId, callback ->
        FirebaseFcmSession.resolve(expectedDeviceId, callback)
    },
    private val onEvent: (ChatEvent) -> Unit,
) {
    private val activeResponses = ConcurrentHashMap<String, String>()

    fun accept(frame: AssistantResponseFrame) {
        when (frame.type) {
            "assistant.response.started" -> {
                activeResponses[frame.responseId] = frame.sourceEventId
                resolveSession(deviceId) { target ->
                    if (target != null
                        && target.deviceId == deviceId
                        && activeResponses[frame.responseId] == frame.sourceEventId
                    ) {
                        stream?.watchFrames(
                            ownerId = target.ownerId,
                            responseId = frame.responseId,
                            afterSequence = frame.sequence,
                            onEvent = onEvent,
                        )
                    }
                }
            }
            "assistant.response.completed", "assistant.response.failed" -> {
                if (activeResponses.remove(frame.responseId, frame.sourceEventId)) stream?.stop(frame.responseId)
            }
        }
    }

    fun stopAll() {
        activeResponses.clear()
        stream?.stopAll()
    }
}
