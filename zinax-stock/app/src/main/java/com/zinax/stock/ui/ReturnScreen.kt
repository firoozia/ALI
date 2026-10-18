package com.zinax.stock.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.data.Movement
import com.zinax.stock.data.MovementType
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

/**
 * Customer return: choose the customer, tap the ship-out or cut the material came from, enter how much came back.
 * A whole roll goes back on its own label; a piece becomes a new open roll and its label is printed.
 */
@Composable
fun ReturnScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val status = LocalStatus.current
    val prefs = Graph.prefs
    var customer by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<Movement?>(null) }
    var qty by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var location by remember { mutableStateOf(prefs.moveTarget) }
    var busy by remember { mutableStateOf(false) }
    val name = customer.trim()
    val outs by remember(name) { if (name.length < 2) flowOf(emptyList()) else Graph.db.dao().outsForCustomer(name) }
        .collectAsStateWithLifecycle(emptyList())
    val undone by remember { Graph.db.dao().undoneIds() }.collectAsStateWithLifecycle(emptyList())
    val list = outs.filter { it.id !in undone }

    ScreenScaffold("Customer return", onBack, snackbar) { padding ->
        FormBody(padding) {
            CustomerField(customer, { customer = it; chosen = null })
            val m = chosen
            if (m == null) {
                if (name.length >= 2 && list.isEmpty()) {
                    Text("No ship-outs or cuts for this customer on this phone.", style = MaterialTheme.typography.bodySmall)
                }
                if (list.isNotEmpty()) {
                    Text("What came back from?", style = MaterialTheme.typography.titleSmall)
                    Panel {
                        list.take(60).forEachIndexed { i, o ->
                            if (i > 0) HorizontalDivider()
                            Column(Modifier.fillMaxWidth().clickable { chosen = o; qty = Format.qty(o.qty) }.padding(vertical = 4.dp)) {
                                Text(
                                    "${o.code} ${Format.size(o.size)}".trim() + " · " + Format.qtyUnit(o.qty, o.unit),
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    listOf(if (o.type == MovementType.CUT) "Cut" else "Shipped out", Format.dateTime(o.at), o.invoice, o.itemId)
                                        .filter { it.isNotBlank() }.joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                Text(
                    "Choose the customer, then the ship-out or cut the material came from.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Panel {
                    Text("${m.code} ${Format.size(m.size)}".trim(), fontWeight = FontWeight.Bold)
                    Text(
                        "${if (m.type == MovementType.CUT) "Cut" else "Shipped out"} ${Format.qtyUnit(m.qty, m.unit)} · ${Format.dateTime(m.at)} · ${m.itemId}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                OutlinedTextField(
                    qty, { qty = it }, label = { Text("Quantity returned (${m.unit})") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(note, { note = it }, label = { Text("Reason (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                LocationPicker(location, { location = it; prefs.moveTarget = it }, label = "Put away in")
                Button(
                    enabled = !busy && (Format.number(qty) ?: 0.0) > 0,
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val r = Graph.repo.returnFromCustomer(m.id, Format.number(qty) ?: 0.0, name, m.invoice, note, location)
                                if (r.newLabel) Graph.printQueue.printLabels(listOf(LabelSpec.Remainder(r.item)), "return ${r.item.id}")
                                snackbar.showSnackbar(
                                    if (r.newLabel) "Returned as new open roll ${r.item.id} · printing its label"
                                    else "${r.item.id} is back in stock with its own label"
                                )
                                chosen = null; qty = ""; note = ""
                            } catch (e: Exception) {
                                snackbar.showSnackbar(e.message ?: "Could not save")
                            } finally {
                                busy = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Record return") }
                androidx.compose.material3.TextButton(onClick = { chosen = null }) { Text("Choose another") }
            }
        }
    }
}
