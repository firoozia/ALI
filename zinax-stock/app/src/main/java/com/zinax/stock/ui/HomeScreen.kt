package com.zinax.stock.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
            IconButton(onClick = { nav.navigate(Routes.SETTINGS) }) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
        },
    ) { padding ->
        FormBody(padding) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (printer != null) Pill("Printer: $printer", status.ok, status.okSoft)
                else Pill("No printer selected", status.warn, status.warnSoft)
                if (pending > 0) Pill("$pending to sync", status.warn, status.warnSoft)
            }

            val latest = shipments.firstOrNull()
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Tile("Receive", "Open a pallet, print labels", primary = true, modifier = Modifier.weight(1f)) {
                    if (latest != null) nav.navigate(Routes.receive(latest.id)) else nav.navigate(Routes.IMPORT)
                }
                Tile("Ship out", "Scan or type a label", modifier = Modifier.weight(1f)) { nav.navigate(Routes.SHIP_OUT) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Tile("Stock", "${stock.size} packages · ${stock.map { it.code }.distinct().size} codes", modifier = Modifier.weight(1f)) {
                    nav.navigate(Routes.STOCK)
                }
                Tile("Shipments", latest?.name ?: "None yet", modifier = Modifier.weight(1f)) { nav.navigate(Routes.SHIPMENTS) }
            }

            Panel {
                KeyValue("Last receive", stock.maxByOrNull { it.receivedAt }?.let { "${it.pallet?.let { p -> "Pallet $p · " } ?: ""}${Format.date(it.receivedAt)}" } ?: "—")
                KeyValue("WhatsApp reminder", reminder)
                Text(syncMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            OutlinedButton(onClick = { nav.navigate(Routes.IMPORT) }, modifier = Modifier.fillMaxWidth()) { Text("Import packing list") }
            OutlinedButton(onClick = { nav.navigate(Routes.manual()) }, modifier = Modifier.fillMaxWidth()) { Text("Print labels by hand") }
            OutlinedButton(onClick = { nav.navigate(Routes.OUT_REPORT) }, modifier = Modifier.fillMaxWidth()) { Text("Ship-out report (daily)") }
            OutlinedButton(
                onClick = { Share.openUrl(context, sheetUrl) },
                enabled = sheetUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (sheetUrl.isBlank()) "Google Sheet (set up in Settings)" else "Open Google Sheet ↗") }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { scope.launch { Graph.shareStockReport(context, excel = true) } },
                    modifier = Modifier.weight(1f),
                ) { Text("Send stock Excel") }
                OutlinedButton(
                    onClick = { scope.launch { Graph.shareStockReport(context, excel = false) } },
                    modifier = Modifier.weight(1f),
                ) { Text("Send as text") }
            }
        }
    }
}

@Composable
private fun Tile(title: String, subtitle: String, modifier: Modifier = Modifier, primary: Boolean = false, onClick: () -> Unit) {
    val bg = if (primary) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
    val fg = if (primary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(
        modifier = modifier.heightIn(min = 96.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = bg,
        border = if (primary) null else androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(title.uppercase(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = fg)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = if (primary) fg.copy(alpha = 0.85f) else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
