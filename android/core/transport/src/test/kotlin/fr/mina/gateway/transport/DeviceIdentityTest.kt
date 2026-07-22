package fr.mina.gateway.transport

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class DeviceIdentityTest {
    @Test
    fun proofBindsDevicePublicKeyAndChallenge() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val publicKey = Base64.getEncoder().encodeToString(pair.public.encoded)
        val bytes = DeviceIdentity.signingBytes("huawei-primary", publicKey, "challenge-1")
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(pair.private)
        signer.update(bytes)
        val proof = DeviceIdentityProof("huawei-primary", publicKey, "challenge-1", Base64.getEncoder().encodeToString(signer.sign()))

        assertTrue(DeviceIdentity.verify(proof))
        assertFalse(DeviceIdentity.verify(proof.copy(challenge = "challenge-2")))
    }
}
