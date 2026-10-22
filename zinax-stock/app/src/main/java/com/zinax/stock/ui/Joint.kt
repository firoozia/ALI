package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
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
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.data.Item
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

private val JOINT_REASONS = listOf("Joint", "Short piece", "Other")

/**
 * Splits a roll at a joint: the metres up to the joint become a new open roll with its own label, the roll keeps
 * the rest. Both labels are printed at once, or offered with a button when the Settings switch is off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JointDialog(item: Item, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    var lengthText by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf(JOINT_REASONS.first()) }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // Set once split, when the labels wait for the Print button.
    var made by remember { mutableStateOf<Pair<Item, Item>?>(null) }
    val length = Format.number(lengthText)
    val fits = length != null && length > 0 && length < item.remaining - 1e-6

    fun print(pair: Pair<Item, Item>) {
        Graph.printQueue.printLabels(listOf(LabelSpec.Remainder(pair.first), LabelSpec.Remainder(pair.second)), "joint ${pair.first.id}")
    }

    made?.let { pair ->
        AlertDialog(
            onDismissRequest = { onDone("Split ${pair.first.id}: ${Format.qtyUnit(pair.first.remaining, pair.first.unit)} left · new roll ${pair.second.id}") },
            title = { Text("Roll split") },
            text = {
                Text(
                    "${pair.first.id} · ${Format.qtyUnit(pair.first.remaining, pair.first.unit)}\n" +
                        "${pair.second.id} · ${Format.qtyUnit(pair.second.remaining, pair.second.unit)} (new)\n\n" +
                        "Stick each label on its roll.",
                )
            },
            confirmButton = {
                TextButton(onClick = { print(pair); onDone("Printing 2 labels") }) { Text("Print both labels") }
            },
            dismissButton = {
                TextButton(onClick = { onDone("Split ${pair.first.id} · new roll ${pair.second.id}") }) { Text("Later") }
            },
        )
        return
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Joint in ${item.id}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${item.code} · ${Format.qtyUnit(item.remaining, item.unit)} on this roll", fontWeight = FontWeight.SemiBold)
                Text(
                    "Enter the length up to the joint. It becomes a new open roll with its own label and the rest stays on this roll. " +
                        "Nothing leaves stock.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    lengthText, { lengthText = it; error = null }, label = { Text("Length up to the joint (${item.unit})") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    JOINT_REASONS.forEach { r -> FilterChip(selected = reason == r, onClick = { reason = r }, label = { Text(r) }) }
                }
                if (reason == "Other") {
                    OutlinedTextField(note, { note = it }, label = { Text("What is it?") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                if (length != null && length > 0) {
                    if (fits) {
                        Text(
                            "This roll: ${Format.qtyUnit(item.remaining - length, item.unit)} · New roll: ${Format.qtyUnit(length, item.unit)}",
                            fontWeight = FontWeight.SemiBold,
                        )
                    } else {
                        Text("Must be shorter than ${Format.qtyUnit(item.remaining, item.unit)}", color = status.bad)
                    }
                }
                error?.let { Text(it, color = status.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = fits && !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        val why = if (reason == "Other") note.trim().ifEmpty { "Other" } else reason
                        val pair = Graph.repo.splitRoll(item.id, length ?: 0.0, why)
                        if (Graph.prefs.autoPrintSplit) {
                            print(pair)
                            onDone("Split ${pair.first.id} · new roll ${pair.second.id} · printing 2 labels")
                        } else {
                            made = pair
                        }
                    } catch (e: Exception) {
                        error = e.message ?: "Could not split"
                    } finally {
                        busy = false
                    }
                }
            }) { Text("Split roll") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
