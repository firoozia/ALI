package com.aryak.hingelabels.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object HingeColors {
    val Indigo = Color(0xFF3A3F8F)
    val Amber = Color(0xFFFF9F1C)
    val Bad = Color(0xFFB3261E)
    val Warn = Color(0xFFA15C00)
}

private val Light = lightColorScheme(
    primary = HingeColors.Indigo, onPrimary = Color.White,
    primaryContainer = Color(0xFFE2E3F6), onPrimaryContainer = Color(0xFF1C1F55),
    secondary = Color(0xFFB86E00), onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFE7C7), onSecondaryContainer = Color(0xFF3D2300),
    background = Color(0xFFF6F6FA), onBackground = Color(0xFF181A2E),
    surface = Color.White, onSurface = Color(0xFF181A2E),
    surfaceVariant = Color(0xFFE8E9F2), onSurfaceVariant = Color(0xFF5A5D73),
    outline = Color(0xFFC9CBDB), outlineVariant = Color(0xFFE3E4EE),
    error = HingeColors.Bad,
)

private val Dark = darkColorScheme(
    primary = Color(0xFFB9BCFF), onPrimary = Color(0xFF1C1F55),
    primaryContainer = Color(0xFF2E3270), onPrimaryContainer = Color(0xFFE2E3F6),
    secondary = Color(0xFFFFB95C), onSecondary = Color(0xFF3D2300),
    background = Color(0xFF12131C), onBackground = Color(0xFFE5E5EF),
    surface = Color(0xFF1B1C27), onSurface = Color(0xFFE5E5EF),
    surfaceVariant = Color(0xFF2A2B38), onSurfaceVariant = Color(0xFFB0B2C6),
    outline = Color(0xFF454759), outlineVariant = Color(0xFF32333F),
)

@Composable
fun HingeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
