package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.core.Lengths
import com.zinax.stock.data.Item
import kotlinx.coroutines.launch

private val REASONS = listOf("Torn", "Stained", "Water damage", "Crushed core", "Factory defect", "Other")

private data class DamageEntry(val qty: Double, val reason: String, val note: String)

/**
 * Records damaged material found on a roll: how much, and why. An admin records it at once; a user sends it
 * to an admin. [onDone] gets a line for the snackbar once it is recorded or sent.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DamageDialog(item: Item, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val metres = item.unit.equals("m", ignoreCase = true)
    var cm by remember { mutableStateOf(Graph.prefs.cutInCm && metres) }
    var whole by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf<DamageEntry?>(null) }

    val qty = if (whole) item.remaining else Lengths.parse(text, cm && metres)
    val fits = qty != null && qty > 0 && qty <= item.remaining + 1e-6
    val ready = fits && reason != null && (reason != "Other" || note.isNotBlank())

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Report damage") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "${item.code} · ${item.id} · ${Format.qtyUnit(item.remaining, item.unit)} on the roll",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        text, { text = it; whole = false }, label = { Text("Damaged length" + if (metres) "" else " (${item.unit})") },
                        singleLine = true, modifier = Modifier.weight(1f), enabled = !whole,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    if (metres) {
                        FilterChip(selected = !cm, onClick = { cm = false }, label = { Text("m") })
                        FilterChip(selected = cm, onClick = { cm = true }, label = { Text("cm") })
                    }
                }
                FilterChip(
                    selected = whole, onClick = { whole = !whole },
                    label = { Text("Whole roll (${Format.qtyUnit(item.remaining, item.unit)})") },
                )
                if (qty != null && !fits) {
                    Text("Only ${Format.qtyUnit(item.remaining, item.unit)} on this roll.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Text("Reason", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    REASONS.forEach { r -> FilterChip(selected = reason == r, onClick = { reason = r }, label = { Text(r) }) }
                }
                OutlinedTextField(
                    note, { note = it }, label = { Text(if (reason == "Other") "What happened" else "Note (optional)") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { confirming = DamageEntry(qty!!, reason!!, note.trim()) }, enabled = ready) { Text("Next") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )

    confirming?.let { e ->
        val what = listOf(e.reason, e.note).filter { it.isNotBlank() }.joinToString(" · ")
        ApprovalDialog(
            title = "Report this damage?",
            body = "${Format.qtyUnit(e.qty, item.unit)} of ${item.code} (${item.id}): $what. " +
                "It leaves the stock and shows in Reports under Damage. An admin can undo it later.",
            confirmLabel = "Report damage",
            onConfirm = {
                scope.launch {
                    try {
                        Graph.repo.reportDamage(item.id, e.qty, e.reason, e.note)
                        onDismiss()
                        onDone("Damage reported: ${Format.qtyUnit(e.qty, item.unit)} of ${item.code}")
                    } catch (ex: Exception) {
                        confirming = null
                        onDone(ex.message ?: "Could not report the damage")
                    }
                }
            },
            request = { why -> Graph.repo.requestDamage(item.id, e.qty, e.reason, e.note, why) },
            onDone = { msg -> onDismiss(); onDone(msg) },
            onDismiss = { confirming = null },
        )
    }
}
