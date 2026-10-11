package com.zinax.stock.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zinax.stock.Graph
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

/** Theme 2, Emerald Green Gradient. */
object Emerald {
    val Primary = Color(0xFF078F54)
    val Deep = Color(0xFF006B45)
    val Dark = Color(0xFF075C48)
    val Bright = Color(0xFF20B957)
    val Secondary = Color(0xFF159B67)
    val Mint = Color(0xFFE8F8EE)
    val PaleMint = Color(0xFFF2FBF5)
    val Background = Color(0xFFF7FBF8)
    val Border = Color(0xFFBFE9D8)
    val Divider = Color(0xFFDCEFE5)
    val Heading = Color(0xFF073D36)
    val Body = Color(0xFF52657A)
    val TextSecondary = Color(0xFF6A7B8D)
    val Success = Color(0xFF21C65A)
    val Chevron = Color(0xFF08724E)
}

private val EmeraldLight = lightColorScheme(
    primary = Emerald.Primary, onPrimary = Color.White,
    primaryContainer = Emerald.Mint, onPrimaryContainer = Emerald.Dark,
    secondary = Emerald.Secondary, onSecondary = Color.White,
    background = Emerald.Background, onBackground = Emerald.Heading,
    surface = Color.White, onSurface = Emerald.Heading,
    surfaceVariant = Emerald.Mint, onSurfaceVariant = Emerald.Body,
    outline = Emerald.Border, outlineVariant = Emerald.Divider,
)

private val EmeraldDark = darkColorScheme(
    primary = Color(0xFF3FCB84), onPrimary = Color(0xFF00321F),
    primaryContainer = Color(0xFF0F3B2B), onPrimaryContainer = Color(0xFFC8F0DA),
    secondary = Color(0xFF5BC79A), onSecondary = Color(0xFF00321F),
    background = Color(0xFF0A1511), onBackground = Color(0xFFE3F2EA),
    surface = Color(0xFF12211A), onSurface = Color(0xFFE3F2EA),
    surfaceVariant = Color(0xFF173126), onSurfaceVariant = Color(0xFFA3BBAF),
    outline = Color(0xFF24443A), outlineVariant = Color(0xFF1C352C),
)

private val EmeraldLightStatus = LightStatus.copy(ok = Emerald.Dark, okSoft = Emerald.PaleMint)

/** Which look the app uses; chosen per phone in Settings → Appearance. */
enum class AppTheme(val id: String, val title: String) {
    TEAL("teal", "Theme 1 · Teal"),
    EMERALD("emerald", "Theme 2 · Emerald");

    companion object {
        fun of(id: String): AppTheme = entries.firstOrNull { it.id == id } ?: TEAL
    }
}

/** Styling the Home dashboard needs beyond the Material colours: gradients, card and button details. */
@Immutable
data class Look(
    /** Green header behind the title, or null for the plain top bar. */
    val header: Brush?,
    val primaryCard: Brush,
    /** Send Excel: a gradient, or null for the solid primary colour. */
    val primaryButton: Brush?,
    val cardBorder: Color,
    /** Square behind card icons, or null for a bare icon. */
    val iconBox: Color?,
    val icon: Color,
    val chevron: Color,
    val heading: Color,
    val body: Color,
    /** Panel behind the sync status, or null for plain text. */
    val syncPanel: Color?,
    val syncBorder: Color,
    val syncText: Color,
    val success: Color,
    val buttonBorder: Color,
    val buttonText: Color,
    val buttonIcon: Color,
    val sheetButton: Color,
    /** Google Sheets icon in its own green, or the outline icon in the button colour. */
    val sheetBrandIcon: Boolean,
    val badge: Color,
    val badgeText: Color,
    val badgeIcon: Color,
    val shadow: Color,
    val cardRadius: Dp,
    val cardElevation: Dp,
)

private fun tealLook(dark: Boolean) = Look(
    header = null,
    primaryCard = Brush.linearGradient(listOf(Zinax.Teal, Zinax.DarkTeal)),
    primaryButton = null,
    cardBorder = if (dark) Color(0xFF2A3C50) else Zinax.Border,
    iconBox = null,
    icon = if (dark) Color(0xFF3DB5C2) else Zinax.Teal,
    chevron = if (dark) Color(0xFF9DAEC2) else Zinax.TextSecondary,
    heading = if (dark) Color(0xFFE6EDF4) else Zinax.Navy,
    body = if (dark) Color(0xFF9DAEC2) else Zinax.TextSecondary,
    syncPanel = null,
    syncBorder = Color.Transparent,
    syncText = if (dark) Color(0xFF9DAEC2) else Zinax.TextSecondary,
    success = Zinax.Success,
    buttonBorder = if (dark) Color(0xFF2A3C50) else Zinax.Border,
    buttonText = if (dark) Color(0xFF3DB5C2) else Zinax.DarkTeal,
    buttonIcon = if (dark) Color(0xFF3DB5C2) else Zinax.Teal,
    sheetButton = if (dark) Color(0xFF12202F) else Color.White,
    sheetBrandIcon = false,
    badge = if (dark) Color(0xFF17382A) else Zinax.Mint,
    badgeText = if (dark) Color(0xFF5BC489) else Color(0xFF137A3E),
    badgeIcon = if (dark) Color(0xFF5BC489) else Color(0xFF137A3E),
    shadow = Color.Black,
    cardRadius = 20.dp,
    cardElevation = 2.dp,
)

private fun emeraldLook(dark: Boolean) = Look(
    header = Brush.linearGradient(
        0f to Color(0xFF25C45A), 0.48f to Emerald.Primary, 1f to Color(0xFF005B42),
        start = Offset(0f, 0f), end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
    ),
    primaryCard = Brush.linearGradient(
        0f to Color(0xFF20C85A), 0.58f to Emerald.Primary, 1f to Emerald.Deep,
        start = Offset(0f, 0f), end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
    ),
    primaryButton = Brush.linearGradient(listOf(Color(0xFF20C85A), Emerald.Primary, Emerald.Deep)),
    cardBorder = if (dark) Color(0xFF24443A) else Emerald.Border,
    iconBox = if (dark) Color(0xFF173A2D) else Emerald.Mint,
    icon = if (dark) Color(0xFF4FD08F) else Emerald.Deep,
    chevron = if (dark) Color(0xFF4FD08F) else Emerald.Chevron,
    heading = if (dark) Color(0xFFE3F2EA) else Emerald.Heading,
    body = if (dark) Color(0xFFA9BDB3) else Emerald.Body,
    syncPanel = if (dark) Color(0xFF12211A) else Emerald.PaleMint,
    syncBorder = if (dark) Color(0xFF24443A) else Emerald.Divider,
    syncText = if (dark) Color(0xFFA9BDB3) else Emerald.TextSecondary,
    success = Emerald.Success,
    buttonBorder = if (dark) Color(0xFF24443A) else Emerald.Border,
    buttonText = if (dark) Color(0xFFBFEBD3) else Emerald.Dark,
    buttonIcon = if (dark) Color(0xFF4FD08F) else Emerald.Primary,
    sheetButton = if (dark) Color(0xFF102019) else Emerald.PaleMint,
    sheetBrandIcon = true,
    badge = Emerald.PaleMint,
    badgeText = Emerald.Dark,
    badgeIcon = Emerald.Primary,
    shadow = Emerald.Deep,
    cardRadius = 22.dp,
    cardElevation = 4.dp,
)

val LocalLook = staticCompositionLocalOf { tealLook(false) }

@Composable
fun ZinaxTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val tick by Graph.prefs.changes.collectAsState()
    val theme = remember(tick) { AppTheme.of(Graph.prefs.appTheme) }
    val emerald = theme == AppTheme.EMERALD
    val scheme = when {
        emerald && dark -> EmeraldDark
        emerald -> EmeraldLight
        dark -> Dark
        else -> Light
    }
    val status = when {
        dark -> DarkStatus
        emerald -> EmeraldLightStatus
        else -> LightStatus
    }
    val look = remember(emerald, dark) { if (emerald) emeraldLook(dark) else tealLook(dark) }
    CompositionLocalProvider(LocalStatus provides status, LocalLook provides look) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
