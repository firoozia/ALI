package com.zinax.stock.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Biometric
import com.zinax.stock.Graph
import com.zinax.stock.Share
import com.zinax.stock.core.Category
import com.zinax.stock.core.LabelId
import com.zinax.stock.core.Lengths
import com.zinax.stock.label.Tspl
import com.zinax.stock.ui.theme.AppTheme
import com.zinax.stock.ui.theme.Emerald
import com.zinax.stock.ui.theme.Zinax
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.printer.PairedPrinter
import com.zinax.stock.sync.ReportWorker
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onBack: () -> Unit, onCustomers: () -> Unit, onUsers: () -> Unit, onCatalog: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val prefs = Graph.prefs
    val printer = Graph.printer
    val tick by prefs.changes.collectAsStateWithLifecycle()

    var paired by remember { mutableStateOf<List<PairedPrinter>>(emptyList()) }
    var btMessage by remember { mutableStateOf<String?>(null) }
    fun refreshPrinters() {
        paired = printer.paired()
        btMessage = when {
            !printer.hasPermission() -> "Allow Nearby devices so the app can see the printer."
            !printer.bluetoothOn() -> "Bluetooth is off."
            paired.isEmpty() -> "No paired devices. Pair the XP-420B in Android Bluetooth settings first (PIN is usually 0000 or 1234)."
            else -> null
        }
    }
    val btPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPrinters() }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 31 && !printer.hasPermission()) btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
        else refreshPrinters()
    }

    var device by remember { mutableStateOf(prefs.deviceCode) }
    val me by Graph.session.user.collectAsStateWithLifecycle()
    val admin = me?.isAdmin == true
    var changingPin by remember { mutableStateOf(false) }
    var lockMinutes by remember { mutableStateOf(prefs.lockMinutes.toString()) }
    var lockOnLeave by remember { mutableStateOf(prefs.lockOnLeave) }
    var locations by remember { mutableStateOf(prefs.locations) }
    var newLocation by remember { mutableStateOf("") }
    var gap by remember { mutableStateOf(prefs.gapMm.toString()) }
    var density by remember { mutableStateOf(prefs.density.toString()) }
    var speed by remember { mutableStateOf(prefs.speed) }
    var url by remember { mutableStateOf(prefs.webAppUrl) }
    var token by remember { mutableStateOf(prefs.token) }
    var sheet by remember { mutableStateOf(prefs.sheetUrl) }
    var hour by remember { mutableStateOf("%02d".format(prefs.reportHour)) }
    var minute by remember { mutableStateOf("%02d".format(prefs.reportMinute)) }
    val selectedAddress = remember(tick) { prefs.printerAddress }
    val syncMessage = remember(tick) { prefs.lastSyncMessage }
    var reportOn by remember { mutableStateOf(prefs.reportEnabled) }
    var reportExcel by remember { mutableStateOf(prefs.reportAsExcel) }
    var invert by remember { mutableStateOf(prefs.invert) }
    var direction by remember { mutableStateOf(prefs.direction) }
    var endCm by remember { mutableStateOf(prefs.cutInCm) }
    var shortEnd by remember { mutableStateOf(Lengths.show(prefs.shortEndMetres.toDouble(), endCm)) }
    LaunchedEffect(tick) { if (sheet.isBlank()) sheet = prefs.sheetUrl }

    ScreenScaffold("Settings", onBack, snackbar) { padding ->
        FormBody(padding) {
            Section("Appearance")
            val currentTheme = remember(tick) { AppTheme.of(prefs.appTheme) }
            AppTheme.entries.forEach { t ->
                ThemeOption(t, selected = t == currentTheme) { prefs.appTheme = t.id }
            }
            Text(
                "Changes only colours and styling on this phone. Stock, users and settings stay the same.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Section("Printer")
            btMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            paired.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().clickable {
                        prefs.printerAddress = p.address
                        prefs.printerName = p.name
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = p.address == selectedAddress, onClick = {
                        prefs.printerAddress = p.address
                        prefs.printerName = p.name
                    })
                    Column {
                        Text(p.name)
                        Text(p.address, style = MonoStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            OutlinedButton(onClick = {
                if (Build.VERSION.SDK_INT >= 31 && !printer.hasPermission()) btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
                else refreshPrinters()
            }) { Text("Refresh paired devices") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    gap, { gap = it; it.toFloatOrNull()?.let { v -> prefs.gapMm = v } },
                    label = { Text("Gap mm") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    density, { density = it; it.toIntOrNull()?.takeIf { v -> v in 1..15 }?.let { v -> prefs.density = v } },
                    label = { Text("Darkness 1–15") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Speed", modifier = Modifier.padding(end = 4.dp))
                (Tspl.MIN_SPEED..Tspl.MAX_SPEED).forEach { v ->
                    FilterChip(selected = speed == v, onClick = { speed = v; prefs.speed = v }, label = { Text("$v") })
                }
            }
            Text(
                "If barcodes print faint or patchy: Darkness 10–12 and Speed 2–3, then Print test label. " +
                    "Clean the print head with alcohol if a white line runs through every label.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            LabelSizeSection()
            SwitchRow("Rotate label 180°", direction == 0) { direction = if (it) 0 else 1; prefs.direction = direction }
            SwitchRow("Invert (if labels print as negatives)", invert) { invert = it; prefs.invert = it }
            var calibrating by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    Graph.printQueue.print(listOf(sampleItem()), "test label")
                }, enabled = selectedAddress != null) { Text("Print test label") }
                OutlinedButton(onClick = {
                    calibrating = true
                    scope.launch {
                        snackbar.showSnackbar(Graph.printQueue.calibrate())
                        calibrating = false
                    }
                }, enabled = selectedAddress != null && !calibrating) { Text(if (calibrating) "Calibrating…" else "Calibrate printer") }
            }
            Text(
                "Blank labels skipped between prints? Set the label size and gap to the real roll (measure with a ruler), " +
                    "then Calibrate printer. Calibrate again after every new roll.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            var autoCut by remember { mutableStateOf(prefs.autoPrintCut) }
            var autoShip by remember { mutableStateOf(prefs.autoPrintShip) }
            SwitchRow("Print the customer label automatically after Cut", autoCut) { autoCut = it; prefs.autoPrintCut = it }
            SwitchRow("Print the customer label automatically after Ship out", autoShip) { autoShip = it; prefs.autoPrintShip = it }
            Text(
                "When a switch is off, a Print customer label button appears after each cut or ship out. " +
                    "Cut and Ship out both need a customer name.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (admin) {
            Section("Locations")
            Text(
                "Places where goods are kept, e.g. Warehouse 1, Warehouse 2 - Floor 1, Showroom. " +
                    "They appear as buttons on Receive, Print by hand and Stock.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            locations.forEach { loc ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(loc, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        locations = locations - loc
                        prefs.locations = locations
                        if (prefs.currentLocation == loc) prefs.currentLocation = ""
                    }) { Text("Remove") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    newLocation, { newLocation = it }, label = { Text("New location") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = {
                    val name = newLocation.trim()
                    if (name.isNotEmpty() && name !in locations) {
                        locations = locations + name
                        prefs.locations = locations
                    }
                    newLocation = ""
                }, enabled = newLocation.isNotBlank()) { Text("Add") }
            }

            Section("Cutting")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    shortEnd,
                    { v ->
                        shortEnd = v
                        val m = if (v.trim() == "0") 0.0 else Lengths.parse(v, endCm)
                        m?.let { prefs.shortEndMetres = it.toFloat() }
                    },
                    label = { Text("Short end below") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                FilterChip(selected = !endCm, onClick = {
                    if (endCm) { endCm = false; shortEnd = Lengths.show(prefs.shortEndMetres.toDouble(), false) }
                }, label = { Text("m") })
                FilterChip(selected = endCm, onClick = {
                    if (!endCm) { endCm = true; shortEnd = Lengths.show(prefs.shortEndMetres.toDouble(), true) }
                }, label = { Text("cm") })
            }
            Text(
                "When a cut would leave less than this on the roll, the app asks: give the whole roll, " +
                    "write the end off as waste, or keep it. Set 0 to never ask.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = onCustomers, modifier = Modifier.fillMaxWidth()) { Text("Customers library") }

            }

            Section("This phone")
            me?.let { u ->
                Text("Signed in as ${u.name} · ${if (u.isAdmin) "Admin" else if (u.canReceive) "User, can receive" else "User"}")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { changingPin = true }) { Text("Change my PIN") }
                    OutlinedButton(onClick = { Graph.session.lock() }) { Text("Lock / switch user") }
                }
                if (Biometric.available(context)) {
                    var bio by remember { mutableStateOf(prefs.biometricUserId == u.id) }
                    SwitchRow("Unlock with fingerprint or face as ${u.name}", bio) { on ->
                        if (on) {
                            Biometric.ask(context, "Use fingerprint or face", "To unlock as ${u.name} on this phone", onOk = {
                                prefs.biometricUserId = u.id
                                bio = true
                            })
                        } else {
                            prefs.biometricUserId = ""
                            bio = false
                        }
                    }
                    Text(
                        "Anyone whose fingerprint or face is saved in this phone can then open the app as ${u.name}. " +
                            "Only one person per phone; others use their PIN.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (changingPin) NewPinDialog(u, "Change my PIN", askCurrent = true, onDone = {
                    changingPin = false
                    scope.launch { snackbar.showSnackbar("PIN changed") }
                }) { changingPin = false }
            }
            if (admin) {
                OutlinedTextField(
                    device, { v -> device = LabelId.cleanDeviceCode(v); prefs.deviceCode = device },
                    label = { Text("Device letter in label IDs (A, B, C… one per phone)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                )

                Section("Users and security")
                OutlinedButton(onClick = onUsers, modifier = Modifier.fillMaxWidth()) { Text("Users") }
                OutlinedButton(onClick = onCatalog, modifier = Modifier.fillMaxWidth()) { Text("Products & groups") }
                SwitchRow("Lock when leaving the app", lockOnLeave) { lockOnLeave = it; prefs.lockOnLeave = it }
                OutlinedTextField(
                    lockMinutes,
                    { v -> lockMinutes = v.filter { it.isDigit() }.take(3); lockMinutes.toIntOrNull()?.let { prefs.lockMinutes = it } },
                    label = { Text("Lock after minutes without use (0 = never)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Text(
                    "For this phone. With both off the app stays open until someone taps the lock on Home.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (admin) {
            Section("Google Sheet")
            OutlinedTextField(url, { url = it; prefs.webAppUrl = it }, label = { Text("Web app URL (…/exec)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(token, { token = it; prefs.token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(sheet, { sheet = it; prefs.sheetUrl = it }, label = { Text("Sheet link (filled in after the first sync)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text(syncMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    scope.launch {
                        val msg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
                        snackbar.showSnackbar(msg)
                    }
                }) { Text("Sync now") }
                OutlinedButton(onClick = { Share.openUrl(context, prefs.sheetUrl) }, enabled = sheet.isNotBlank()) { Text("Open sheet") }
            }

            } else {
                Section("Google Sheet")
                Text(syncMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = {
                    scope.launch {
                        val msg = try { Graph.sync.sync() } catch (e: Exception) { e.message ?: "Sync failed" }
                        snackbar.showSnackbar(msg)
                    }
                }) { Text("Sync now") }
            }

            Section("WhatsApp report")
            SwitchRow("Daily reminder to send the stock list", reportOn) { on ->
                reportOn = on
                prefs.reportEnabled = on
                if (on && Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                ReportWorker.schedule(context)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    hour, { v -> hour = v.filter { it.isDigit() }.take(2) }, label = { Text("Hour") }, singleLine = true,
                    modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(
                    minute, { v -> minute = v.filter { it.isDigit() }.take(2) }, label = { Text("Minute") }, singleLine = true,
                    modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedButton(onClick = {
                    prefs.reportHour = hour.toIntOrNull() ?: 17
                    prefs.reportMinute = minute.toIntOrNull() ?: 0
                    ReportWorker.schedule(context)
                    scope.launch { snackbar.showSnackbar("Reminder set for %02d:%02d".format(prefs.reportHour, prefs.reportMinute)) }
                }) { Text("Save time") }
            }
            SwitchRow("Send the reminder report as an Excel file", reportExcel) { reportExcel = it; prefs.reportAsExcel = it }
            Text(
                "WhatsApp does not allow apps to post to a group by themselves. At this time the phone shows a notification; " +
                    "tap it, pick WhatsApp (or WhatsApp Business) in the share list, then pick the group.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = { scope.launch { Graph.shareStockReport(context) } }) {
                Text(if (reportExcel) "Send stock Excel now" else "Send stock list now")
            }
        }
    }
}

/** One theme choice with three colour dots. */
@Composable
private fun ThemeOption(theme: AppTheme, selected: Boolean, onClick: () -> Unit) {
    val dots = when (theme) {
        AppTheme.TEAL -> listOf(Zinax.Teal, Zinax.Navy, Zinax.Background)
        AppTheme.EMERALD -> listOf(Emerald.Primary, Emerald.Heading, Emerald.Background)
    }
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = scheme.surface,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = onClick)
            Text(theme.title, modifier = Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                dots.forEach { c ->
                    Surface(color = c, shape = RoundedCornerShape(4.dp), border = BorderStroke(1.dp, scheme.outline), modifier = Modifier.size(16.dp)) {}
                }
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
}

@Composable
private fun SwitchRow(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
