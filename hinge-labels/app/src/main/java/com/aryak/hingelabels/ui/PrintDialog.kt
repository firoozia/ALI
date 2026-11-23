package com.aryak.hingelabels.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aryak.hingelabels.Graph
import com.aryak.hingelabels.printer.PrintState

/** Progress while labels are sent, then the "did they all print?" question. */
@Composable
fun PrintDialog() {
    val queue = Graph.printQueue
    val state by queue.state.collectAsStateWithLifecycle()
    var askFrom by remember { mutableStateOf(false) }
    var from by remember { mutableStateOf("1") }

    when (val s = state) {
        PrintState.Idle -> askFrom = false
        is PrintState.Running -> AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            dismissButton = { TextButton(onClick = { queue.cancel() }) { Text("Cancel", color = HingeColors.Bad) } },
            title = { Text(if (s.total == 1) "Printing 1 label" else "Printing ${s.total} labels") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (s.sent == 0) "Connecting to the printer…" else "${s.sent} of ${s.total} labels sent to the printer")
                    LinearProgressIndicator(progress = { if (s.total == 0) 0f else s.sent / s.total.toFloat() }, modifier = Modifier.fillMaxWidth())
                }
            },
        )
        is PrintState.Done, is PrintState.Failed -> {
            val total = if (s is PrintState.Done) s.total else (s as PrintState.Failed).total
            val failed = s as? PrintState.Failed
            AlertDialog(
                onDismissRequest = {},
                title = { Text(if (failed != null) "Printing stopped" else if (total == 1) "Did the label print?" else "Did all $total labels print?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (failed != null) {
                            Text(failed.message, color = HingeColors.Bad)
                            Text("${failed.sent} of $total labels were sent.")
                        } else {
                            Text("If the paper ran out or a label came out blank, reprint from that label number.")
                        }
                        if (askFrom) {
                            OutlinedTextField(
                                value = from,
                                onValueChange = { v -> from = v.filter { it.isDigit() }.take(4) },
                                label = { Text("Reprint from label number (1–$total)") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            )
                        }
                    }
                },
                confirmButton = {
                    if (askFrom) {
                        TextButton(onClick = {
                            askFrom = false
                            queue.reprintFrom((from.toIntOrNull() ?: 1).coerceIn(1, total))
                        }) { Text("Reprint") }
                    } else if (failed == null) {
                        TextButton(onClick = { queue.dismiss() }) { Text(if (total == 1) "Yes, printed" else "Yes, all printed") }
                    } else {
                        TextButton(onClick = { queue.reprintFrom(failed.sent + 1) }) { Text("Retry") }
                    }
                },
                dismissButton = {
                    if (askFrom) {
                        TextButton(onClick = { askFrom = false }) { Text("Cancel") }
                    } else {
                        Column {
                            if (total > 1) TextButton(onClick = {
                                from = ((failed?.sent ?: 0) + 1).coerceAtMost(total).toString()
                                askFrom = true
                            }) { Text("Reprint from…") }
                            if (failed == null && total == 1) TextButton(onClick = { queue.reprintFrom(1) }) { Text("Print again") }
                            if (failed != null) TextButton(onClick = { queue.dismiss() }) {
                                Text("Close", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                },
            )
        }
    }
}
