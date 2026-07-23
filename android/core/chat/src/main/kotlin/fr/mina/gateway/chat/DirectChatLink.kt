package fr.mina.gateway.chat

import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.ChatEventCodec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Ce que l'interface a le droit de dire sur le lien — jamais « connecté » par optimisme. */
enum class LinkState { OFFLINE, CONNECTING, ONLINE, REFUSED }

/**
 * Lien DIRECT avec le PC sur le réseau local (WebSocket).
 *
 * C'est le chemin normal : le message va du téléphone au PC sans passer par un tiers. Quand il
 * échoue, l'appelant garde son message en outbox — on ne bascule jamais sur un substitut qui
 * répondrait à la place de Mina.
 */
class DirectChatLink(
    private val settings: ChatSettings,
    private val deviceId: String,
    private val onEvent: (ChatEvent) -> Unit,
    private val onAck: (String) -> Unit,
    /** Répond au challenge du PC : (challenge) -> objet hello signé, ou null si impossible. */
    private val buildHello: (String) -> JSONObject?,
    /** Reçoit la clé d'époque enveloppée que seul cet appareil peut ouvrir. */
    private val onEpochOffer: (JSONObject) -> Unit,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
) {
    private val stateFlow = MutableStateFlow(LinkState.OFFLINE)
    val state: StateFlow<LinkState> get() = stateFlow

    private var socket: WebSocket? = null
    private var lastError: String? = null

    /** Détail du dernier échec — affiché tel quel, sans reformulation rassurante. */
    fun lastError(): String? = lastError

    fun connect() {
        val endpoint = settings.endpoint() ?: run {
            lastError = "Aucun PC appairé"
            stateFlow.value = LinkState.OFFLINE
            return
        }
        if (stateFlow.value == LinkState.CONNECTING || stateFlow.value == LinkState.ONLINE) return

        stateFlow.value = LinkState.CONNECTING
        val request = Request.Builder()
            .url("$endpoint/mina-chat")
            .header("X-Mina-Device", deviceId)
            .header("X-Mina-Protocol", "mina_app/2")
            .build()

        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                lastError = null
                // Socket ouverte ≠ session autorisée : on reste CONNECTING tant que le PC
                // n'a pas accepté notre identité et livré la clé d'époque.
                stateFlow.value = LinkState.CONNECTING
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "challenge" -> {
                            val hello = buildHello(json.getString("challenge"))
                            if (hello == null) {
                                lastError = "Identité de cet appareil indisponible"
                                webSocket.close(1000, "identite_indisponible")
                            } else {
                                webSocket.send(hello.toString())
                            }
                        }
                        "epoch" -> {
                            onEpochOffer(json)
                            stateFlow.value = LinkState.ONLINE
                        }
                        "refused" -> {
                            lastError = refusalText(json.optString("reason"))
                            stateFlow.value = LinkState.REFUSED
                        }
                        "rejected" -> lastError = refusalText(json.optString("reason"))
                        "ack" -> onAck(json.getString("eventId"))
                        // Sans type reconnu, c'est un événement de conversation.
                        else -> onEvent(ChatEventCodec.decode(json))
                    }
                }.onFailure { lastError = "Message du PC illisible : ${it.message}" }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                lastError = t.message ?: "connexion refusée"
                // 401/403 : le PC nous connaît mais nous refuse — c'est autre chose qu'être hors ligne.
                stateFlow.value = if (response?.code == 401 || response?.code == 403) LinkState.REFUSED else LinkState.OFFLINE
                socket = null
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                stateFlow.value = LinkState.OFFLINE
                socket = null
            }
        })
    }

    /** Renvoie vrai seulement si l'envoi a réellement été remis à la socket. */
    fun send(event: ChatEvent): Boolean {
        val open = socket ?: return false
        if (stateFlow.value != LinkState.ONLINE) return false
        return runCatching { open.send(ChatEventCodec.encode(event).toString()) }
            .onFailure { lastError = it.message }
            .getOrDefault(false)
    }

    /** Traduit le motif brut du PC en phrase lisible — sans jamais l'adoucir. */
    private fun refusalText(reason: String): String = when (reason) {
        "appairage_ferme" -> "Le PC n'est pas en mode appairage. Ouvrez l'appairage côté Windows."
        "code_incorrect" -> "Code d'appairage incorrect."
        "trop_de_tentatives" -> "Trop de tentatives : l'appairage a été refermé."
        "trop_d_appareils" -> "Le PC a atteint son nombre maximal d'appareils."
        "appareil_revoque" -> "Cet appareil a été révoqué sur le PC."
        "cle_appareil_changee" -> "La clé de cet appareil a changé : réappairage nécessaire."
        "preuve_invalide", "challenge_inattendu" -> "Le PC n'a pas reconnu l'identité de cet appareil."
        "evenement_expire" -> "Message trop ancien pour être traité."
        "chat_signature_invalide" -> "Message rejeté : signature invalide."
        "" -> "Refusé par le PC."
        else -> "Refusé par le PC ($reason)."
    }

    fun disconnect() {
        socket?.close(1000, "fermeture demandée")
        socket = null
        stateFlow.value = LinkState.OFFLINE
    }
}
