package com.zinax.stock.ui

import androidx.compose.foundation.clickable
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
import androidx.compose.ui.unit.sp
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
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

    ScreenScaffold(
        title = "Zinax Stock",
        onBack = null,
        snackbar = snackbar,
        titleContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(painterResource(R.drawable.lucide_boxes), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                Text("Zinax Stock", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground, maxLines = 1)
            }
        },
        actions = {
            val tint = MaterialTheme.colorScheme.onBackground
            IconButton(onClick = {
                scope.launch {
                    val msg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
                    snackbar.showSnackbar(msg)
                }
            }) { Icon(painterResource(R.drawable.lucide_refresh_cw), contentDescription = "Sync now", tint = tint, modifier = Modifier.size(24.dp)) }
            IconButton(onClick = { Graph.session.lock() }) {
                Icon(painterResource(R.drawable.lucide_lock_keyhole), contentDescription = "Lock", tint = tint, modifier = Modifier.size(24.dp))
            }
            IconButton(onClick = { nav.navigate(Routes.SETTINGS) }) {
                Icon(painterResource(R.drawable.lucide_settings), contentDescription = "Settings", tint = tint, modifier = Modifier.size(24.dp))
            }
        },
    ) { padding ->
        // Fit the phone: the cards share whatever height the rest leaves. On a short screen (or with large
        // system fonts) the cards keep a minimum size and the page scrolls instead.
        val fontScale = LocalDensity.current.fontScale
        val buttonRows = if (canReceive) 4 else 3
        val needed = ((40 + 52 + buttonRows * 62 + 3 * 128 + 40) * fontScale.coerceAtLeast(1f)).dp
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
        val fits = maxHeight >= needed
        Column(
            (if (fits) Modifier.fillMaxSize() else Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val rowMod = if (fits) Modifier.weight(1f) else Modifier
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                me?.let { MintBadge(R.drawable.lucide_user_round, "${it.name} · ${if (it.isAdmin) "Admin" else "User"}") }
                if (printer != null) MintBadge(R.drawable.lucide_printer, "Printer: $printer")
                else MintBadge(R.drawable.lucide_printer, "No printer", warn = true)
                if (pending > 0) MintBadge(R.drawable.lucide_refresh_cw, "$pending to sync", warn = true)
            }

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

            val failed = syncMessage.startsWith("Sync failed")
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    painterResource(if (failed) R.drawable.lucide_circle_alert else R.drawable.lucide_circle_check), contentDescription = null,
                    tint = if (failed) status.bad else Zinax.Success, modifier = Modifier.size(20.dp).padding(top = 1.dp),
                )
                Column {
                    Text(
                        "Last receive " + (stock.maxByOrNull { it.receivedAt }?.let { Format.date(it.receivedAt) } ?: "—") + " · WhatsApp $reminder",
                        fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        syncMessage, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        color = if (failed) status.bad else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

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
                PillButton(R.drawable.lucide_file_spreadsheet, "Send Excel", Modifier.weight(1f), primary = true) {
                    scope.launch { Graph.shareStockReport(context, excel = true) }
                }
                PillButton(R.drawable.lucide_message_square, "Send as text", Modifier.weight(1f)) {
                    scope.launch { Graph.shareStockReport(context, excel = false) }
                }
            }
            PillButton(
                R.drawable.lucide_sheet,
                if (sheetUrl.isBlank()) "Google Sheet (set up in Settings)" else "Open Google Sheet",
                Modifier.fillMaxWidth(), enabled = sheetUrl.isNotBlank(),
            ) { Share.openUrl(context, sheetUrl) }
        }
        }
    }
}

/** User and printer status on light mint; amber when something needs attention. */
@Composable
private fun MintBadge(icon: Int, text: String, warn: Boolean = false) {
    val status = LocalStatus.current
    val fg = if (warn) status.warn else status.ok
    Surface(color = if (warn) status.warnSoft else status.okSoft, shape = RoundedCornerShape(50)) {
        Row(
            Modifier.padding(start = 8.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
            Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A pill button with a teal icon; [primary] is solid teal with white text. */
@Composable
private fun PillButton(icon: Int, text: String, modifier: Modifier, primary: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val dark = isSystemInDarkTheme()
    val bg = if (primary) scheme.primary else scheme.surface
    val fg = if (primary) scheme.onPrimary else if (dark) scheme.primary else Zinax.DarkTeal
    val iconTint = if (primary) scheme.onPrimary else scheme.primary
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 52.dp).alpha(if (enabled) 1f else 0.5f),
        shape = RoundedCornerShape(30.dp),
        color = bg,
        border = if (primary) null else BorderStroke(1.dp, scheme.outline),
        shadowElevation = if (primary) 3.dp else 1.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = iconTint, modifier = Modifier.size(24.dp))
            Text(text, color = fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A dashboard card: icon, bold title, description, chevron. [primary] is the teal gradient card. */
@Composable
private fun Tile(
    icon: Int, title: String, subtitle: String, modifier: Modifier = Modifier, primary: Boolean = false, fill: Boolean = false,
    onClick: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val fg = if (primary) Color.White else scheme.onSurface
    val sub = if (primary) Color.White.copy(alpha = 0.88f) else scheme.onSurfaceVariant
    val iconTint = if (primary) Color.White else scheme.primary
    // Large system fonts: a smaller title so names like SHIPMENTS stay on one line.
    val titleSize = if (LocalDensity.current.fontScale <= 1.15f) 24.sp else 20.sp
    Surface(
        onClick = onClick,
        modifier = if (fill) modifier.fillMaxHeight() else modifier.heightIn(min = 128.dp),
        shape = RoundedCornerShape(20.dp),
        color = if (primary) Color.Transparent else scheme.surface,
        border = if (primary) null else BorderStroke(1.dp, scheme.outline),
        shadowElevation = if (primary) 4.dp else 2.dp,
    ) {
        Box(
            Modifier.fillMaxSize().then(
                if (primary) Modifier.background(Brush.linearGradient(listOf(Zinax.Teal, Zinax.DarkTeal))) else Modifier
            ),
        ) {
            Column(
                Modifier.padding(start = 16.dp, top = 14.dp, end = 28.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(painterResource(icon), contentDescription = null, tint = iconTint, modifier = Modifier.size(32.dp))
                Text(title.uppercase(), color = fg, fontSize = titleSize, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = sub, fontSize = 16.sp, lineHeight = 20.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Icon(
                painterResource(R.drawable.lucide_chevron_right), contentDescription = null,
                tint = if (primary) Color.White else scheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp).size(22.dp),
            )
        }
    }
}
