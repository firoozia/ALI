package com.zinax.stock.ui

import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
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

@Composable
fun ShipOutScreen(onBack: () -> Unit, onReport: () -> Unit) {
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    val snackbar = remember { SnackbarHostState() }
    val dao = Graph.db.dao()
    val startedAt = remember { System.currentTimeMillis() }
    val shippedNow by dao.shippedSince(startedAt).collectAsStateWithLifecycle(emptyList())
    val undone by dao.undoneIds().collectAsStateWithLifecycle(emptyList())
    var undoing by remember { mutableStateOf<UndoTarget?>(null) }

    var input by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<Item?>(null) }
    var older by remember { mutableStateOf<Item?>(null) }
    var notFound by remember { mutableStateOf<String?>(null) }
    var qty by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var moving by remember { mutableStateOf(false) }

    fun lookup(raw: String) {
        val id = LabelId.normalize(raw)
        if (id.isEmpty()) return
        scope.launch {
            val found = dao.item(id)
            item = found
            notFound = if (found == null) id else null
            older = found?.takeIf { it.status == ItemStatus.IN_STOCK }?.let { Graph.repo.olderThan(it) }
            qty = found?.let { Format.qty(it.remaining) }.orEmpty()
            input = ""
        }
    }

    val scanner = androidx.activity.compose.rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { lookup(it) }
    }

    ScreenScaffold("Ship out", onBack, snackbar, actions = { TextButton(onClick = onReport) { Text("Report") } }) { padding ->
        FormBody(padding) {
            Button(
                onClick = {
                    scanner.launch(
                        ScanOptions()
                            .setDesiredBarcodeFormats(ScanOptions.QR_CODE, ScanOptions.CODE_128)
                            .setPrompt("Point at the label QR")
                            .setBeepEnabled(true)
                            .setOrientationLocked(false)
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Scan label") }

            OutlinedTextField(
                value = input,
                onValueChange = { v ->
                    // Hardware scanners type the code and press Enter.
                    if (v.endsWith("\n")) lookup(v) else input = v
                },
                label = { Text("Or type the label ID, e.g. ZX-251009-A0007") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { lookup(input) }),
            )

            notFound?.let { Notice("No label $it in this phone. Sync and try again, or check the ID.", status.bad, status.badSoft, "Not found") }

            item?.let { it ->
                val inStock = it.status == ItemStatus.IN_STOCK
                Panel {
                    CodeRow(
                        code = it.code,
                        title = it.id,
                        subtitle = listOfNotNull(
                            it.size.takeIf { s -> s.isNotBlank() }?.let { s -> Format.size(s) },
                            it.pallet?.let { p -> "Pallet $p" },
                            Format.date(it.receivedAt),
                        ).joinToString(" · "),
                        trailing = {
                            when {
                                inStock -> Pill("In stock", status.ok, status.okSoft)
                                it.status == ItemStatus.VOID -> Pill("Deleted", status.bad, status.badSoft)
                                else -> Pill("Shipped", status.bad, status.badSoft)
                            }
                        },
                    )
                    KeyValue("Left on this ${it.categoryEnum.pack}", Format.qtyUnit(it.remaining, it.unit))
                    LocationBadge(it.location)
                }
                if (!inStock) Notice(
                    if (it.status == ItemStatus.VOID) "This label was deleted as a mistake. Do not use it." else "This label was already shipped out.",
                    status.bad, status.badSoft,
                )
                if (it.status != ItemStatus.VOID) PastShipOuts(it.id, undone) { m ->
                    undoing = UndoTarget(m.id, m.itemId, m.code, m.qty, m.unit, m.reference)
                }

                older?.let { o ->
                    Notice(
                        "${o.id} (${o.code}) came in on ${Format.date(o.receivedAt)}" +
                            (o.pallet?.let { p -> ", pallet $p" } ?: "") + (o.location.takeIf { l -> l.isNotBlank() }?.let { l -> ", at $l" } ?: "") +
                            ". Ship that one first if you can.",
                        status.warn, status.warnSoft, "Older ${o.categoryEnum.pack} available",
                    )
                }

                if (inStock) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            qty, { qty = it }, label = { Text("${it.unit} to ship") }, singleLine = true, modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        )
                        OutlinedTextField(reference, { reference = it }, label = { Text("Customer / invoice") }, singleLine = true, modifier = Modifier.weight(1f))
                    }
                    val amount = Format.number(qty)
                    Button(
                        onClick = {
                            scope.launch {
                                try {
                                    val updated = Graph.repo.shipOut(it.id, amount!!, reference)
                                    snackbar.showSnackbar(
                                        "Shipped ${Format.qtyUnit(amount, it.unit)} of ${it.code}" +
                                            if (updated.status == ItemStatus.IN_STOCK) ", ${Format.qtyUnit(updated.remaining, it.unit)} left" else ""
                                    )
                                    item = null
                                    older = null
                                } catch (e: Exception) {
                                    snackbar.showSnackbar(e.message ?: "Could not ship out")
                                }
                            }
                        },
                        enabled = amount != null && amount > 0 && amount <= it.remaining + 1e-6,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Confirm ship out") }
                    OutlinedButton(onClick = { moving = true }, modifier = Modifier.fillMaxWidth()) { Text("Move to another place") }
                    OutlinedButton(onClick = { item = null; older = null }, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
                }
            }

            val session = shippedNow.filter { it.id !in undone }
            if (session.isNotEmpty()) {
                Text("Shipped this session", style = MaterialTheme.typography.labelLarge)
                session.forEach { m ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${m.itemId} · ${m.code}", style = MonoStyle)
                            Text(
                                Format.qtyUnit(m.qty, m.unit) + (if (m.reference.isNotBlank()) " · ${m.reference}" else ""),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { undoing = UndoTarget(m.id, m.itemId, m.code, m.qty, m.unit, m.reference) }) {
                            Text("Undo", color = status.bad)
                        }
                    }
                }
            }
        }
    }

    val current = item
    if (moving && current != null) {
        MoveDialog(
            title = "Move ${current.id}",
            initial = current.location,
            onSave = { loc ->
                moving = false
                scope.launch {
                    Graph.repo.setLocation(current.id, loc)
                    item = dao.item(current.id)
                    snackbar.showSnackbar("${current.id} moved to ${loc.ifBlank { NO_LOCATION }}")
                }
            },
            onDismiss = { moving = false },
        )
    }

    undoing?.let { target ->
        UndoDialog(
            target = target,
            onConfirm = {
                undoing = null
                scope.launch {
                    try {
                        Graph.repo.undoShipOut(target.movementId)
                        item = dao.item(target.itemId)
                        snackbar.showSnackbar("Undone: ${Format.qtyUnit(target.qty, target.unit)} of ${target.code} is back in stock")
                    } catch (e: Exception) {
                        snackbar.showSnackbar(e.message ?: "Could not undo")
                    }
                }
            },
            onDismiss = { undoing = null },
        )
    }
}

/** Earlier ship-outs of one label that are still in effect, each with Undo. */
@Composable
private fun PastShipOuts(itemId: String, undone: List<String>, onUndo: (com.zinax.stock.data.Movement) -> Unit) {
    val outs by Graph.db.dao().shipOutsOf(itemId).collectAsStateWithLifecycle(emptyList())
    val live = outs.filter { it.id !in undone }
    if (live.isEmpty()) return
    Panel {
        Text("Earlier ship-outs of this label", style = MaterialTheme.typography.labelLarge)
        live.forEach { m ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${Format.dateTime(m.at)} · ${Format.qtyUnit(m.qty, m.unit)}" +
                        (if (m.reference.isNotBlank()) " · ${m.reference}" else "") + (if (m.user.isNotBlank()) " · ${m.user}" else ""),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { onUndo(m) }) { Text("Undo", color = LocalStatus.current.bad) }
            }
        }
    }
}
