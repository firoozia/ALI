package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Pin
import com.zinax.stock.data.AppUser
import com.zinax.stock.data.Roles
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Covers the whole app while nobody is signed in: first-admin setup, or the PIN screen. */
@Composable
fun LockScreen() {
    val users by Graph.db.dao().users().collectAsStateWithLifecycle(null)
    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Zinax Stock", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                val active = users?.filter { it.active }
                when {
                    active == null -> {}
                    active.isEmpty() -> FirstSetup()
                    else -> Unlock(active)
                }
                // Room to scroll the last button clear of the phone's navigation buttons.
                Spacer(Modifier.height(96.dp))
            }
        }
    }
}

/** Checks a PIN off the main thread; the hash is deliberately slow. */
suspend fun pinOk(u: AppUser, pin: String): Boolean = withContext(Dispatchers.Default) { Pin.matches(pin, u.salt, u.pinHash) }

@Composable
fun PinField(value: String, onChange: (String) -> Unit, label: String, onDone: (() -> Unit)? = null, modifier: Modifier = Modifier.fillMaxWidth()) {
    OutlinedTextField(
        value, { v -> onChange(v.filter { it in '0'..'9' }.take(Pin.MAX)) }, label = { Text(label) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = modifier,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
    )
}

/** One chip per user; admins are marked. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UserPicker(users: List<AppUser>, selected: AppUser?, onPick: (AppUser) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        users.forEach { u ->
            FilterChip(selected = u.id == selected?.id, onClick = { onPick(u) }, label = { Text(if (u.isAdmin) "${u.name} · Admin" else u.name) })
        }
    }
}

@Composable
private fun Unlock(users: List<AppUser>) {
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    var picked by remember { mutableStateOf<String?>(null) }
    val user = users.firstOrNull { it.id == picked } ?: users.firstOrNull { it.id == Graph.prefs.lastUserId } ?: users.first()
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var wrong by remember { mutableIntStateOf(0) }
    var waitUntil by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var busy by remember { mutableStateOf(false) }
    var forgot by remember { mutableStateOf(false) }
    var syncMsg by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(waitUntil) { while (System.currentTimeMillis() < waitUntil) { now = System.currentTimeMillis(); delay(500) }; now = System.currentTimeMillis() }
    val blocked = now < waitUntil

    fun submit() {
        if (busy || blocked || !Pin.valid(pin)) return
        busy = true
        scope.launch {
            if (pinOk(user, pin)) {
                wrong = 0
                Graph.session.login(user)
            } else {
                wrong++
                error = "Wrong PIN"
                if (wrong >= 5) {
                    wrong = 0
                    waitUntil = System.currentTimeMillis() + 30_000
                    error = "Too many wrong PINs. Wait 30 seconds."
                }
            }
            pin = ""
            busy = false
        }
    }

    Text("Locked. Pick your name and enter your PIN.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    UserPicker(users, user) { picked = it.id; pin = ""; error = null }
    PinField(pin, { pin = it; error = null }, "PIN for ${user.name}", onDone = { submit() })
    error?.let { Text(if (blocked) "$it (${(waitUntil - now) / 1000 + 1} s)" else it, color = status.bad) }
    Button(onClick = { submit() }, enabled = Pin.valid(pin) && !busy && !blocked, modifier = Modifier.fillMaxWidth()) { Text("Unlock") }
    HorizontalDivider()
    TextButton(onClick = { forgot = true }) { Text("Forgot PIN?") }
    TextButton(onClick = {
        scope.launch {
            syncMsg = "Syncing…"
            syncMsg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
        }
    }) { Text("Sync to get new users") }
    syncMsg?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

    if (forgot) ResetPinDialog(users) { forgot = false }
}

/** With the admin code from the Apps Script log, sets a new PIN for anyone. */
@Composable
private fun ResetPinDialog(users: List<AppUser>, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var who by remember { mutableStateOf(users.firstOrNull { it.isAdmin } ?: users.first()) }
    var code by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var pin2 by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Set a new PIN") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Needs the admin code from the Apps Script log (run setup to see it) and internet.", style = MaterialTheme.typography.bodySmall)
                UserPicker(users, who) { who = it }
                OutlinedTextField(code, { code = it }, label = { Text("Admin code") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                PinField(pin, { pin = it }, "New PIN (${Pin.MIN}–${Pin.MAX} digits)")
                PinField(pin2, { pin2 = it }, "New PIN again")
                error?.let { Text(it, color = LocalStatus.current.bad) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && code.isNotBlank() && Pin.valid(pin) && pin == pin2,
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            Graph.sync.verifyAdminCode(code)
                            Graph.repo.setPin(who.id, pin)
                            try { Graph.sync.sync() } catch (_: Exception) {}
                            onClose()
                        } catch (e: Exception) {
                            error = e.message ?: "Could not check the code"
                        }
                        busy = false
                    }
                },
            ) { Text("Save PIN") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

/** No users yet: fetch them from the sheet, or create the first admin with the admin code. */
@Composable
private fun FirstSetup() {
    val scope = rememberCoroutineScope()
    val prefs = Graph.prefs
    val status = LocalStatus.current
    var url by remember { mutableStateOf(prefs.webAppUrl) }
    var token by remember { mutableStateOf(prefs.token) }
    var name by remember { mutableStateOf(prefs.userName) }
    var pin by remember { mutableStateOf("") }
    var pin2 by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Text("Set up users", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
    Text(
        "From this version everyone signs in with a PIN. Admins approve undo and delete, receive goods and change settings.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Panel {
        Text("1. Google Sheet", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(url, { url = it; prefs.webAppUrl = it }, label = { Text("Web app URL (…/exec)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it; prefs.token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedButton(onClick = {
            busy = true
            scope.launch {
                msg = try { Graph.sync.sync() + if (Graph.db.dao().allUsers().isEmpty()) ". No users in the sheet yet." else "" } catch (e: Exception) { e.message }
                busy = false
            }
        }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Get users from the sheet") }
        Text(
            "If an admin already set up users on another phone, this is all you need.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        msg?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    Panel {
        Text("2. Or create the first admin", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        PinField(pin, { pin = it }, "PIN (${Pin.MIN}–${Pin.MAX} digits)")
        PinField(pin2, { pin2 = it }, "PIN again")
        if (pin2.isNotEmpty() && pin != pin2) Text("The PINs are not the same", color = status.bad)
        OutlinedTextField(code, { code = it }, label = { Text("Admin code from the Apps Script log") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Text(
            "In Apps Script run setup once; the log shows the token and the admin code.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let { Text(it, color = status.bad) }
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        Graph.sync.verifyAdminCode(code)
                        val u = Graph.repo.addUser(name, Roles.ADMIN, true, pin)
                        Graph.session.login(u)
                        try { Graph.sync.sync() } catch (_: Exception) {}
                    } catch (e: Exception) {
                        error = e.message ?: "Could not create the admin"
                    }
                    busy = false
                }
            },
            enabled = !busy && name.isNotBlank() && Pin.valid(pin) && pin == pin2 && code.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Create admin and sign in") }
    }
}
