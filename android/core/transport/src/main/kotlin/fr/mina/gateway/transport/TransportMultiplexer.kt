package fr.mina.gateway.transport

enum class QueueKind { CONTROL, MESSAGE, MEDIA }
enum class TransportType { USB, LAN, FIREBASE }

data class TransportEnvelope(val id: String)
data class DeliveryReceipt(val envelopeId: String, val accepted: Boolean)

interface TransportEndpoint {
    val endpointId: String
    val type: TransportType
    fun send(envelope: TransportEnvelope): DeliveryReceipt
}

class TransportMultiplexer(private val capacities: Map<QueueKind, Int>) {
    private data class EndpointState(val endpoint: TransportEndpoint, var healthy: Boolean = true)
    private data class Queued(val queue: QueueKind, val envelope: TransportEnvelope, var canceled: Boolean = false)

    private val endpoints = mutableMapOf<String, EndpointState>()
    private val queues = QueueKind.entries.associateWith { ArrayDeque<Queued>() }
    private val delivered = mutableSetOf<String>()
    private var deviceId: String? = null

    init {
        require(QueueKind.entries.all { (capacities[it] ?: 0) > 0 }) { "transport_capacities_invalid" }
    }

    @Synchronized
    fun connect(endpoint: TransportEndpoint, signedDeviceId: String, verified: Boolean) {
        require(verified) { "transport_peer_untrusted" }
        require(signedDeviceId.matches(Regex("^[A-Za-z0-9._:-]{1,160}$"))) { "transport_device_id_invalid" }
        require(deviceId == null || deviceId == signedDeviceId) { "transport_peer_identity_conflict" }
        require(endpoint.endpointId.matches(Regex("^[A-Za-z0-9._:-]{1,160}$"))) { "transport_endpoint_invalid" }
        deviceId = signedDeviceId
        endpoints[endpoint.endpointId] = EndpointState(endpoint)
    }

    @Synchronized
    fun enqueue(queue: QueueKind, envelope: TransportEnvelope): Boolean {
        require(envelope.id.matches(Regex("^[A-Za-z0-9._:-]{1,160}$"))) { "transport_envelope_id_invalid" }
        if (envelope.id in delivered || queues.values.any { items -> items.any { it.envelope.id == envelope.id } }) return false
        val target = checkNotNull(queues[queue])
        check(target.size < checkNotNull(capacities[queue])) { "transport_backpressure:${queue.name.lowercase()}" }
        target.addLast(Queued(queue, envelope))
        return true
    }

    @Synchronized
    fun cancel(envelopeId: String): Boolean {
        for (queue in queues.values) {
            val item = queue.firstOrNull { it.envelope.id == envelopeId }
            if (item != null) {
                item.canceled = true
                return true
            }
        }
        return false
    }

    @Synchronized
    fun drainOne(): DeliveryReceipt {
        val queued = sequenceOf(QueueKind.CONTROL, QueueKind.MESSAGE, QueueKind.MEDIA)
            .mapNotNull { kind -> queues[kind]?.removeFirstOrNull() }
            .firstOrNull { !it.canceled }
            ?: error("transport_queue_empty")
        val candidates = endpoints.values.filter { it.healthy }.sortedWith(
            compareBy<EndpointState> { it.endpoint.type.ordinal }.thenBy { it.endpoint.endpointId },
        )
        check(candidates.isNotEmpty()) { "transport_unavailable" }
        var lastFailure: Exception? = null
        for (candidate in candidates) {
            try {
                val receipt = candidate.endpoint.send(queued.envelope)
                check(receipt.accepted && receipt.envelopeId == queued.envelope.id) { "transport_receipt_invalid" }
                delivered += queued.envelope.id
                return receipt
            } catch (error: Exception) {
                candidate.healthy = false
                lastFailure = error
            }
        }
        throw IllegalStateException("transport_delivery_failed", lastFailure)
    }
}
