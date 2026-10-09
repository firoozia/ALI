package com.zinax.stock.ui

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
import com.zinax.stock.Graph
import com.zinax.stock.printer.PrintState
import com.zinax.stock.ui.theme.LocalStatus

/** Progress while labels are sent, then the "did they all print?" question. */
@Composable
fun PrintDialog() {
    val queue = Graph.printQueue
    val state by queue.state.collectAsStateWithLifecycle()
    val status = LocalStatus.current
    var askFrom by remember { mutableStateOf(false) }
    var from by remember { mutableStateOf("1") }

    when (val s = state) {
        PrintState.Idle -> askFrom = false
        is PrintState.Running -> AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            title = { Text("Printing ${s.title}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Label ${s.sent} of ${s.total} sent to the printer")
                    LinearProgressIndicator(progress = { if (s.total == 0) 0f else s.sent / s.total.toFloat() }, modifier = Modifier.fillMaxWidth())
                }
            },
        )
        is PrintState.Done, is PrintState.Failed -> {
            val total = if (s is PrintState.Done) s.items.size else (s as PrintState.Failed).items.size
            val failed = s as? PrintState.Failed
            AlertDialog(
                onDismissRequest = {},
                title = { Text(if (failed == null) "Did all $total labels print?" else "Printing stopped") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (failed != null) {
                            Text(failed.message, color = status.bad)
                            Text("${failed.sent} of $total labels were sent. The labels are saved; you can print them again from here or from Stock.")
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
                        TextButton(onClick = { queue.dismiss() }) { Text("Yes, all printed") }
                    } else {
                        TextButton(onClick = { queue.reprintFrom(failed.sent + 1) }) { Text("Retry") }
                    }
                },
                dismissButton = {
                    if (askFrom) {
                        TextButton(onClick = { askFrom = false }) { Text("Cancel") }
                    } else {
                        Column {
                            TextButton(onClick = {
                                from = ((failed?.sent ?: 0) + 1).coerceAtMost(total).toString()
                                askFrom = true
                            }) { Text("Reprint from…") }
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
