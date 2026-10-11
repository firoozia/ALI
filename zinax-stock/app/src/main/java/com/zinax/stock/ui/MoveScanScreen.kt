package com.zinax.stock.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** One scan in this session: moved, already there, or a problem. */
private data class MoveLine(
    val id: String,
    val text: String,
    val ok: Boolean,
    /** Where it was before, so it can be moved back; null when nothing was moved. */
    val from: String?,
    val to: String,
    val back: Boolean = false,
)

/**
 * Moves many rolls to one place: choose the place once, then scan label after label.
 * Each scan moves the roll at once and is logged as a move with the user's name.
 */
@Composable
fun MoveScanScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val status = LocalStatus.current
    val prefs = Graph.prefs
    var target by remember { mutableStateOf(prefs.moveTarget) }
    var keepScanning by remember { mutableStateOf(true) }
    var typed by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<MoveLine>() }
    // The scan action, kept outside Compose state so the result callback can open the camera again.
    val nextScan = remember { java.util.concurrent.atomic.AtomicReference<() -> Unit>() }

    suspend fun handle(raw: String) {
        val id = LabelId.normalize(raw)
        if (id.isEmpty()) return
        val to = target.trim()
        val item = Graph.db.dao().item(id)
        val line = when {
            item == null -> MoveLine(id, "Not in this phone. Sync and scan again.", false, null, to)
            item.status != ItemStatus.IN_STOCK -> MoveLine(id, "${item.code} is not in stock", false, null, to)
            item.location.trim() == to -> MoveLine(id, "${item.code} · ${Format.qtyUnit(item.remaining, item.unit)} · already in $to", true, null, to)
            else -> {
                Graph.repo.setLocation(item.id, to)
                MoveLine(
                    id, "${item.code} · ${Format.qtyUnit(item.remaining, item.unit)} · from ${item.location.ifBlank { NO_LOCATION }}",
                    true, item.location, to,
                )
            }
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
                    .setPrompt("Moving to ${target.trim()} · ${lines.count { it.from != null && !it.back }} moved · Back to stop")
                    .setBeepEnabled(true).setOrientationLocked(false)
            )
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("Could not open the camera: ${e.message ?: e.javaClass.simpleName}") }
        }
    }
    nextScan.set(scan)

    val moved = lines.count { it.from != null && !it.back }
    ScreenScaffold("Move by scan", onBack, snackbar) { padding ->
        FormBody(padding) {
            LocationPicker(target, { target = it; prefs.moveTarget = it }, label = "Move to")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Keep scanning")
                    Text(
                        "The camera opens again after each roll. Press Back on the camera to stop.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = keepScanning, onCheckedChange = { keepScanning = it })
            }
            Button(onClick = scan, enabled = target.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                Text(if (target.isBlank()) "Choose where to move first" else "Scan rolls to move to ${target.trim()}")
            }
            OutlinedTextField(
                value = typed,
                onValueChange = { v ->
                    // Hardware scanners type the code and press Enter.
                    if (v.endsWith("\n") && target.isNotBlank()) { scope.launch { handle(v) }; typed = "" } else typed = v
                },
                label = { Text("Or type the label ID") },
                singleLine = true,
                enabled = target.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { val v = typed; typed = ""; scope.launch { handle(v) } }),
            )

            if (lines.isNotEmpty()) {
                Text(
                    "$moved moved to ${target.trim()} · ${lines.size} scanned",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Panel {
                    lines.forEachIndexed { i, l ->
                        if (i > 0) HorizontalDivider()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(l.id, style = MonoStyle)
                                Text(
                                    if (l.back) "Moved back to ${l.from.orEmpty().ifBlank { NO_LOCATION }}" else l.text,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (l.ok) MaterialTheme.colorScheme.onSurfaceVariant else status.bad,
                                )
                            }
                            val from = l.from
                            if (from != null && !l.back) {
                                TextButton(onClick = {
                                    scope.launch {
                                        Graph.repo.setLocation(l.id, from)
                                        val idx = lines.indexOfFirst { it.id == l.id }
                                        if (idx >= 0) lines[idx] = l.copy(back = true)
                                    }
                                }) { Text("Move back") }
                            }
                        }
                    }
                }
            }
        }
    }
}
