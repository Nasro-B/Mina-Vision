package fr.mina.gateway.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Miroir des tests Node : mêmes garanties d'ordre, de non-recul et d'unicité. */
class MonotonicUlidTest {
    private val fixedTime = 1_784_732_400_000L

    @Test
    fun `produit 26 caracteres Crockford Base32`() {
        val ulid = MonotonicUlid(now = { fixedTime }).next()
        assertTrue(Regex("^[0-9A-HJKMNP-TV-Z]{26}$").matches(ulid))
    }

    @Test
    fun `garde l ordre lexical sur 1000 generations dans la meme milliseconde`() {
        val generator = MonotonicUlid(now = { fixedTime })
        val ids = (1..1_000).map { generator.next() }
        assertEquals(ids.sorted(), ids)
        assertEquals(1_000, ids.toSet().size)
    }

    @Test
    fun `ne recule jamais quand l horloge recule`() {
        var clock = fixedTime
        val generator = MonotonicUlid(now = { clock })
        val before = generator.next()
        clock -= 60_000 // NTP ou changement d'heure
        val after = generator.next()
        assertTrue(after > before)
        assertEquals(MonotonicUlid.decodeTime(before), MonotonicUlid.decodeTime(after))
    }

    @Test
    fun `n entre pas en collision sur 100000 identifiants`() {
        val generator = MonotonicUlid()
        val ids = HashSet<String>()
        repeat(100_000) { ids.add(generator.next()) }
        assertEquals(100_000, ids.size)
    }

    @Test
    fun `signale la saturation d entropie au lieu de boucler`() {
        val generator = MonotonicUlid(
            now = { fixedTime },
            randomBytes = { size -> ByteArray(size) { 0xff.toByte() } },
        )
        generator.next()
        assertThrows(IllegalArgumentException::class.java) { generator.next() }
    }

    @Test
    fun `encode le temps de facon relisible`() {
        val ulid = MonotonicUlid(now = { fixedTime }).next()
        assertEquals(fixedTime, MonotonicUlid.decodeTime(ulid))
    }
}
