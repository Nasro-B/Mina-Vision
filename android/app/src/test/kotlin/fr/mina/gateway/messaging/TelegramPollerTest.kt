package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Test

class TelegramPollerTest {
    @Test
    fun persistsOnlyOwnerMessagesAndAdvancesOffsetAfterPersistence() {
        var offset = 10L
        val persisted = mutableListOf<TelegramUpdate>()
        val pairingCandidates = mutableListOf<TelegramUpdate>()
        val source = TelegramUpdateSource { _, requestedOffset ->
            assertEquals(offset, requestedOffset)
            listOf(
                TelegramUpdate(10L, 999L, 1L, "intrus", null, 1000L),
                TelegramUpdate(11L, 111L, 2L, "Salut Mina", null, 2000L),
            )
        }
        val offsets = object : TelegramOffsetStore {
            override fun load(): Long = offset
            override fun save(nextOffset: Long) { offset = nextOffset }
        }
        val poller = TelegramPoller(
            owner = OwnerIdentity("+33600000000", setOf(111L, 222L)),
            source = source,
            sink = TelegramUpdateSink { persisted += it },
            offsets = offsets,
            unknownStartSink = TelegramUpdateSink { pairingCandidates += it },
        )

        poller.pollOnce("123456789:abcdefghijklmnopqrstuvwxyz".toCharArray())

        assertEquals(listOf(11L), persisted.map { it.updateId })
        assertEquals(emptyList<Long>(), pairingCandidates.map { it.updateId })
        assertEquals(12L, offset)
    }

    @Test
    fun persistsAnUnknownStartAsALocalPairingCandidateWithoutAuthorizingIt() {
        var offset = 20L
        val accepted = mutableListOf<TelegramUpdate>()
        val candidates = mutableListOf<TelegramUpdate>()
        val source = TelegramUpdateSource { _, _ ->
            listOf(
                TelegramUpdate(20L, 999L, 999L, "/start", null, 1000L),
                TelegramUpdate(21L, 998L, 998L, "bonjour", null, 2000L),
            )
        }
        val offsets = object : TelegramOffsetStore {
            override fun load(): Long = offset
            override fun save(nextOffset: Long) { offset = nextOffset }
        }
        val poller = TelegramPoller(
            owner = OwnerIdentity("+33600000000", setOf(111L)),
            source = source,
            sink = TelegramUpdateSink { accepted += it },
            offsets = offsets,
            unknownStartSink = TelegramUpdateSink { candidates += it },
        )

        poller.pollOnce("123456789:abcdefghijklmnopqrstuvwxyz".toCharArray())

        assertEquals(emptyList<Long>(), accepted.map { it.updateId })
        assertEquals(listOf(20L), candidates.map { it.updateId })
        assertEquals(22L, offset)
    }
}
