package fr.mina.gateway.chat

import android.content.Context
import androidx.room.Room
import fr.mina.gateway.protocol.ChatCrypto
import fr.mina.gateway.protocol.ChatEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Assemble une fois pour toutes les pièces du chat : base chiffrée, coffre de clés, signature,
 * lien direct et boucle d'envoi. L'interface ne connaît que ce point d'entrée.
 */
class ChatEngine private constructor(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val settings = ChatSettings(appContext)
    val vault = ChatKeyVault(appContext)
    private val signer = ChatSigner()

    private val database = Room.databaseBuilder(appContext, ChatDatabase::class.java, ChatDatabase.NAME)
        .build()

    val deviceId: String = fr.mina.gateway.transport.DeviceIdentityStore(appContext).deviceId()

    val repository = ChatRepository(
        dao = database.chatDao(),
        deviceId = deviceId,
        epochKeyProvider = { epoch -> vault.epochKey(epoch) },
        currentEpoch = { vault.currentEpoch() },
        signEvent = { event -> signer.sign(event) },
        peerAcceptsMedia = { settings.pcSupportsMedia() },
    )

    /** Clé publique du PC telle qu'enregistrée à l'appairage — null tant qu'il n'y a pas d'appairage. */
    private fun pcPublicKey(): PublicKey? = settings.pcPublicKeySpki()?.let { spki ->
        runCatching {
            KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(spki)))
        }.getOrNull()
    }

    /** Code d'appairage saisi par l'utilisateur, valable pour la prochaine poignée de main. */
    @Volatile
    private var pendingPairingCode: String? = null

    private val link = DirectChatLink(
        settings = settings,
        deviceId = deviceId,
        onEvent = { event -> scope.launch { acceptFromPc(event) } },
        onAck = { eventId -> scope.launch { repository.markDelivered(eventId, DeliveryState.PC_RECEIVED) } },
        buildHello = { challenge -> buildHello(challenge) },
        onEpochOffer = { offer -> installEpoch(offer) },
    )

    /**
     * Prouve au PC la possession de la clé privée de cet appareil, pour CE challenge précis.
     * Une preuve capturée ne vaut donc rien lors d'une connexion suivante.
     */
    private fun buildHello(challenge: String): JSONObject? = runCatching {
        val proof = fr.mina.gateway.transport.DeviceIdentityStore(appContext).createProof(challenge)
        JSONObject()
            .put("type", "hello")
            .put("deviceId", proof.deviceId)
            .put("publicKeySpki", proof.publicKeySpkiBase64)
            .put("challenge", challenge)
            .put("signature", proof.signatureBase64)
            .apply { pendingPairingCode?.let { put("pairingCode", it) } }
    }.getOrNull()

    /**
     * Ouvre la clé d'époque envoyée par le PC. Le désenveloppement n'est possible que si la clé
     * dérivée par ECDH correspond : un PC usurpé produirait un blob qui refuse de s'ouvrir.
     */
    private fun installEpoch(offer: JSONObject) = runCatching {
        val pcKeySpki = offer.optString("pcPublicKeySpki").takeIf { it.isNotBlank() }
            ?: settings.pcPublicKeySpki()
            ?: return@runCatching
        val pcKey = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(pcKeySpki)))
        val keyEpoch = offer.getInt("keyEpoch")
        val wrapKey = ChatCrypto.deriveDeviceWrapKey(signer.privateKey, pcKey, deviceId)
        val epochKey = ChatCrypto.unwrapEpochKey(
            deviceWrapKey = wrapKey,
            wrapped = ChatCrypto.WrappedEpochKey(
                keyEpoch = keyEpoch,
                nonce = offer.getString("nonce"),
                ciphertext = offer.getString("ciphertext"),
                authTag = offer.getString("authTag"),
            ),
            deviceId = deviceId,
            keyEpoch = keyEpoch,
        )
        wrapKey.fill(0)
        vault.installEpochKey(keyEpoch, epochKey)
        // Capacité média négociée : le PC liste les versions de payload qu'il sait traiter.
        // Présent et contenant 2 => pièces jointes OK ; présent sans 2 => refus honnête à l'envoi.
        // Absent (message inattendu) => on ne dégrade pas une capacité déjà acquise.
        offer.optJSONArray("payloadVersions")?.let { versions ->
            var media = false
            for (i in 0 until versions.length()) if (versions.optInt(i) == 2) media = true
            settings.setPcSupportsMedia(media)
        }
        // La clé du PC n'est mémorisée qu'APRÈS un désenveloppement réussi : une clé qui
        // n'ouvre rien ne mérite pas d'être conservée comme référence.
        if (settings.pcPublicKeySpki() != pcKeySpki) {
            settings.pair(settings.host().orEmpty(), settings.port(), pcKeySpki, System.currentTimeMillis())
        }
        pendingPairingCode = null
    }.getOrNull()

    /**
     * Relais de secours. Il n'est construit que si Firebase est réellement disponible dans
     * l'application : sans google-services.json, l'objet reste null et le canal fonctionne en
     * direct SEUL — sans prétendre avoir un secours.
     */
    private val relay: FirebaseChatRelay? = runCatching {
        FirebaseChatRelay(
            deviceId = deviceId,
            onEvent = { event -> scope.launch { acceptFromPc(event) } },
        )
    }.getOrNull()

    private val syncLoop = ChatSyncLoop(
        dao = database.chatDao(),
        link = link,
        scope = scope,
        relay = relay,
    )

    /** Vrai si le secours Firebase est réellement prêt (session ouverte), pas seulement présent. */
    fun relayReady(): Boolean = relay?.isReady() == true

    fun relayError(): String? = relay?.lastError

    val linkState: StateFlow<LinkState> get() = link.state

    fun lastLinkError(): String? = link.lastError()

    fun start() {
        if (!settings.isPaired()) return
        link.connect()
        syncLoop.start()
        // Le relais s'arme en parallèle du direct : c'est justement quand le direct échoue
        // qu'on en a besoin, il ne peut donc pas dépendre de sa réussite.
        relay?.ensureSession { ready -> if (ready) relay.watch() }
    }

    fun stop() {
        syncLoop.stop()
        link.disconnect()
        relay?.stop()
    }

    /**
     * Réveil ponctuel en arrière-plan (FCM / WorkManager) : vide l'outbox une fois et s'assure que
     * le relais écoute, SANS démarrer les boucles longues. Sûr à appeler hors de tout écran ouvert.
     * Retourne le nombre de messages drainés. Ne fait rien si aucun PC n'est appairé.
     */
    suspend fun syncOnce(): Int {
        if (!settings.isPaired()) return 0
        relay?.ensureSession { ready -> if (ready) relay.watch() }
        return runCatching { syncLoop.drainOnce() }.getOrDefault(0)
    }

    /**
     * Un événement venu du PC n'est accepté que s'il est SIGNÉ par la clé enregistrée à
     * l'appairage. Sans clé connue, on refuse : accepter un message non vérifié reviendrait à
     * afficher comme « Mina » ce que n'importe quel appareil du réseau aurait pu écrire.
     */
    private suspend fun acceptFromPc(event: ChatEvent) {
        val key = pcPublicKey() ?: return
        if (!signer.verify(event, key)) return
        if (event.senderDeviceId == deviceId) return
        val known = database.chatDao().findEvent(event.eventId) != null
        repository.ingest(event, fromAssistant = true)
        // Notifier UNIQUEMENT sur un événement nouveau : une retransmission ne doit pas
        // rappeler une deuxième fois pour le même message.
        if (!known) {
            repository.readMessage(event.eventId)?.let { message -> onAssistantMessage?.invoke(message) }
        }
    }

    /** Prévenu à chaque NOUVELLE réponse de Mina — sert à poser une notification. */
    @Volatile
    var onAssistantMessage: ((ChatMessage) -> Unit)? = null

    /**
     * Appairage : enregistre l'adresse du PC et présente le code affiché sur Windows. La clé du
     * PC arrive avec la clé d'époque, une fois l'identité acceptée.
     */
    fun pair(host: String, port: Int, pairingCode: String?, atMs: Long = System.currentTimeMillis()) {
        settings.pair(host, port, settings.pcPublicKeySpki(), atMs)
        pendingPairingCode = pairingCode?.trim()?.takeIf { it.isNotEmpty() }
        start()
    }

    fun unpair() {
        stop()
        settings.unpair()
    }

    companion object {
        @Volatile
        private var instance: ChatEngine? = null

        fun get(context: Context): ChatEngine =
            instance ?: synchronized(this) {
                instance ?: ChatEngine(context).also { instance = it }
            }
    }
}
