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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Pin
import com.zinax.stock.data.AppUser
import com.zinax.stock.data.Roles
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** Admins add people, set who is admin or may receive goods, reset PINs and turn users off. */
@Composable
fun UsersScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val users by Graph.db.dao().users().collectAsStateWithLifecycle(emptyList())
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<AppUser?>(null) }
    var pinFor by remember { mutableStateOf<AppUser?>(null) }
    val status = LocalStatus.current

    ScreenScaffold("Users", onBack, snackbar, actions = { TextButton(onClick = { adding = true }) { Text("Add user") } }) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Text(
                    "Shared with every phone and the Users tab of the sheet. Users can ship out, cut, move and print; " +
                        "their undo and delete wait for an admin. Turn on Can receive for users who receive goods.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(users, key = { it.id }) { u ->
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(u.name, fontWeight = FontWeight.SemiBold, color = if (u.active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                listOfNotNull(
                                    if (u.isAdmin) "Admin" else "User",
                                    "can receive".takeIf { !u.isAdmin && u.canReceive },
                                    "turned off".takeIf { !u.active },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = if (u.active) MaterialTheme.colorScheme.onSurfaceVariant else status.bad,
                            )
                        }
                        TextButton(onClick = { editing = u }) { Text("Edit") }
                        TextButton(onClick = { pinFor = u }) { Text("PIN") }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    if (adding) {
        var name by remember { mutableStateOf("") }
        var admin by remember { mutableStateOf(false) }
        var receive by remember { mutableStateOf(false) }
        var pin by remember { mutableStateOf("") }
        var pin2 by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Add user") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    RoleChips(admin) { admin = it }
                    if (!admin) ToggleRow("Can receive goods and print labels", receive) { receive = it }
                    PinField(pin, { pin = it }, "PIN (${Pin.MIN}–${Pin.MAX} digits)")
                    PinField(pin2, { pin2 = it }, "PIN again")
                    error?.let { Text(it, color = status.bad) }
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank() && Pin.valid(pin) && pin == pin2, onClick = {
                    scope.launch {
                        try {
                            Graph.repo.addUser(name, if (admin) Roles.ADMIN else Roles.USER, admin || receive, pin)
                            adding = false
                            snackbar.showSnackbar("${name.trim()} added. Tell them their PIN.")
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("Add") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } },
        )
    }

    editing?.let { u ->
        var name by remember(u.id) { mutableStateOf(u.name) }
        var admin by remember(u.id) { mutableStateOf(u.isAdmin) }
        var receive by remember(u.id) { mutableStateOf(u.canReceive) }
        var active by remember(u.id) { mutableStateOf(u.active) }
        var error by remember(u.id) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Edit ${u.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    RoleChips(admin) { admin = it }
                    if (!admin) ToggleRow("Can receive goods and print labels", receive) { receive = it }
                    ToggleRow("Active (can sign in)", active) { active = it }
                    error?.let { Text(it, color = status.bad) }
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = {
                    scope.launch {
                        try {
                            Graph.repo.updateUser(u.id, name, if (admin) Roles.ADMIN else Roles.USER, admin || receive, active)
                            Graph.session.refresh()
                            editing = null
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
        )
    }

    pinFor?.let { u -> NewPinDialog(u, "New PIN for ${u.name}", onDone = { pinFor = null; scope.launch { snackbar.showSnackbar("PIN changed for ${u.name}") } }) { pinFor = null } }
}

/** Sets a new PIN for [user]; used by admins in Users and by anyone for their own PIN in Settings. */
@Composable
fun NewPinDialog(user: AppUser, title: String, askCurrent: Boolean = false, onDone: () -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var pin2 by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (askCurrent) PinField(current, { current = it }, "Current PIN")
                PinField(pin, { pin = it }, "New PIN (${Pin.MIN}–${Pin.MAX} digits)")
                PinField(pin2, { pin2 = it }, "New PIN again")
                error?.let { Text(it, color = LocalStatus.current.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = Pin.valid(pin) && pin == pin2 && (!askCurrent || Pin.valid(current)), onClick = {
                scope.launch {
                    if (askCurrent && !pinOk(user, current)) {
                        error = "Current PIN is wrong"
                        return@launch
                    }
                    try {
                        Graph.repo.setPin(user.id, pin)
                        Graph.session.refresh()
                        onDone()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun RoleChips(admin: Boolean, onChange: (Boolean) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        FilterChip(selected = !admin, onClick = { onChange(false) }, label = { Text("User") })
        FilterChip(selected = admin, onClick = { onChange(true) }, label = { Text("Admin") })
    }
}

@Composable
private fun ToggleRow(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
