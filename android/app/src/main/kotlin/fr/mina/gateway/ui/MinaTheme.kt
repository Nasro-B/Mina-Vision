package fr.mina.gateway.ui

import androidx.compose.runtime.Composable
import fr.mina.gateway.feature.chat.MinaChatTheme

@Composable
fun MinaTheme(content: @Composable () -> Unit) {
    MinaChatTheme(content = content)
}
