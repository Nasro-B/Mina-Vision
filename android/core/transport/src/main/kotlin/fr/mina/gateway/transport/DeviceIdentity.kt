package fr.mina.gateway.transport

import android.content.Context
import fr.mina.gateway.protocol.DeviceIdentityKeyStore
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID

data class DeviceIdentityProof(
    val deviceId: String,
    val publicKeySpkiBase64: String,
    val challenge: String,
    val signatureBase64: String,
)

object DeviceIdentity {
    fun signingBytes(deviceId: String, publicKeySpkiBase64: String, challenge: String): ByteArray {
        require(deviceId.matches(Regex("^[A-Za-z0-9._:-]{1,160}$"))) { "device_identity_invalid" }
        require(publicKeySpkiBase64.isNotEmpty() && publicKeySpkiBase64.length <= 4096) { "device_public_key_invalid" }
        require(challenge.isNotEmpty() && challenge.length <= 512) { "device_challenge_invalid" }
        return listOf(deviceId, publicKeySpkiBase64, challenge).joinToString("|") { value ->
            "${value.toByteArray(StandardCharsets.UTF_8).size}:$value"
        }.toByteArray(StandardCharsets.UTF_8)
    }

    fun verify(proof: DeviceIdentityProof): Boolean = try {
        val publicKey = KeyFactory.getInstance("EC").generatePublic(
            X509EncodedKeySpec(Base64.getDecoder().decode(proof.publicKeySpkiBase64)),
        )
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(signingBytes(proof.deviceId, proof.publicKeySpkiBase64, proof.challenge))
            verify(Base64.getDecoder().decode(proof.signatureBase64))
        }
    } catch (_: Exception) {
        false
    }
}

class DeviceIdentityStore(
    context: Context,
    private val keyStore: DeviceIdentityKeyStore = DeviceIdentityKeyStore(),
) {
    private val preferences = context.getSharedPreferences("mina_device_identity_v1", Context.MODE_PRIVATE)

    fun deviceId(): String {
        val current = preferences.getString("device_id", null)
        if (current != null) return current
        val created = "device-${UUID.randomUUID()}"
        check(preferences.edit().putString("device_id", created).commit()) { "device_identity_persistence_failed" }
        return created
    }

    fun createProof(challenge: String): DeviceIdentityProof {
        val pair = keyStore.getOrCreateSigningKey()
        val publicKey = Base64.getEncoder().encodeToString(pair.public.encoded)
        val deviceId = deviceId()
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(pair.private)
        signer.update(DeviceIdentity.signingBytes(deviceId, publicKey, challenge))
        return DeviceIdentityProof(
            deviceId = deviceId,
            publicKeySpkiBase64 = publicKey,
            challenge = challenge,
            signatureBase64 = Base64.getEncoder().encodeToString(signer.sign()),
        )
    }
}
