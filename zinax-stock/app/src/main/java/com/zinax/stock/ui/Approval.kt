package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Pin
import com.zinax.stock.data.ChangeRequest
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** IDs of movements and labels with an undo or delete waiting for an admin. */
@Composable
fun rememberWaiting(): Set<String> {
    val pending by Graph.db.dao().pendingRequests().collectAsStateWithLifecycle(emptyList())
    return remember(pending) { pending.flatMap { it.targets }.toSet() }
}

/**
 * Confirms an undo or delete. An admin does it at once with [onConfirm]. A user sends a request with
 * [request] instead, or an admin standing by approves it on this phone with their PIN.
 * [onDone] gets a line for the snackbar.
 */
@Composable
fun ApprovalDialog(
    title: String,
    body: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    request: suspend (reason: String) -> ChangeRequest,
    onDone: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val session by Graph.session.user.collectAsStateWithLifecycle()
    if (session?.isAdmin == true) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(title) },
            text = { Text(body) },
            confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = LocalStatus.current.bad) } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        return
    }

    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    val users by Graph.db.dao().users().collectAsStateWithLifecycle(emptyList())
    val admins = remember(users) { users.filter { it.isAdmin && it.active } }
    var reason by remember { mutableStateOf("") }
    var adminHere by remember { mutableStateOf(false) }
    var adminId by remember { mutableStateOf<String?>(null) }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val admin = admins.firstOrNull { it.id == adminId } ?: admins.firstOrNull()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (adminHere) "Admin approves now" else "Ask an admin") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(body)
                Text(
                    "Only an admin can do this. Nothing changes until an admin approves; they get a notification.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(reason, { reason = it }, label = { Text("Reason (optional)") }, modifier = Modifier.fillMaxWidth())
                if (adminHere) {
                    if (admins.isEmpty()) Text("No admin on this phone yet. Sync and try again.", color = status.bad)
                    else {
                        UserPicker(admins, admin) { adminId = it.id; pin = "" }
                        PinField(pin, { pin = it; error = null }, "PIN of ${admin?.name}")
                    }
                }
                error?.let { Text(it, color = status.bad) }
            }
        },
        confirmButton = {
            if (adminHere) {
                TextButton(enabled = !busy && admin != null && Pin.valid(pin), onClick = {
                    val a = admin ?: return@TextButton
                    busy = true
                    scope.launch {
                        try {
                            if (!pinOk(a, pin)) {
                                error = "Wrong PIN"
                            } else {
                                val r = request(reason)
                                val roll = Graph.repo.approveRequest(r.id, a.name)
                                Graph.printUndoRoll(roll)
                                onDone("Done, approved by ${a.name}" + (roll?.let { " · new open roll ${it.id}" } ?: ""))
                            }
                        } catch (e: Exception) {
                            error = e.message ?: "Could not do it"
                        }
                        pin = ""
                        busy = false
                    }
                }) { Text("Approve and $confirmLabel".lowercase().replaceFirstChar { it.uppercase() }) }
            } else {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            request(reason)
                            onDone("Sent to the admins. It happens when one approves.")
                        } catch (e: Exception) {
                            error = e.message ?: "Could not send"
                        }
                        busy = false
                    }
                }) { Text("Send to admin") }
            }
        },
        dismissButton = {
            Column {
                TextButton(onClick = { adminHere = !adminHere; error = null }) { Text(if (adminHere) "Send instead" else "Admin is here") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}
