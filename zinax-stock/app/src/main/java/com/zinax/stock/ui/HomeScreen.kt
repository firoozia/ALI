package com.zinax.stock.ui

import androidx.compose.foundation.clickable
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
        actions = {
            IconButton(onClick = {
                scope.launch {
                    val msg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
                    snackbar.showSnackbar(msg)
                }
            }) { Icon(Icons.Filled.Refresh, contentDescription = "Sync now") }
            IconButton(onClick = { Graph.session.lock() }) { Icon(Icons.Filled.Lock, contentDescription = "Lock") }
            IconButton(onClick = { nav.navigate(Routes.SETTINGS) }) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                me?.let { Pill("${it.name} · ${if (it.isAdmin) "Admin" else "User"}", status.ok, status.okSoft) }
                if (printer != null) Pill("Printer: $printer", status.ok, status.okSoft)
                else Pill("No printer", status.warn, status.warnSoft)
                if (pending > 0) Pill("$pending to sync", status.warn, status.warnSoft)
            }

            val latest = shipments.firstOrNull()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tile("Receive", if (canReceive) "Open a pallet, print labels" else "Admin only", primary = canReceive, modifier = Modifier.weight(1f)) {
                    if (!canReceive) adminOnly()
                    else if (latest != null) nav.navigate(Routes.receive(latest.id)) else nav.navigate(Routes.IMPORT)
                }
                Tile("Ship out", "Scan or type a label", modifier = Modifier.weight(1f)) { nav.navigate(Routes.SHIP_OUT) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tile("✂ Cut", "Metres for a customer", modifier = Modifier.weight(1f)) { nav.navigate(Routes.cut()) }
                val open = stock.count { it.isOpen }
                Tile(
                    "Stock",
                    "${stock.size} packages · ${stock.map { it.code }.distinct().size} codes" + if (open > 0) " · $open open" else "",
                    modifier = Modifier.weight(1f),
                ) { nav.navigate(Routes.STOCK) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tile("Shipments", if (canReceive) latest?.name ?: "None yet" else "Admin only", modifier = Modifier.weight(1f)) {
                    if (canReceive) nav.navigate(Routes.SHIPMENTS) else adminOnly()
                }
                Tile("Reports", "Out, cuts, waste, in, moved", modifier = Modifier.weight(1f)) { nav.navigate(Routes.OUT_REPORT) }
            }

            Column {
                Text(
                    listOf(
                        "Last receive " + (stock.maxByOrNull { it.receivedAt }?.let { Format.date(it.receivedAt) } ?: "—"),
                        "WhatsApp $reminder",
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    syncMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (syncMessage.startsWith("Sync failed")) status.bad else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            val pendingCount = if (isAdmin) waiting.size else myWaiting
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HalfButton("⇄ Move by scan", Modifier.weight(1f)) { nav.navigate(Routes.MOVE_SCAN) }
                HalfButton(
                    (if (isAdmin) "Requests" else "My requests") + if (pendingCount > 0) " ($pendingCount)" else "",
                    Modifier.weight(1f), primary = pendingCount > 0,
                ) { nav.navigate(Routes.requests()) }
            }
            if (canReceive) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HalfButton("Import list", Modifier.weight(1f)) { nav.navigate(Routes.IMPORT) }
                    HalfButton("Print by hand", Modifier.weight(1f)) { nav.navigate(Routes.manual()) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HalfButton("Send Excel", Modifier.weight(1f), primary = true) { scope.launch { Graph.shareStockReport(context, excel = true) } }
                HalfButton("Send as text", Modifier.weight(1f)) { scope.launch { Graph.shareStockReport(context, excel = false) } }
            }
            HalfButton(
                if (sheetUrl.isBlank()) "Google Sheet (set up in Settings)" else "Open Google Sheet ↗",
                Modifier.fillMaxWidth(), enabled = sheetUrl.isNotBlank(),
            ) { Share.openUrl(context, sheetUrl) }
        }
    }
}

/** A compact button for the two-column rows on Home. */
@Composable
private fun HalfButton(text: String, modifier: Modifier, primary: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val pad = PaddingValues(horizontal = 8.dp, vertical = 6.dp)
    val label: @Composable () -> Unit = {
        Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
    }
    if (primary) Button(onClick = onClick, modifier = modifier.heightIn(min = 44.dp), enabled = enabled, contentPadding = pad) { label() }
    else OutlinedButton(onClick = onClick, modifier = modifier.heightIn(min = 44.dp), enabled = enabled, contentPadding = pad) { label() }
}

@Composable
private fun Tile(title: String, subtitle: String, modifier: Modifier = Modifier, primary: Boolean = false, onClick: () -> Unit) {
    val bg = if (primary) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
    val fg = if (primary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(
        modifier = modifier.heightIn(min = 76.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = bg,
        border = if (primary) null else androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = fg, maxLines = 1)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (primary) fg.copy(alpha = 0.85f) else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
