package fr.mina.gateway.messaging

object GatewayServiceStartPolicy {
    const val EXTRA_ISOLATED_TEST_MODE = "fr.mina.gateway.extra.ISOLATED_TEST_MODE"

    fun shouldStartLiveLoops(debugBuild: Boolean, isolatedTestRequested: Boolean): Boolean =
        !debugBuild || !isolatedTestRequested
}
