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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import com.zinax.stock.Graph
import com.zinax.stock.Share
import com.zinax.stock.core.Category
import com.zinax.stock.core.LabelId
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.printer.PairedPrinter
import com.zinax.stock.sync.ReportWorker
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onBack: () -> Unit) {
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
    var gap by remember { mutableStateOf(prefs.gapMm.toString()) }
    var density by remember { mutableStateOf(prefs.density.toString()) }
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
    LaunchedEffect(tick) { if (sheet.isBlank()) sheet = prefs.sheetUrl }

    ScreenScaffold("Settings", onBack, snackbar) { padding ->
        FormBody(padding) {
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
            SwitchRow("Rotate label 180°", direction == 0) { direction = if (it) 0 else 1; prefs.direction = direction }
            SwitchRow("Invert (if labels print as negatives)", invert) { invert = it; prefs.invert = it }
            Button(onClick = {
                val t = System.currentTimeMillis()
                val sample = Item(
                    id = LabelId.make(LabelId.datePart(t), prefs.deviceCode, 0), category = Category.PVC.name, code = "101",
                    size = "0.30*1400", unit = "m", qty = 120.0, remaining = 120.0, status = ItemStatus.IN_STOCK, shipmentId = null,
                    pallet = null, netKg = null, grossKg = null, receivedAt = t, location = "", device = prefs.deviceCode, updatedAt = t,
                )
                Graph.printQueue.print(listOf(sample), "test label")
            }, enabled = selectedAddress != null) { Text("Print test label") }

            Section("This phone")
            OutlinedTextField(
                device, { v -> device = LabelId.cleanDeviceCode(v); prefs.deviceCode = device },
                label = { Text("Device letter in label IDs (A, B, C… one per phone)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            )

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
