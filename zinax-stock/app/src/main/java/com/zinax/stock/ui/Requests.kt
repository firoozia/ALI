package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.data.ChangeRequest
import com.zinax.stock.data.RequestStatus
import com.zinax.stock.sync.RequestNotifier
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

private data class Decision(val request: ChangeRequest, val approve: Boolean)

/**
 * Undo and delete requests. Admins see every request waiting and approve or reject it; users see their own.
 * [openId] with [openAction] ("approve" or "reject") comes from a notification button.
 */
@Composable
fun RequestsScreen(onBack: () -> Unit, openId: String? = null, openAction: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val me by Graph.session.user.collectAsStateWithLifecycle()
    val all by Graph.db.dao().requests().collectAsStateWithLifecycle(emptyList())
    val admin = me?.isAdmin == true
    val shown = remember(all, me) { if (admin) all else all.filter { it.requestedBy == me?.name } }
    val pending = shown.filter { it.status == RequestStatus.PENDING }
    val done = shown.filter { it.status != RequestStatus.PENDING }
    var deciding by remember { mutableStateOf<Decision?>(null) }
    var opened by remember { mutableStateOf(false) }
    val status = LocalStatus.current

    LaunchedEffect(all, openId) {
        if (opened || openId == null || !admin) return@LaunchedEffect
        val r = all.firstOrNull { it.id == openId } ?: return@LaunchedEffect
        opened = true
        if (r.status == RequestStatus.PENDING && openAction in setOf(RequestNotifier.APPROVE, RequestNotifier.REJECT)) {
            deciding = Decision(r, openAction == RequestNotifier.APPROVE)
        } else if (r.status != RequestStatus.PENDING) {
            snackbar.showSnackbar("Already ${r.status.lowercase()} by ${r.decidedBy}")
        }
    }

    ScreenScaffold("Requests", onBack, snackbar) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text(
                    if (admin) "Undo and delete asked by users. Approving does it now, in your name." else "Your undo and delete requests.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item { Text("Waiting (${pending.size})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            if (pending.isEmpty()) item { Text("Nothing waiting.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(pending, key = { it.id }) { r ->
                Panel(border = status.warn) {
                    RequestText(r)
                    if (admin) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { deciding = Decision(r, true) }, modifier = Modifier.weight(1f)) { Text("Approve") }
                            OutlinedButton(onClick = { deciding = Decision(r, false) }, modifier = Modifier.weight(1f)) { Text("Reject") }
                        }
                    } else {
                        Text("Waiting for an admin", color = status.warn, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            if (done.isNotEmpty()) item { Text("Answered", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            items(done, key = { it.id }) { r ->
                Panel {
                    RequestText(r)
                    val ok = r.status == RequestStatus.APPROVED
                    Text(
                        (if (ok) "Approved" else "Rejected") + " by ${r.decidedBy} · ${Format.dateTime(r.decidedAt)}" +
                            if (r.note.isNotBlank()) " · ${r.note}" else "",
                        color = if (ok) status.ok else status.bad,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
            item {
                OutlinedButton(onClick = {
                    scope.launch { snackbar.showSnackbar(try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }) }
                }, modifier = Modifier.fillMaxWidth()) { Text("Sync now") }
            }
        }
    }

    deciding?.let { d ->
        var note by remember(d) { mutableStateOf("") }
        val name = me?.name.orEmpty()
        AlertDialog(
            onDismissRequest = { deciding = null },
            title = { Text(if (d.approve) "Approve?" else "Reject?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    RequestText(d.request)
                    if (d.approve) Text("This is done now, in your name.", style = MaterialTheme.typography.bodySmall)
                    else OutlinedTextField(note, { note = it }, label = { Text("Note for ${d.request.requestedBy} (optional)") }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    deciding = null
                    scope.launch {
                        try {
                            val roll = if (d.approve) Graph.repo.approveRequest(d.request.id, name) else { Graph.repo.rejectRequest(d.request.id, name, note); null }
                            Graph.printUndoRoll(roll)
                            RequestNotifier.cancel(context, d.request.id)
                            snackbar.showSnackbar(
                                if (d.approve) "Approved and done" + (roll?.let { " · new open roll ${it.id}" } ?: "") else "Rejected",
                            )
                        } catch (e: Exception) {
                            snackbar.showSnackbar(e.message ?: "Could not do it")
                        }
                    }
                }) { Text(if (d.approve) "Approve" else "Reject", color = if (d.approve) status.ok else status.bad) }
            },
            dismissButton = { TextButton(onClick = { deciding = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun RequestText(r: ChangeRequest) {
    Text(r.summary, fontWeight = FontWeight.Medium)
    Text(
        "${r.requestedBy} · ${Format.dateTime(r.requestedAt)}" + if (r.reason.isNotBlank()) " · “${r.reason}”" else "",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
