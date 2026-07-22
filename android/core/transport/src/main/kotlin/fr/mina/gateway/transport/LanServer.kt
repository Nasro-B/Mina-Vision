package fr.mina.gateway.transport

import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket

class LanServer(
    private val bindAddress: InetAddress,
    private val port: Int,
    private val expectedDeviceId: String,
) : AutoCloseable {
    private var socket: ServerSocket? = null

    init {
        require(bindAddress.isSiteLocalAddress && !bindAddress.isAnyLocalAddress && !bindAddress.isLoopbackAddress) {
            "lan_private_interface_required"
        }
        require(port in 1024..65535) { "lan_port_invalid" }
    }

    fun authorizePeer(proof: DeviceIdentityProof, expectedChallenge: String): Boolean =
        proof.deviceId == expectedDeviceId && proof.challenge == expectedChallenge && DeviceIdentity.verify(proof)

    fun open(): InetSocketAddress {
        check(socket == null) { "lan_server_already_open" }
        socket = ServerSocket().apply { bind(InetSocketAddress(bindAddress, port), 1) }
        return socket!!.localSocketAddress as InetSocketAddress
    }

    override fun close() {
        socket?.close()
        socket = null
    }
}
