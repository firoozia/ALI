package com.zinax.stock.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/**
 * Stock count: choose a place, scan every label on its shelves, and compare with what the app says is there.
 * Found, missing and extra packages are listed; extras can be moved here, missing ones removed (admin, or by request).
 * The count is saved as it goes, so locking or closing the app does not lose it.
 */
@Composable
fun StockCountScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val status = LocalStatus.current
    val prefs = Graph.prefs
    val dao = Graph.db.dao()
    val inStock by dao.inStock().collectAsStateWithLifecycle(emptyList())

    var place by remember { mutableStateOf(prefs.countLocation) }
    var scanned by remember { mutableStateOf(prefs.countScanned) }
    // Labels scanned that are not in stock here: what the phone knows about them (null = unknown label).
    val lookups = remember { mutableStateMapOf<String, Item?>() }
    var keepScanning by remember { mutableStateOf(true) }
    var typed by remember { mutableStateOf("") }
    var last by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var askPlace by remember { mutableStateOf<String?>(null) }
    var askFinish by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<List<Item>?>(null) }
    val nextScan = remember { java.util.concurrent.atomic.AtomicReference<() -> Unit>() }

    val here = place.trim()
    val expected = inStock.filter { it.location.trim() == here }
    val expectedIds = expected.map { it.id }.toSet()
    val scannedSet = scanned.toSet()
    val found = expected.filter { it.id in scannedSet }
    val missing = expected.filter { it.id !in scannedSet }
    val byId = inStock.associateBy { it.id }
    val extras = scanned.filter { it !in expectedIds }
    val placeName = here.ifBlank { NO_LOCATION }

    fun save(list: List<String>) {
        scanned = list
        prefs.countScanned = list
        if (prefs.countStarted == 0L) prefs.countStarted = System.currentTimeMillis()
    }

    suspend fun handle(raw: String) {
        val id = LabelId.normalize(raw)
        if (id.isEmpty()) return
        if (id in scanned) { last = "$id · already counted" to false; return }
        val item = dao.item(id)
        if (id !in expectedIds) lookups[id] = item
        save(scanned + id)
        last = when {
            id in expectedIds -> "$id · ${item?.code.orEmpty()} · ${item?.let { Format.qtyUnit(it.remaining, it.unit) }.orEmpty()}" to true
            item == null -> "$id · not in this phone" to false
            item.status != ItemStatus.IN_STOCK -> "$id · ${item.code} · recorded as ${if (item.status == ItemStatus.SHIPPED) "shipped" else "deleted"}" to false
            else -> "$id · ${item.code} · recorded in ${item.location.ifBlank { NO_LOCATION }}" to false
        }
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
                    .setPrompt("Counting $placeName · ${scanned.size} scanned · Back to stop")
                    .setBeepEnabled(true).setOrientationLocked(false)
            )
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("Could not open the camera: ${e.message ?: e.javaClass.simpleName}") }
        }
    }
    nextScan.set(scan)

    fun extraItem(id: String): Item? = byId[id] ?: lookups[id]

    fun shareText() {
        val text = buildString {
            append("*Zinax stock count* · $placeName · ${Format.dateTime(System.currentTimeMillis())}\n")
            append("By ${prefs.userName}\n\n")
            append("Found ${found.size} of ${expected.size}\n")
            if (missing.isNotEmpty()) {
                append("\n*Missing ${missing.size}*\n")
                missing.forEach { append("${it.id} · ${it.code} ${it.size} · ${Format.qtyUnit(it.remaining, it.unit)}\n") }
            }
            if (extras.isNotEmpty()) {
                append("\n*Extra ${extras.size}*\n")
                extras.forEach { id ->
                    val i = extraItem(id)
                    append(
                        "$id · " + when {
                            i == null -> "not in the app"
                            i.status != ItemStatus.IN_STOCK -> "${i.code} · recorded as ${i.status.lowercase()}"
                            else -> "${i.code} · recorded in ${i.location.ifBlank { NO_LOCATION }}"
                        } + "\n"
                    )
                }
            }
        }
        com.zinax.stock.Share.text(context, text)
    }

    ScreenScaffold("Stock count", onBack, snackbar) { padding ->
        FormBody(padding) {
            LocationPicker(place, { v -> if (scanned.isEmpty()) { place = v; prefs.countLocation = v } else askPlace = v }, label = "Place to count")
            Text(
                "$placeName: ${expected.size} packages in the app",
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Keep scanning")
                    Text(
                        "Scan every label on the shelves of this place. Press Back on the camera to stop.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = keepScanning, onCheckedChange = { keepScanning = it })
            }
            Button(onClick = scan, modifier = Modifier.fillMaxWidth()) { Text("Scan labels") }
            OutlinedTextField(
                value = typed,
                onValueChange = { v -> if (v.endsWith("\n")) { scope.launch { handle(v) }; typed = "" } else typed = v },
                label = { Text("Or type the label ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { val v = typed; typed = ""; scope.launch { handle(v) } }),
            )
            last?.let { (text, ok) ->
                Text(text, style = MaterialTheme.typography.bodySmall, color = if (ok) status.ok else status.bad)
            }

            Text(
                "Found ${found.size} of ${expected.size}",
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            )
            if (expected.isNotEmpty() && missing.isEmpty() && extras.isEmpty()) Pill("All found", status.ok, status.okSoft)

            if (extras.isNotEmpty()) {
                Text("Extra ${extras.size}", style = MaterialTheme.typography.titleSmall, color = status.warn)
                Panel {
                    extras.forEachIndexed { i, id ->
                        if (i > 0) HorizontalDivider()
                        val item = extraItem(id)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(id, style = MonoStyle)
                                Text(
                                    when {
                                        item == null -> "Not in this phone. Sync and scan again."
                                        item.status != ItemStatus.IN_STOCK -> "${item.code} · recorded as ${if (item.status == ItemStatus.SHIPPED) "shipped" else "deleted"}"
                                        else -> "${item.code} · ${Format.qtyUnit(item.remaining, item.unit)} · recorded in ${item.location.ifBlank { NO_LOCATION }}"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (item != null && item.status == ItemStatus.IN_STOCK) {
                                TextButton(onClick = { scope.launch { Graph.repo.setLocation(id, here) } }) { Text("Move here") }
                            }
                        }
                    }
                }
            }

            if (missing.isNotEmpty() && scanned.isNotEmpty()) {
                Text("Missing ${missing.size}", style = MaterialTheme.typography.titleSmall, color = status.bad)
                Panel {
                    missing.take(300).forEachIndexed { i, item ->
                        if (i > 0) HorizontalDivider()
                        Column {
                            Text(item.id, style = MonoStyle)
                            Text(
                                "${item.code} ${Format.size(item.size)} · ${Format.qtyUnit(item.remaining, item.unit)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Text(
                    "Look for missing packages in other places first: scanning them there shows them as extra. " +
                        "Remove only those that are really gone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(onClick = { removing = missing }, modifier = Modifier.fillMaxWidth()) {
                    Text("Remove ${missing.size} missing from stock", color = status.bad)
                }
            }

            if (scanned.isNotEmpty()) {
                Button(onClick = { shareText() }, modifier = Modifier.fillMaxWidth()) { Text("Send count result") }
                OutlinedButton(onClick = { askFinish = true }, modifier = Modifier.fillMaxWidth()) { Text("Finish and start a new count") }
            }
        }
    }

    askPlace?.let { v ->
        AlertDialog(
            onDismissRequest = { askPlace = null },
            title = { Text("Start a new count?") },
            text = { Text("The ${scanned.size} labels scanned in $placeName will be cleared.") },
            confirmButton = {
                TextButton(onClick = {
                    place = v; prefs.countLocation = v; save(emptyList()); prefs.countStarted = 0L
                    lookups.clear(); last = null; askPlace = null
                }) { Text("Start new count") }
            },
            dismissButton = { TextButton(onClick = { askPlace = null }) { Text("Cancel") } },
        )
    }

    if (askFinish) {
        AlertDialog(
            onDismissRequest = { askFinish = false },
            title = { Text("Finish this count?") },
            text = { Text("The result is saved to the Counts tab of the sheet. The scanned list will be cleared.") },
            confirmButton = {
                TextButton(onClick = {
                    val result = Triple(found.size, missing.map { it.id }, extras)
                    val total = expected.size
                    scope.launch { Graph.repo.saveCount(placeName, total, result.first, result.second, result.third) }
                    save(emptyList()); prefs.countStarted = 0L; lookups.clear(); last = null; askFinish = false
                }) { Text("Finish") }
            },
            dismissButton = { TextButton(onClick = { askFinish = false }) { Text("Cancel") } },
        )
    }

    removing?.let { list ->
        ApprovalDialog(
            title = "Remove ${list.size} missing",
            body = "Use this only for packages that are really gone. They leave stock and stay in the Items tab of the sheet marked VOID.",
            confirmLabel = "Remove",
            onConfirm = {
                removing = null
                scope.launch { Graph.repo.voidItems(list.map { it.id }) }
            },
            request = { reason -> Graph.repo.requestDelete(list.map { it.id }, "Stock count $placeName: not found. $reason".trim()) },
            onDone = { msg -> removing = null; scope.launch { snackbar.showSnackbar(msg) } },
            onDismiss = { removing = null },
        )
    }
}
