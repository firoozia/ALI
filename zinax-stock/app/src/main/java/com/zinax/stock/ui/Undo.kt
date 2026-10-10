package com.zinax.stock.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.zinax.stock.core.Format
import com.zinax.stock.data.Movement

/** What an Undo button cancels: a ship-out, a cut or a write-off. */
data class UndoTarget(
    val movementId: String, val itemId: String, val code: String, val qty: Double, val unit: String, val reference: String,
    val type: String = "OUT",
) {
    /** "ship-out", "cut" or "write-off". */
    val noun: String get() = when (type) { "CUT" -> "cut"; "WASTE" -> "write-off"; else -> "ship-out" }

    companion object {
        fun of(m: Movement) = UndoTarget(m.id, m.itemId, m.code, m.qty, m.unit, m.reference, m.type)
    }
}

/** Confirmation before cancelling a ship-out, cut or write-off made by mistake. */
@Composable
fun UndoDialog(target: UndoTarget, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Undo this ${target.noun}?") },
        text = {
            Text(
                "${Format.qtyUnit(target.qty, target.unit)} of ${target.code} (${target.itemId})" +
                    (if (target.reference.isNotBlank() && target.type != "WASTE") " to ${target.reference}" else "") +
                    " goes back into stock and leaves the reports. " +
                    "The sheet keeps the ${target.noun} with an UNDO line showing who cancelled it."
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Undo ${target.noun}") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
