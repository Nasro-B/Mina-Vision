package fr.mina.gateway.ui

import androidx.compose.runtime.Composable

/** Shell Compose : le renderer ne possède aucun secret ni logique de provisioning. */
@Composable
fun MinaApp(
    gatewayContent: @Composable (onOpenChat: () -> Unit) -> Unit,
) {
    MinaTheme {
        MinaNavigation(gatewayContent = gatewayContent)
    }
}
