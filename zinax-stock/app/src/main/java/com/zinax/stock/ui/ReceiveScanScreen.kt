package com.zinax.stock.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

private data class ReceiveLine(val id: String, val text: String, val ok: Boolean)

/**
 * Receives cartons the supplier already labelled: scan each label once and the carton enters stock
 * with that label ID, so nothing is typed and nothing is printed here.
 */
@Composable
fun ReceiveScanScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val status = LocalStatus.current
    val prefs = Graph.prefs
    val shipments by Graph.db.dao().shipments().collectAsStateWithLifecycle(emptyList())
    val labelled by Graph.db.dao().prelabelled().collectAsStateWithLifecycle(emptyList())
    var chosen by remember { mutableStateOf<String?>(null) }
    var location by remember { mutableStateOf(prefs.moveTarget) }
    var keepScanning by remember { mutableStateOf(true) }
    var typed by remember { mutableStateOf("") }
    var showMissing by remember { mutableStateOf(false) }
    val lines = remember { mutableStateListOf<ReceiveLine>() }
    val nextScan = remember { java.util.concurrent.atomic.AtomicReference<() -> Unit>() }

    val withLabels = shipments.filter { s -> labelled.any { it.shipmentId == s.id } }
    val shipmentId = chosen ?: withLabels.firstOrNull()?.id
    val units = labelled.filter { it.shipmentId == shipmentId }
    val received = units.count { it.itemId != null }

    suspend fun handle(raw: String) {
        val id = LabelId.normalize(raw)
        if (id.isEmpty()) return
        val r = Graph.repo.receiveByLabel(id, location)
        val line = when {
            r.unit == null -> ReceiveLine(id, "Not in any imported list. Check the list was imported and synced.", false)
            r.duplicate -> ReceiveLine(id, "${r.unit.code} · already received", false)
            else -> ReceiveLine(id, "${r.unit.code} · ${Format.qtyUnit(r.unit.qty, r.unit.unit)} · pallet ${r.unit.pallet}", true)
        }
        lines.removeAll { it.id == id }
        lines.add(0, line)
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@rememberLauncherForActivityResult
        scope.launch {
            handle(raw)
            if (keepScanning) nextScan.get()?.invoke()
        }
    }
    val scan: () -> Unit = {
        Graph.session.leaving()
        try {
            scanner.launch(
                ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE, ScanOptions.CODE_128)
                    .setPrompt("Receiving · ${lines.count { it.ok }} scanned · Back to stop")
                    .setBeepEnabled(true).setOrientationLocked(false)
            )
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("Could not open the camera: ${e.message ?: e.javaClass.simpleName}") }
        }
    }
    nextScan.set(scan)

    ScreenScaffold("Receive by scan", onBack, snackbar) { padding ->
        FormBody(padding) {
            if (withLabels.isEmpty()) {
                Notice(
                    "No supplier-labelled list yet. Import the carton labels file with Import list first, then wait for it to sync to the other phones.",
                    status.warn, status.warnSoft,
                )
                return@FormBody
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(withLabels) { s ->
                    FilterChip(selected = s.id == shipmentId, onClick = { chosen = s.id }, label = { Text(s.name) })
                }
            }
            Text(
                "$received of ${units.size} cartons received",
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            )
            if (units.isNotEmpty() && received == units.size) Pill("Complete", status.ok, status.okSoft)
            LocationPicker(location, { location = it; prefs.moveTarget = it }, label = "Put away in")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Keep scanning")
                    Text(
                        "The camera opens again after each carton. Press Back on the camera to stop.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = keepScanning, onCheckedChange = { keepScanning = it })
            }
            Button(onClick = scan, modifier = Modifier.fillMaxWidth()) { Text("Scan cartons") }
            OutlinedTextField(
                value = typed,
                onValueChange = { v ->
                    if (v.endsWith("\n")) { scope.launch { handle(v) }; typed = "" } else typed = v
                },
                label = { Text("Or type the label ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { val v = typed; typed = ""; scope.launch { handle(v) } }),
            )

            if (lines.isNotEmpty()) {
                Panel {
                    lines.take(40).forEachIndexed { i, l ->
                        if (i > 0) HorizontalDivider()
                        Column {
                            Text(l.id, style = MonoStyle)
                            Text(
                                l.text, style = MaterialTheme.typography.bodySmall,
                                color = if (l.ok) MaterialTheme.colorScheme.onSurfaceVariant else status.bad,
                            )
                        }
                    }
                }
            }

            val missing = units.filter { it.itemId == null }
            if (missing.isNotEmpty()) {
                Button(onClick = { showMissing = !showMissing }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (showMissing) "Hide cartons not received" else "Show ${missing.size} cartons not received")
                }
                if (showMissing) {
                    Panel {
                        missing.sortedBy { it.lineNo }.take(300).forEachIndexed { i, u ->
                            if (i > 0) HorizontalDivider()
                            Text("${u.labelId} · ${u.code} · pallet ${u.pallet}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
