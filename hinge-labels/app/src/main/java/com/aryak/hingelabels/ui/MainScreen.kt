package com.aryak.hingelabels.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aryak.hingelabels.Graph
import com.aryak.hingelabels.R
import com.aryak.hingelabels.data.Lists
import com.aryak.hingelabels.data.Prefs
import com.aryak.hingelabels.label.HingeLabel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MainScreen(onSettings: () -> Unit) {
    val prefs = Graph.prefs
    val tick by prefs.changes.collectAsStateWithLifecycle()

    val btPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 31 && !Graph.printer.hasPermission()) btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
    }

    // Start from the last label; a product, type or model since removed in Settings falls back to the first one.
    var label by remember {
        mutableStateOf(
            prefs.last.let { l ->
                l.copy(
                    product = l.product.takeIf { it in prefs.products } ?: prefs.products.first(),
                    type = l.type.takeIf { it in prefs.types } ?: prefs.types.first(),
                    model = l.model.takeIf { it in prefs.models } ?: prefs.models.first(),
                )
            },
        )
    }
    var qtyText by remember { mutableStateOf(label.qty.toString()) }
    var copiesText by remember { mutableStateOf(prefs.copies.toString()) }
    fun update(l: HingeLabel) {
        label = l
        prefs.last = l
    }

    // Lists edited in Settings; read again whenever prefs change.
    val brands = remember(tick) { prefs.brands }
    val products = remember(tick) { prefs.products }
    val types = remember(tick) { prefs.types }
    val models = remember(tick) { prefs.models }
    val printerName = remember(tick) { prefs.printerName }
    val setup = remember(tick) { prefs.tspl }

    val copies = copiesText.toIntOrNull()?.coerceIn(1, Prefs.MAX_COPIES) ?: 1
    val qtyValid = (qtyText.toIntOrNull() ?: 0) > 0
    val canPrint = qtyValid && label.model.isNotBlank()

    fun print(n: Int) {
        val l = label.copy(brand = Lists.clean(label.brand))
        update(l)
        prefs.brands = Lists.add(prefs.brands, l.brand)
        Graph.printQueue.print(l, n)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Hinge Labels", fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                actions = {
                    AssistChip(
                        onClick = onSettings,
                        label = {
                            Text(
                                printerName ?: "No printer", maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 120.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        },
                        leadingIcon = {
                            Icon(
                                painterResource(R.drawable.lucide_printer), contentDescription = null,
                                modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onPrimary,
                            )
                        },
                    )
                    IconButton(onClick = onSettings) {
                        Icon(painterResource(R.drawable.lucide_settings), contentDescription = "Settings", modifier = Modifier.size(22.dp))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Preview · ${setup.widthMm} × ${setup.heightMm} mm",
                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            LabelPreview(label, setup)

            BrandField(label.brand, brands) { update(label.copy(brand = it.uppercase())) }

            Choice("Product", label.product, products) { update(label.copy(product = it)) }

            Text("Type", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                types.forEach { t ->
                    FilterChip(selected = label.type == t, onClick = { update(label.copy(type = t)) }, label = { Text(t) })
                }
            }

            Choice("Model", label.model, models) { update(label.copy(model = it)) }

            Text("Material", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !label.ss, onClick = { update(label.copy(ss = false)) }, label = { Text("Normal") })
                FilterChip(selected = label.ss, onClick = { update(label.copy(ss = true)) }, label = { Text("SS") })
            }

            Text("Quantity in box", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = qtyText,
                    onValueChange = { v ->
                        qtyText = v.filter { it.isDigit() }.take(6)
                        qtyText.toIntOrNull()?.takeIf { it > 0 }?.let { update(label.copy(qty = it)) }
                    },
                    singleLine = true, isError = !qtyValid, modifier = Modifier.width(120.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                HingeLabel.UNITS.forEach { u ->
                    FilterChip(selected = label.unit == u, onClick = { update(label.copy(unit = u)) }, label = { Text(u) })
                }
            }

            Text("Copies", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedIconButton(onClick = {
                    val n = (copies - 1).coerceAtLeast(1)
                    copiesText = n.toString(); prefs.copies = n
                }) { Text("−", style = MaterialTheme.typography.titleLarge) }
                OutlinedTextField(
                    value = copiesText,
                    onValueChange = { v ->
                        copiesText = v.filter { it.isDigit() }.take(3)
                        copiesText.toIntOrNull()?.takeIf { it >= 1 }?.let { prefs.copies = it }
                    },
                    singleLine = true, modifier = Modifier.width(88.dp),
                    textStyle = MaterialTheme.typography.titleMedium.copy(textAlign = TextAlign.Center),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedIconButton(onClick = {
                    val n = (copies + 1).coerceAtMost(Prefs.MAX_COPIES)
                    copiesText = n.toString(); prefs.copies = n
                }) { Icon(Icons.Filled.Add, contentDescription = "More copies") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledTonalButton(onClick = { print(1) }, enabled = canPrint, modifier = Modifier.weight(1f).height(52.dp)) {
                    Text("Print 1")
                }
                Button(onClick = { print(copies) }, enabled = canPrint, modifier = Modifier.weight(1f).height(52.dp)) {
                    Text("Print $copies")
                }
            }
            if (printerName == null) {
                Text(
                    "No printer selected yet. Open Settings and pick the XP-420B.",
                    style = MaterialTheme.typography.bodySmall, color = HingeColors.Warn,
                )
            }
        }
    }
}


/** Brand text field that suggests brands used before. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandField(value: String, brands: List<String>, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val suggestions = brands.filter { it != value.trim() && it.contains(value.trim(), ignoreCase = true) }
    ExposedDropdownMenuBox(expanded = expanded && suggestions.isNotEmpty(), onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it.replace("\n", "")); expanded = true },
            label = { Text("Brand") },
            singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded && suggestions.isNotEmpty()) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        ExposedDropdownMenu(expanded = expanded && suggestions.isNotEmpty(), onDismissRequest = { expanded = false }) {
            suggestions.forEach { b ->
                DropdownMenuItem(text = { Text(b) }, onClick = { onChange(b); expanded = false })
            }
        }
    }
}

/** A read-only dropdown of [options]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Choice(title: String, value: String, options: List<String>, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(title) },
            singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { o ->
                DropdownMenuItem(text = { Text(o) }, onClick = { onChange(o); expanded = false })
            }
        }
    }
}
