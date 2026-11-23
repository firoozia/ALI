package com.aryak.hingelabels.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aryak.hingelabels.Graph
import com.aryak.hingelabels.label.Tspl
import com.aryak.hingelabels.printer.PairedPrinter
import kotlinx.coroutines.launch

@Suppress("DEPRECATION")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
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
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 31 && !printer.hasPermission()) btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
        else refreshPrinters()
    }

    val selectedAddress = remember(tick) { prefs.printerAddress }
    var gap by remember { mutableStateOf(prefs.gapMm.toString()) }
    var density by remember { mutableStateOf(prefs.density.toString()) }
    var speed by remember { mutableStateOf(prefs.speed) }
    var direction by remember { mutableStateOf(prefs.direction) }
    var invert by remember { mutableStateOf(prefs.invert) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.SemiBold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Section("Printer")
            btMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            paired.forEach { p ->
                fun pick() {
                    prefs.printerAddress = p.address
                    prefs.printerName = p.name
                }
                Row(Modifier.fillMaxWidth().clickable { pick() }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = p.address == selectedAddress, onClick = { pick() })
                    Column {
                        Text(p.name)
                        Text(p.address, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            OutlinedButton(onClick = {
                if (Build.VERSION.SDK_INT >= 31 && !printer.hasPermission()) btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
                else refreshPrinters()
            }) { Text("Refresh paired devices") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    gap, { gap = it; it.toFloatOrNull()?.takeIf { v -> v in 0f..20f }?.let { v -> prefs.gapMm = v } },
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

            Section("Label")
            LabelSizeSection()
            SwitchRow("Rotate label 180°", direction == 0) { direction = if (it) 0 else 1; prefs.direction = direction }
            SwitchRow("Invert (if labels print as negatives)", invert) { invert = it; prefs.invert = it }
            var calibrating by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { Graph.printQueue.print(prefs.last, 1) }, enabled = selectedAddress != null) { Text("Print test label") }
                OutlinedButton(onClick = {
                    calibrating = true
                    scope.launch {
                        snackbar.showSnackbar(Graph.printQueue.calibrate())
                        calibrating = false
                    }
                }, enabled = selectedAddress != null && !calibrating) { Text(if (calibrating) "Calibrating…" else "Calibrate printer") }
            }
            Text(
                "Calibrate after a new roll or a new label size: the printer feeds a few labels and learns where each one starts.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Section("Lists")
            Text(
                "These are the choices on the main screen. New brands are added here when you print with them.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ListEditor("Brands", remember(tick) { prefs.brands }) { prefs.brands = it }
            ListEditor("Products", remember(tick) { prefs.products }) { prefs.products = it }
            ListEditor("Types", remember(tick) { prefs.types }) { prefs.types = it }
            ListEditor("Models", remember(tick) { prefs.models }) { prefs.models = it }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
}

@Composable
private fun SwitchRow(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Text(text, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
