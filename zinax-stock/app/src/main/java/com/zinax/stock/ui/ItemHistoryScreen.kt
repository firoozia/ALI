package com.zinax.stock.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import com.zinax.stock.data.Movement
import com.zinax.stock.data.MovementType
import com.zinax.stock.data.Shipment
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

private fun typeName(type: String) = when (type) {
    MovementType.IN -> "Received"
    MovementType.OUT -> "Shipped out"
    MovementType.CUT -> "Cut"
    MovementType.WASTE -> "Waste"
    MovementType.DAMAGE -> "Damage"
    MovementType.RETURN -> "Returned by customer"
    MovementType.MOVE -> "Moved"
    MovementType.RESERVE -> "Reservation"
    "ADJUST" -> "Amount changed in the sheet"
    MovementType.EDIT -> "Edited"
    MovementType.VOID -> "Deleted"
    MovementType.UNDO -> "Undo"
    else -> type
}

private fun who(m: Movement) = m.user.ifBlank { "phone ${m.device}" }

/** Scan one label to see what it is, where it is, and everything that happened to it, with who did it. */
@Composable
fun ItemHistoryScreen(initialId: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val status = LocalStatus.current
    val dao = Graph.db.dao()
    var id by remember { mutableStateOf(LabelId.normalize(initialId)) }
    var typed by remember { mutableStateOf("") }
    var item by remember { mutableStateOf<Item?>(null) }
    var shipment by remember { mutableStateOf<Shipment?>(null) }
    var looked by remember { mutableStateOf(false) }
    val history by remember(id) { if (id.isEmpty()) flowOf(emptyList()) else dao.movementsOf(id) }
        .collectAsStateWithLifecycle(emptyList())

    // Reload the package whenever its history changes, so a move or cut made elsewhere shows at once.
    LaunchedEffect(id, history.size) {
        if (id.isEmpty()) return@LaunchedEffect
        item = dao.item(id)
        shipment = item?.shipmentId?.let { dao.shipment(it) }
        looked = true
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { id = LabelId.normalize(it); looked = false }
    }
    val scan: () -> Unit = {
        Graph.session.leaving()
        try {
            scanner.launch(
                ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE, ScanOptions.CODE_128)
                    .setPrompt("Scan a label to see its history").setBeepEnabled(true).setOrientationLocked(false)
            )
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("Could not open the camera: ${e.message ?: e.javaClass.simpleName}") }
        }
    }
    // Opened from the home screen with no label: go straight to the camera.
    LaunchedEffect(Unit) { if (initialId.isBlank()) scan() }

    ScreenScaffold("Label history", onBack, snackbar) { padding ->
        FormBody(padding) {
            Button(onClick = scan, modifier = Modifier.fillMaxWidth()) { Text("Scan a label") }
            OutlinedTextField(
                value = typed,
                onValueChange = { v -> if (v.endsWith("\n")) { id = LabelId.normalize(v); looked = false; typed = "" } else typed = v },
                label = { Text("Or type the label ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { id = LabelId.normalize(typed); looked = false; typed = "" }),
            )
            if (id.isEmpty()) return@FormBody
            val it = item
            if (it == null) {
                if (looked) Notice("$id is not in this phone. Sync and scan again.", status.bad, status.badSoft)
                return@FormBody
            }

            val received = history.firstOrNull { m -> m.type == MovementType.IN || m.type == MovementType.RETURN }
            val undone = history.filter { m -> m.type == MovementType.UNDO }.associateBy { m -> m.reference }
            Panel {
                Text(it.id, style = MonoStyle)
                Text("${it.code} ${Format.size(it.size)}".trim(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                when (it.status) {
                    ItemStatus.IN_STOCK -> Pill(if (it.isOpen) "In stock · open" else "In stock", status.ok, status.okSoft)
                    ItemStatus.SHIPPED -> Pill("Shipped", status.warn, status.warnSoft)
                    else -> Pill("Deleted", status.bad, status.badSoft)
                }
                KeyValue("Left", "${Format.qtyUnit(it.remaining, it.unit)} of ${Format.qtyUnit(it.qty, it.unit)}")
                KeyValue("Place", it.location.ifBlank { NO_LOCATION })
                if (it.reservedFor.isNotBlank()) KeyValue("Reserved for", it.reservedFor)
                KeyValue("Group", it.categoryEnum.label)
                shipment?.let { s -> KeyValue("Shipment", s.name) }
                it.pallet?.takeIf { p -> p.isNotBlank() }?.let { p -> KeyValue("Pallet", p) }
                KeyValue("Received", Format.dateTime(it.receivedAt))
                KeyValue("Received by", received?.let { m -> who(m) } ?: "phone ${it.device}")
            }

            Text("History", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (history.isEmpty()) {
                Text("No history on this phone yet. Sync to get it.", style = MaterialTheme.typography.bodySmall)
            } else {
                Panel {
                    history.asReversed().forEachIndexed { i, m ->
                        if (i > 0) HorizontalDivider()
                        val cancel = undone[m.id]
                        Column {
                            Text(
                                typeName(m.type) + (if (m.type in setOf(MovementType.OUT, MovementType.CUT, MovementType.WASTE, MovementType.DAMAGE, MovementType.IN, MovementType.RETURN, "ADJUST"))
                                    " · ${Format.qtyUnit(m.qty, m.unit)}" else ""),
                                fontWeight = FontWeight.SemiBold,
                                color = if (cancel != null) status.warn else MaterialTheme.colorScheme.onSurface,
                            )
                            val detail = when (m.type) {
                                MovementType.UNDO -> ""
                                else -> listOf(m.customer, m.invoice).filter { s -> s.isNotBlank() }.joinToString(" · ").ifBlank { m.reference }
                            }
                            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall)
                            Text(
                                "${Format.dateTime(m.at)} · ${who(m)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (cancel != null) {
                                Text("Undone by ${who(cancel)} · ${Format.dateTime(cancel.at)}", style = MaterialTheme.typography.bodySmall, color = status.warn)
                            }
                        }
                    }
                }
            }
        }
    }
}
