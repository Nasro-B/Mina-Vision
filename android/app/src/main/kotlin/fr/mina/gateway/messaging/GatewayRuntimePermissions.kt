package fr.mina.gateway.messaging

import android.Manifest

/** Les notifications restent un consentement chat séparé, jamais une condition de la passerelle SMS. */
internal fun gatewayRuntimePermissions(): List<String> = listOf(
    Manifest.permission.RECEIVE_SMS,
    Manifest.permission.SEND_SMS,
)
