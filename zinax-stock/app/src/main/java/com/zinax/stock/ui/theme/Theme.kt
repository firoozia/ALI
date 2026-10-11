package com.zinax.stock.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

@Immutable
data class StatusColors(
    val ok: Color, val okSoft: Color,
    val warn: Color, val warnSoft: Color,
    val bad: Color, val badSoft: Color,
    /** Storage location badges: dark text on yellow. */
    val place: Color, val placeText: Color,
    /** Open (cut) rolls: dark text on orange. */
    val open: Color, val openText: Color,
)

private val LightStatus = StatusColors(
    Color(0xFF137A3E), Color(0xFFDDF4EB), Color(0xFFA15C00), Color(0xFFFBECD0), Color(0xFFB3261E), Color(0xFFF8DEDB),
    Color(0xFFFFD43B), Color(0xFF2B2100),
    Color(0xFFFF922B), Color(0xFF2B1300),
)
private val DarkStatus = StatusColors(
    Color(0xFF5BC489), Color(0xFF17382A), Color(0xFFE8B04F), Color(0xFF3D2F10), Color(0xFFF0857D), Color(0xFF42201D),
    Color(0xFFFFCF33), Color(0xFF231B00),
    Color(0xFFFFA94D), Color(0xFF2B1300),
)

val LocalStatus = staticCompositionLocalOf { LightStatus }

/** Zinax palette: teal on a cool white ground, navy text. */
object Zinax {
    val Teal = Color(0xFF087F8C)
    val DarkTeal = Color(0xFF075E68)
    val Navy = Color(0xFF10243E)
    val Blue = Color(0xFF397AA8)
    val Background = Color(0xFFF5F8FB)
    val Border = Color(0xFFD7E3ED)
    val TextSecondary = Color(0xFF586C84)
    val Success = Color(0xFF20B45A)
    val Mint = Color(0xFFDDF4EB)
}

private val Light = lightColorScheme(
    primary = Zinax.Teal, onPrimary = Color.White,
    primaryContainer = Color(0xFFE0F1F3), onPrimaryContainer = Zinax.DarkTeal,
    secondary = Zinax.Blue, onSecondary = Color.White,
    background = Zinax.Background, onBackground = Zinax.Navy,
    surface = Color(0xFFFFFFFF), onSurface = Zinax.Navy,
    surfaceVariant = Color(0xFFE9F0F6), onSurfaceVariant = Zinax.TextSecondary,
    outline = Zinax.Border, outlineVariant = Color(0xFFE6EEF5),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF3DB5C2), onPrimary = Color(0xFF02262B),
    primaryContainer = Color(0xFF0D3C43), onPrimaryContainer = Color(0xFFC9EEF2),
    secondary = Color(0xFF7FB2D9), onSecondary = Color(0xFF0A2236),
    background = Color(0xFF0B1622), onBackground = Color(0xFFE6EDF4),
    surface = Color(0xFF12202F), onSurface = Color(0xFFE6EDF4),
    surfaceVariant = Color(0xFF1A2A3B), onSurfaceVariant = Color(0xFF9DAEC2),
    outline = Color(0xFF2A3C50), outlineVariant = Color(0xFF213244),
)

@Composable
fun ZinaxTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    androidx.compose.runtime.CompositionLocalProvider(LocalStatus provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
    }
}
