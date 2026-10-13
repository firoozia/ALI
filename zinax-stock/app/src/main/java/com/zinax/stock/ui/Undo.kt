package com.zinax.stock.ui

import androidx.compose.runtime.Composable
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.data.Movement

/** What an Undo button cancels: a ship-out, a cut or a write-off. */
data class UndoTarget(
    val movementId: String, val itemId: String, val code: String, val qty: Double, val unit: String, val reference: String,
    val type: String = "OUT",
) {
    /** "ship-out", "cut" or "write-off". */
    val noun: String get() = when (type) { "CUT" -> "cut"; "WASTE" -> "write-off"; "DAMAGE" -> "damage report"; else -> "ship-out" }

    companion object {
        fun of(m: Movement) = UndoTarget(m.id, m.itemId, m.code, m.qty, m.unit, m.reference, m.type)
    }
}

/**
 * Confirmation before cancelling a ship-out, cut or write-off made by mistake. Admins undo at once;
 * users send the undo to an admin. [onDone] gets a line for the snackbar.
 */
@Composable
fun UndoDialog(target: UndoTarget, onConfirm: () -> Unit, onDismiss: () -> Unit, onDone: (String) -> Unit = {}) {
    ApprovalDialog(
        title = "Undo this ${target.noun}?",
        body = "${Format.qtyUnit(target.qty, target.unit)} of ${target.code} (${target.itemId})" +
            (if (target.reference.isNotBlank() && target.type != "WASTE" && target.type != "DAMAGE") " to ${target.reference}" else "") +
            (if (target.type == "CUT") " becomes a new open roll with its own label (printed after the undo) and leaves the reports. "
            else " goes back into stock and leaves the reports. A part of a roll becomes a new open roll with its own label. ") +
            "The sheet keeps the ${target.noun} with an UNDO line showing who cancelled it.",
        confirmLabel = "Undo ${target.noun}",
        onConfirm = onConfirm,
        request = { reason -> Graph.repo.requestUndo(target.movementId, reason) },
        onDone = { onDismiss(); onDone(it) },
        onDismiss = onDismiss,
    )
}

/** Undo, or a note that an undo is already waiting for an admin. */
@Composable
fun UndoButton(movementId: String, waiting: Set<String>, onClick: () -> Unit) {
    if (movementId in waiting) {
        androidx.compose.material3.Text(
            "Waiting for admin",
            style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
            color = com.zinax.stock.ui.theme.LocalStatus.current.warn,
        )
    } else {
        androidx.compose.material3.TextButton(onClick = onClick) {
            androidx.compose.material3.Text("Undo", color = com.zinax.stock.ui.theme.LocalStatus.current.bad)
        }
    }
}
