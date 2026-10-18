package com.zinax.stock.ui

import androidx.compose.foundation.clickable
import android.app.Activity
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.zinax.stock.ui.theme.LocalLook
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.CompositionLocalProvider
import com.zinax.stock.R
import com.zinax.stock.ui.theme.Zinax
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.zinax.stock.CrashLog
import com.zinax.stock.Graph
import com.zinax.stock.Routes
import com.zinax.stock.Share
import com.zinax.stock.core.Format
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(nav: NavController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val prefs = Graph.prefs
    val tick by prefs.changes.collectAsStateWithLifecycle()
    val stock by Graph.db.dao().inStock().collectAsStateWithLifecycle(emptyList())
    val shipments by Graph.db.dao().shipments().collectAsStateWithLifecycle(emptyList())
    val pending by Graph.db.dao().pendingItemCount().collectAsStateWithLifecycle(0)
    val status = LocalStatus.current
    val printer = remember(tick) { prefs.printerName }
    val me by Graph.session.user.collectAsStateWithLifecycle()
    val canReceive = me?.mayReceive == true
    val isAdmin = me?.isAdmin == true
    val waiting by Graph.db.dao().pendingRequests().collectAsStateWithLifecycle(emptyList())
    val myWaiting = waiting.count { it.requestedBy == me?.name }
    val adminOnly: () -> Unit = { scope.launch { snackbar.showSnackbar("Only admins, or users allowed to receive, can do this") } }
    val sheetUrl = remember(tick) { prefs.sheetUrl }
    val syncMessage = remember(tick) { prefs.lastSyncMessage }
    val reminder = remember(tick) { if (prefs.reportEnabled) "Daily %02d:%02d".format(prefs.reportHour, prefs.reportMinute) else "Off" }

    // The last unexpected close, offered once so it can be sent for fixing.
    var crash by remember { mutableStateOf(CrashLog.read(context)) }
    crash?.let { report ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = {},
            title = { Text("The app closed unexpectedly") },
            text = {
                Text(
                    "The last time, Zinax Stock closed by itself. Send this report (for example on WhatsApp) so the problem can be fixed. " +
                        "It contains only the error, the phone model and the app version.",
                )
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    CrashLog.clear(context)
                    crash = null
                    Share.text(context, report)
                }) { Text("Send report") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { CrashLog.clear(context); crash = null }) { Text("Close") }
            },
        )
    }

    val look = LocalLook.current
    val emerald = look.header != null
    val syncNow: () -> Unit = {
        scope.launch {
            val msg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
            snackbar.showSnackbar(msg)
        }
    }
    // White status-bar icons over the green header; back to normal on other screens.
    val view = LocalView.current
    val darkSystem = isSystemInDarkTheme()
    DisposableEffect(emerald, darkSystem) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.isAppearanceLightStatusBars = !emerald && !darkSystem
        onDispose { controller?.isAppearanceLightStatusBars = !darkSystem }
    }

    ScreenScaffold(
        title = "Zinax Stock",
        onBack = null,
        snackbar = snackbar,
        showTopBar = !emerald,
        titleContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(painterResource(R.drawable.lucide_boxes), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                Text("Zinax Stock", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground, maxLines = 1)
            }
        },
        actions = {
            val tint = MaterialTheme.colorScheme.onBackground
            HeaderButton(R.drawable.lucide_refresh_cw, "Sync now", tint, null, syncNow)
            HeaderButton(R.drawable.lucide_lock_keyhole, "Lock", tint, null) { Graph.session.lock() }
            HeaderButton(R.drawable.lucide_settings, "Settings", tint, null) { nav.navigate(Routes.SETTINGS) }
        },
    ) { padding ->
        // Fit the phone: the whole page is drawn smaller (down to 70 %) until it fits the screen height, and
        // on a tall screen the cards grow to fill the space. Only a very short screen scrolls.
        val density = LocalDensity.current
        val buttonRows = if (canReceive) 5 else 4
        val top = if (emerald) 128 + 56 else 36
        val needed = ((top + 3 * 140 + (if (emerald) 60 else 46) + buttonRows * 54 + 12 * (4 + buttonRows) + 12) *
            density.fontScale.coerceAtLeast(1f)).dp
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
        val scale = (maxHeight / needed).coerceIn(0.7f, 1f)
        val fits = maxHeight >= needed * scale
        CompositionLocalProvider(LocalDensity provides Density(density.density * scale, density.fontScale)) {
        Column(
            if (fits) Modifier.fillMaxSize() else Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val badges: @Composable () -> Unit = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    me?.let { StatusBadge(R.drawable.lucide_user_round, "${it.name} · ${if (it.isAdmin) "Admin" else "User"}") }
                    if (printer != null) StatusBadge(R.drawable.lucide_printer, "Printer: $printer")
                    else StatusBadge(R.drawable.lucide_printer, "No printer", warn = true)
                    if (pending > 0) StatusBadge(R.drawable.lucide_refresh_cw, "$pending to sync", warn = true)
                }
            }
            if (look.header != null) {
                GradientHeader(look.header, badges, syncNow, onLock = { Graph.session.lock() }, onSettings = { nav.navigate(Routes.SETTINGS) })
            }
            Column(
                (if (fits) Modifier.weight(1f) else Modifier).padding(horizontal = 16.dp).padding(bottom = 6.dp, top = if (emerald) 0.dp else 6.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
            val rowMod = if (fits) Modifier.weight(1f) else Modifier
            if (!emerald) badges()

            val latest = shipments.firstOrNull()
            Row(rowMod, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(R.drawable.lucide_package_check, "Receive", if (canReceive) "Open a pallet, print labels" else "Admin only",
                    primary = true, modifier = Modifier.weight(1f), fill = fits) {
                    if (!canReceive) adminOnly()
                    else if (latest != null) nav.navigate(Routes.receive(latest.id)) else nav.navigate(Routes.IMPORT)
                }
                Tile(R.drawable.lucide_truck, "Ship out", "Scan or type a label", modifier = Modifier.weight(1f), fill = fits) {
                    nav.navigate(Routes.SHIP_OUT)
                }
            }
            Row(rowMod, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(R.drawable.lucide_scissors, "Cut", "Metres for a customer", modifier = Modifier.weight(1f), fill = fits) {
                    nav.navigate(Routes.cut())
                }
                val open = stock.count { it.isOpen }
                Tile(
                    R.drawable.lucide_boxes, "Stock",
                    "${stock.size} packages · ${stock.map { it.code }.distinct().size} codes" + if (open > 0) " · $open open" else "",
                    modifier = Modifier.weight(1f), fill = fits,
                ) { nav.navigate(Routes.STOCK) }
            }
            Row(rowMod, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(R.drawable.lucide_truck, "Shipments", if (canReceive) latest?.name ?: "None yet" else "Admin only",
                    modifier = Modifier.weight(1f), fill = fits) {
                    if (canReceive) nav.navigate(Routes.SHIPMENTS) else adminOnly()
                }
                Tile(R.drawable.lucide_file_chart_column, "Reports", "Out, cuts, waste, in, moved", modifier = Modifier.weight(1f), fill = fits) {
                    nav.navigate(Routes.OUT_REPORT)
                }
            }

            SyncStatus(
                failed = syncMessage.startsWith("Sync failed"),
                syncLine = syncMessage,
                infoLine = "Last receive " + (stock.maxByOrNull { it.receivedAt }?.let { Format.date(it.receivedAt) } ?: "—") + " · WhatsApp $reminder",
            )

            val pendingCount = if (isAdmin) waiting.size else myWaiting
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(R.drawable.lucide_scan_line, "Move by scan", Modifier.weight(1f)) { nav.navigate(Routes.MOVE_SCAN) }
                PillButton(
                    R.drawable.lucide_clipboard_list,
                    (if (isAdmin) "Requests" else "My requests") + if (pendingCount > 0) " ($pendingCount)" else "",
                    Modifier.weight(1f),
                ) { nav.navigate(Routes.requests()) }
            }
            if (canReceive) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PillButton(R.drawable.lucide_download, "Import list", Modifier.weight(1f)) { nav.navigate(Routes.IMPORT) }
                    PillButton(R.drawable.lucide_printer, "Print by hand", Modifier.weight(1f)) { nav.navigate(Routes.manual()) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (canReceive) PillButton(R.drawable.lucide_package_check, "Receive by scan", Modifier.weight(1f)) { nav.navigate(Routes.RECEIVE_SCAN) }
                PillButton(R.drawable.lucide_scan_line, "Label history", Modifier.weight(1f)) { nav.navigate(Routes.history()) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(R.drawable.lucide_file_spreadsheet, "Send Excel", Modifier.weight(1f), primary = true) {
                    scope.launch { Graph.shareStockReport(context, excel = true) }
                }
                PillButton(R.drawable.lucide_message_square, "Send as text", Modifier.weight(1f)) {
                    scope.launch { Graph.shareStockReport(context, excel = false) }
                }
            }
            SheetButton(sheetUrl.isNotBlank()) { Share.openUrl(context, sheetUrl) }
            }
        }
        }
        }
    }
}

/** Theme 2 header: green gradient up to the top edge, curved bottom, faint circles, white title and round buttons. */
@Composable
private fun GradientHeader(brush: Brush, badges: @Composable () -> Unit, onSync: () -> Unit, onLock: () -> Unit, onSettings: () -> Unit) {
    val shape = RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(brush)) {
        // Decorative translucent circles.
        Box(Modifier.align(Alignment.TopEnd).offset(x = 48.dp, y = (-64).dp).size(180.dp).background(Color.White.copy(alpha = 0.10f), CircleShape))
        Box(Modifier.align(Alignment.BottomCenter).offset(x = 30.dp, y = 70.dp).size(120.dp).background(Color.White.copy(alpha = 0.07f), CircleShape))
        Column(
            Modifier.statusBarsPadding().padding(start = 18.dp, end = 14.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(painterResource(R.drawable.lucide_boxes), contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
                Text("Zinax Stock", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1, modifier = Modifier.weight(1f))
                val circle = Color.White.copy(alpha = 0.18f)
                HeaderButton(R.drawable.lucide_refresh_cw, "Sync now", Color.White, circle, onSync)
                HeaderButton(R.drawable.lucide_lock_keyhole, "Lock", Color.White, circle, onLock)
                HeaderButton(R.drawable.lucide_settings, "Settings", Color.White, circle, onSettings)
            }
            badges()
        }
    }
}

/** A top-bar icon button; on Theme 2 it sits in a translucent circle. */
@Composable
private fun HeaderButton(icon: Int, label: String, tint: Color, circle: Color?, onClick: () -> Unit) {
    if (circle == null) {
        IconButton(onClick = onClick) { Icon(painterResource(icon), contentDescription = label, tint = tint, modifier = Modifier.size(24.dp)) }
    } else {
        Surface(onClick = onClick, shape = CircleShape, color = circle, modifier = Modifier.size(42.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(painterResource(icon), contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
            }
        }
    }
}

/** Sync time, last receive and WhatsApp reminder; red with a warning icon when the last sync failed. */
@Composable
private fun SyncStatus(failed: Boolean, syncLine: String, infoLine: String) {
    val look = LocalLook.current
    val status = LocalStatus.current
    val content: @Composable () -> Unit = {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                painterResource(if (failed) R.drawable.lucide_circle_alert else R.drawable.lucide_circle_check), contentDescription = null,
                tint = if (failed) status.bad else look.success, modifier = Modifier.size(20.dp).padding(top = 1.dp),
            )
            Column {
                if (look.syncPanel != null) {
                    Text(syncLine, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        color = if (failed) status.bad else look.badgeText)
                    Text(infoLine, fontSize = 14.sp, color = look.syncText)
                } else {
                    Text(infoLine, fontSize = 14.sp, color = look.syncText)
                    Text(syncLine, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (failed) status.bad else look.syncText)
                }
            }
        }
    }
    if (look.syncPanel != null) {
        Surface(color = look.syncPanel, shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, look.syncBorder), modifier = Modifier.fillMaxWidth()) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) { content() }
        }
    } else {
        content()
    }
}

/** User and printer status on light mint; amber when something needs attention. */
@Composable
private fun StatusBadge(icon: Int, text: String, warn: Boolean = false) {
    val status = LocalStatus.current
    val look = LocalLook.current
    val fg = if (warn) status.warn else look.badgeText
    Surface(color = if (warn) status.warnSoft else look.badge, shape = RoundedCornerShape(50)) {
        Row(
            Modifier.padding(start = 8.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = if (warn) status.warn else look.badgeIcon, modifier = Modifier.size(18.dp))
            Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A pill button with an icon; [primary] is the solid or gradient call to action. */
@Composable
private fun PillButton(icon: Int, text: String, modifier: Modifier, primary: Boolean = false, onClick: () -> Unit) {
    val look = LocalLook.current
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(50)
    val fg = if (primary) Color.White else look.buttonText
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 50.dp),
        shape = shape,
        color = if (primary && look.primaryButton == null) scheme.primary else if (primary) Color.Transparent else scheme.surface,
        border = if (primary) null else BorderStroke(1.dp, look.buttonBorder),
        shadowElevation = if (primary) 4.dp else 1.dp,
    ) {
        Row(
            (if (primary && look.primaryButton != null) Modifier.background(look.primaryButton) else Modifier)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = if (primary) Color.White else look.buttonIcon, modifier = Modifier.size(24.dp))
            Text(text, color = fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Open Google Sheet, full width; Theme 2 shows the green Sheets icon and an open-link arrow. */
@Composable
private fun SheetButton(enabled: Boolean, onClick: () -> Unit) {
    val look = LocalLook.current
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).alpha(if (enabled) 1f else 0.5f),
        shape = RoundedCornerShape(50),
        color = look.sheetButton,
        border = BorderStroke(1.dp, look.buttonBorder),
        shadowElevation = 1.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (look.sheetBrandIcon) Image(painterResource(R.drawable.ic_google_sheets), contentDescription = null, modifier = Modifier.size(24.dp))
            else Icon(painterResource(R.drawable.lucide_sheet), contentDescription = null, tint = look.buttonIcon, modifier = Modifier.size(24.dp))
            Text(
                if (enabled) "Open Google Sheet" else "Google Sheet (set up in Settings)",
                color = look.buttonText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Icon(painterResource(R.drawable.lucide_external_link), contentDescription = null, tint = look.buttonIcon, modifier = Modifier.size(20.dp))
        }
    }
}

/** A dashboard card: icon, bold title, description, chevron. [primary] is the gradient card. */
@Composable
private fun Tile(
    icon: Int, title: String, subtitle: String, modifier: Modifier = Modifier, primary: Boolean = false, fill: Boolean = false,
    onClick: () -> Unit,
) {
    val look = LocalLook.current
    val scheme = MaterialTheme.colorScheme
    val fg = if (primary) Color.White else look.heading
    val sub = if (primary) Color.White.copy(alpha = 0.9f) else look.body
    // Large system fonts: a smaller title so names like SHIPMENTS stay on one line.
    val titleSize = if (LocalDensity.current.fontScale <= 1.15f) 24.sp else 20.sp
    val shape = RoundedCornerShape(look.cardRadius)
    Surface(
        onClick = onClick,
        modifier = (if (fill) modifier.fillMaxHeight() else modifier.heightIn(min = 128.dp))
            .shadow(look.cardElevation, shape, ambientColor = look.shadow, spotColor = look.shadow),
        shape = shape,
        color = if (primary) Color.Transparent else scheme.surface,
        border = if (primary) null else BorderStroke(1.dp, look.cardBorder),
    ) {
        Box(Modifier.fillMaxSize().then(if (primary) Modifier.background(look.primaryCard) else Modifier)) {
            Column(
                Modifier.padding(start = 16.dp, top = 14.dp, end = 28.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val box = when {
                    look.iconBox == null -> null
                    primary -> Color.White.copy(alpha = 0.18f)
                    else -> look.iconBox
                }
                val tint = if (primary) Color.White else look.icon
                if (box != null) {
                    Box(Modifier.size(48.dp).background(box, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                        Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.size(28.dp))
                    }
                } else {
                    Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.size(32.dp))
                }
                Text(title.uppercase(), color = fg, fontSize = titleSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = sub, fontSize = 16.sp, lineHeight = 20.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Icon(
                painterResource(R.drawable.lucide_chevron_right), contentDescription = null,
                tint = if (primary) Color.White else look.chevron,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp).size(22.dp),
            )
        }
    }
}
