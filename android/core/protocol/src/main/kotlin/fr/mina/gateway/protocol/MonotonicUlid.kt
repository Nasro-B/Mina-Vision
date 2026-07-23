package fr.mina.gateway.protocol

import java.security.SecureRandom

/**
 * Générateur d'identifiants ULID MONOTONES — miroir exact de `src/contracts/event-id.mjs`.
 *
 * 48 bits de temps + 80 bits d'aléa, Crockford Base32 (26 caractères).
 *
 * Deux garanties indispensables :
 *   1. l'ordre lexical suit l'ordre de création, même pour des milliers d'événements dans la
 *      MÊME milliseconde (les 80 bits sont incrémentés, pas retirés au hasard) ;
 *   2. si l'horloge système RECULE, l'identifiant ne recule jamais — sinon l'ordre du journal
 *      casserait et un événement déjà traité pourrait réapparaître.
 *
 * L'état est protégé par `synchronized` : plusieurs coroutines peuvent générer en parallèle.
 */
class MonotonicUlid(
    private val now: () -> Long = System::currentTimeMillis,
    private val randomBytes: (Int) -> ByteArray = { size ->
        ByteArray(size).also { secureRandom.nextBytes(it) }
    },
) {
    private var lastTime = -1L
    private var lastRandom = ByteArray(RANDOM_BYTES)

    @Synchronized
    fun next(): String {
        val currentTime = now()
        require(currentTime >= 0) { "ulid_horloge_invalide" }

        if (currentTime > lastTime) {
            lastTime = currentTime
            lastRandom = randomBytes(RANDOM_BYTES).copyOf(RANDOM_BYTES)
        } else {
            // Même milliseconde OU horloge qui recule : on conserve lastTime et on incrémente.
            require(incrementBigEndian(lastRandom)) { "ulid_entropy_exhausted" }
        }
        return encodeTime(lastTime) + encodeRandom(lastRandom)
    }

    private fun incrementBigEndian(bytes: ByteArray): Boolean {
        for (index in bytes.indices.reversed()) {
            val value = bytes[index].toInt() and 0xff
            if (value < 0xff) {
                bytes[index] = (value + 1).toByte()
                return true
            }
            bytes[index] = 0
        }
        // 80 bits saturés : l'appelant retentera au tick suivant, sans boucle active.
        return false
    }

    companion object {
        private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        private const val TIME_LENGTH = 10
        private const val RANDOM_LENGTH = 16
        private const val RANDOM_BYTES = 10 // 80 bits
        private val secureRandom = SecureRandom()

        fun encodeTime(ms: Long): String {
            var value = ms
            val out = CharArray(TIME_LENGTH)
            for (index in TIME_LENGTH - 1 downTo 0) {
                out[index] = CROCKFORD[(value % 32).toInt()]
                value /= 32
            }
            return String(out)
        }

        fun encodeRandom(bytes: ByteArray): String {
            // 80 bits lus comme un grand entier big-endian → 16 caractères de 5 bits.
            var bits = java.math.BigInteger.ZERO
            for (byte in bytes) {
                bits = bits.shiftLeft(8).or(java.math.BigInteger.valueOf((byte.toInt() and 0xff).toLong()))
            }
            val out = CharArray(RANDOM_LENGTH)
            val mask = java.math.BigInteger.valueOf(31L)
            for (index in RANDOM_LENGTH - 1 downTo 0) {
                out[index] = CROCKFORD[bits.and(mask).toInt()]
                bits = bits.shiftRight(5)
            }
            return String(out)
        }

        fun decodeTime(ulid: String): Long {
            var value = 0L
            for (char in ulid.take(TIME_LENGTH)) {
                val digit = CROCKFORD.indexOf(char)
                require(digit >= 0) { "ulid_caractere_invalide" }
                value = value * 32 + digit
            }
            return value
        }
    }
}
