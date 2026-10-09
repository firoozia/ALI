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
)

private val LightStatus = StatusColors(
    Color(0xFF1D7A46), Color(0xFFDFF1E6), Color(0xFFA15C00), Color(0xFFFBECD0), Color(0xFFB3261E), Color(0xFFF8DEDB),
)
private val DarkStatus = StatusColors(
    Color(0xFF5BC489), Color(0xFF17382A), Color(0xFFE8B04F), Color(0xFF3D2F10), Color(0xFFF0857D), Color(0xFF42201D),
)

val LocalStatus = staticCompositionLocalOf { LightStatus }

private val Light = lightColorScheme(
    primary = Color(0xFF0D6B8A), onPrimary = Color.White,
    primaryContainer = Color(0xFFDCEDF3), onPrimaryContainer = Color(0xFF0D3F52),
    background = Color(0xFFF7F9FB), onBackground = Color(0xFF14202B),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF14202B),
    surfaceVariant = Color(0xFFE8ECF0), onSurfaceVariant = Color(0xFF52606D),
    outline = Color(0xFFCDD5DD), outlineVariant = Color(0xFFE1E6EB),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF4CB4D4), onPrimary = Color(0xFF04202B),
    primaryContainer = Color(0xFF16404F), onPrimaryContainer = Color(0xFFCDEBF5),
    background = Color(0xFF0E151B), onBackground = Color(0xFFE6EDF3),
    surface = Color(0xFF16212A), onSurface = Color(0xFFE6EDF3),
    surfaceVariant = Color(0xFF1D2B36), onSurfaceVariant = Color(0xFF9AA8B5),
    outline = Color(0xFF2A3946), outlineVariant = Color(0xFF22313D),
)

@Composable
fun ZinaxTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    androidx.compose.runtime.CompositionLocalProvider(LocalStatus provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
    }
}
