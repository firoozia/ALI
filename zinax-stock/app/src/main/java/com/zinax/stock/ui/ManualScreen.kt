package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.zinax.stock.Graph
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import kotlinx.coroutines.launch

/** Print labels without a packing list, or for a package that was not on it. */
@Composable
fun ManualScreen(shipmentId: String?, pallet: String?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var category by remember { mutableStateOf(Category.PVC) }
    var code by remember { mutableStateOf("") }
    var size by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf(Category.PVC.unit) }
    var count by remember { mutableStateOf("1") }
    var palletText by remember { mutableStateOf(pallet.orEmpty()) }
    var putAway by remember { mutableStateOf(Graph.prefs.currentLocation) }

    val qtyValue = Format.number(qty)
    val countValue = count.toIntOrNull() ?: 0
    val valid = code.isNotBlank() && qtyValue != null && qtyValue > 0 && countValue in 1..500 && unit.isNotBlank()

    ScreenScaffold(if (shipmentId != null) "Add item to shipment" else "Print by hand", onBack) { padding ->
        FormBody(padding) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(Category.entries) { c ->
                    FilterChip(selected = c == category, onClick = { category = c; unit = c.unit }, label = { Text(c.label) })
                }
            }
            OutlinedTextField(
                code, { code = it }, label = { Text("Item code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            )
            OutlinedTextField(size, { size = it }, label = { Text("Size or model (optional), e.g. 0.30*1400") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    qty, { qty = it }, label = { Text("Qty per ${category.pack}") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(unit, { unit = it }, label = { Text("Unit") }, singleLine = true, modifier = Modifier.weight(0.6f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    count, { v -> count = v.filter { it.isDigit() }.take(3) }, label = { Text("Labels (${category.pack}s)") },
                    singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(palletText, { palletText = it }, label = { Text("Pallet (optional)") }, singleLine = true, modifier = Modifier.weight(1f))
            }
            LocationPicker(putAway, { putAway = it; Graph.prefs.currentLocation = it })
            if (valid) {
                Text(
                    "Prints $countValue ${Report.plural(category.pack, countValue)} of ${code.trim()}, ${Format.qtyUnit(qtyValue!!, unit.trim())} each.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = {
                    scope.launch {
                        val items = Graph.repo.createManual(
                            category, code, size, qtyValue!!, unit, countValue, shipmentId, palletText.trim().ifEmpty { null },
                            putAway,
                        )
                        Graph.printQueue.print(items, code.trim())
                        count = "1"
                    }
                },
                enabled = valid,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Print $countValue label" + if (countValue == 1) "" else "s") }
        }
    }
}
