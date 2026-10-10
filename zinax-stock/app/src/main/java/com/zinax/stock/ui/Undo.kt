package com.zinax.stock.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.zinax.stock.core.Format

/** What an Undo button cancels. */
data class UndoTarget(val movementId: String, val itemId: String, val code: String, val qty: Double, val unit: String, val reference: String)

/** Confirmation before cancelling a ship-out made by mistake. */
@Composable
fun UndoDialog(target: UndoTarget, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Undo this ship-out?") },
        text = {
            Text(
                "${Format.qtyUnit(target.qty, target.unit)} of ${target.code} (${target.itemId})" +
                    (if (target.reference.isNotBlank()) " to ${target.reference}" else "") +
                    " goes back into stock and leaves the ship-out reports. " +
                    "The sheet keeps the ship-out with an UNDO line showing who cancelled it."
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Undo ship-out") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
