package fr.mina.gateway.messaging

fun interface TelegramUpdateSource {
    fun poll(token: CharArray, offset: Long): List<TelegramUpdate>
}

fun interface TelegramUpdateSink {
    fun persist(update: TelegramUpdate)
}

interface TelegramOffsetStore {
    fun load(): Long
    fun save(nextOffset: Long)
}

class TelegramPoller(
    private val owner: OwnerIdentity,
    private val source: TelegramUpdateSource,
    private val sink: TelegramUpdateSink,
    private val offsets: TelegramOffsetStore,
    private val unknownStartSink: TelegramUpdateSink? = null,
) {
    fun pollOnce(token: CharArray): Int {
        var offset = offsets.load()
        var accepted = 0
        source.poll(token, offset)
            .asSequence()
            .filter { it.updateId >= offset }
            .sortedBy { it.updateId }
            .forEach { update ->
                if (owner.ownsTelegram(update.senderUserId)) {
                    sink.persist(update)
                    accepted += 1
                } else if (update.text?.trim()?.startsWith("/start") == true) {
                    unknownStartSink?.persist(update)
                }
                offset = update.updateId + 1
                offsets.save(offset)
            }
        return accepted
    }
}

class BotApiUpdateSource(private val client: TelegramApiClient) : TelegramUpdateSource {
    override fun poll(token: CharArray, offset: Long): List<TelegramUpdate> =
        client.getUpdates(token, offset)
}
