package fr.mina.gateway.feature.chat

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Palette de Mina. Le sombre est un vrai NOIR tiré vers le bleu nuit, pas un gris, et l'unique
 * couleur d'accent est un ambre chaud : une seule teinte porte l'identité, tout le reste reste
 * neutre pour que le texte des conversations passe en premier.
 */
private val Amber = Color(0xFFD9A441)
private val AmberInk = Color(0xFF2A1C00)
private val NightGround = Color(0xFF0A0A0C)
private val NightSurface = Color(0xFF15161A)
private val NightSurfaceHigh = Color(0xFF1E1F25)
private val NightInk = Color(0xFFECECEF)
private val NightInkMuted = Color(0xFFA9AAB4)
private val DayGround = Color(0xFFFBFBFC)
private val DaySurface = Color(0xFFFFFFFF)
private val DaySurfaceHigh = Color(0xFFEDEDF1)
private val DayInk = Color(0xFF17171B)
private val DayInkMuted = Color(0xFF55565F)
private val Danger = Color(0xFFD9483F)

private val darkScheme = darkColorScheme(
    primary = Amber,
    onPrimary = AmberInk,
    primaryContainer = Color(0xFF3A2B0A),
    onPrimaryContainer = Amber,
    background = NightGround,
    onBackground = NightInk,
    surface = NightSurface,
    onSurface = NightInk,
    surfaceVariant = NightSurfaceHigh,
    onSurfaceVariant = NightInkMuted,
    error = Danger,
    outline = Color(0xFF3A3B44),
)

private val lightScheme = lightColorScheme(
    primary = Color(0xFF8A5A00),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFE3AE),
    onPrimaryContainer = Color(0xFF2A1C00),
    background = DayGround,
    onBackground = DayInk,
    surface = DaySurface,
    onSurface = DayInk,
    surfaceVariant = DaySurfaceHigh,
    onSurfaceVariant = DayInkMuted,
    error = Color(0xFFB3261E),
    outline = Color(0xFFC6C6CE),
)

private val minaTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.4.sp),
)

@Composable
fun MinaChatTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (dark) darkScheme else lightScheme,
        typography = minaTypography,
        content = content,
    )
}
