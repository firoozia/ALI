package com.zinax.stock.ui

import com.zinax.stock.core.CodeSuggest
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import com.zinax.stock.printer.LabelSpec
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
    var picked by remember { mutableStateOf(false) }
    var alreadyCut by remember { mutableStateOf(false) }
    var original by remember { mutableStateOf("") }
    val hints by Graph.db.dao().productHints().collectAsStateWithLifecycle(emptyList())
    // One suggestion per product, the most recent use first among equal codes.
    val products = remember(hints) {
        hints.groupBy { listOf(it.category, it.code, it.size, it.unit) }.map { (_, l) -> l.maxBy { it.lastUsed } }
    }
    val suggestions = remember(products, code, picked) { if (picked) emptyList() else CodeSuggest.filter(products, code, { it.code }) }

    val qtyValue = Format.number(qty)
    val countValue = count.toIntOrNull() ?: 0
    val originalValue = Format.number(original)
    // An open roll must have had more on it than is left now.
    val openOk = !alreadyCut || (originalValue != null && qtyValue != null && originalValue > qtyValue + 1e-6)
    val valid = code.isNotBlank() && qtyValue != null && qtyValue > 0 && countValue in 1..500 && unit.isNotBlank() && openOk

    ScreenScaffold(if (shipmentId != null) "Add item to shipment" else "Print by hand", onBack) { padding ->
        FormBody(padding) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(Category.entries) { c ->
                    FilterChip(selected = c == category, onClick = { category = c; unit = c.unit }, label = { Text(c.label) })
                }
            }
            OutlinedTextField(
                code, { code = it; picked = false }, label = { Text("Item code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            )
            if (suggestions.isNotEmpty()) {
                Panel {
                    Text("Known codes — tap to fill in", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    suggestions.forEach { p ->
                        val cat = Category.fromName(p.category)
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                category = cat
                                code = p.code
                                size = p.size
                                qty = Format.qty(p.qty)
                                original = Format.qty(p.qty)
                                unit = p.unit
                                picked = true
                            }.padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(p.code, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            Text(
                                listOf(cat.label, Format.size(p.size), Format.qtyUnit(p.qty, p.unit)).filter { it.isNotBlank() }.joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            OutlinedTextField(size, { size = it }, label = { Text("Size or model (optional), e.g. 0.30*1400") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    qty, { qty = it }, label = { Text(if (alreadyCut) "Left now" else "Qty per ${category.pack}") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(unit, { unit = it }, label = { Text("Unit") }, singleLine = true, modifier = Modifier.weight(0.6f))
            }
            Row(
                Modifier.fillMaxWidth().clickable { alreadyCut = !alreadyCut },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = alreadyCut, onCheckedChange = { alreadyCut = it })
                Column {
                    Text("Already cut (open roll)")
                    Text(
                        "For a roll that was cut before it got a label. It shows as OPEN and is offered first in Cut.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (alreadyCut) {
                OutlinedTextField(
                    original, { original = it }, label = { Text("Original length of the full ${category.pack} (${unit.trim()})") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    isError = original.isNotBlank() && !openOk,
                    supportingText = {
                        Text(
                            when {
                                original.isBlank() -> "Needed so the label can say how much is left of how much, e.g. 120"
                                !openOk -> "Must be more than what is left now"
                                else -> ""
                            }
                        )
                    },
                )
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
                    "Prints $countValue ${Report.plural(category.pack, countValue)} of ${code.trim()}, ${Format.qtyUnit(qtyValue!!, unit.trim())} each" +
                        if (alreadyCut) ", as OPEN rolls (left of ${Format.qtyUnit(originalValue!!, unit.trim())})." else ".",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = {
                    scope.launch {
                        val items = if (alreadyCut) {
                            Graph.repo.createManual(
                                category, code, size, originalValue!!, unit, countValue, shipmentId, palletText.trim().ifEmpty { null },
                                putAway, remaining = qtyValue!!,
                            )
                        } else {
                            Graph.repo.createManual(
                                category, code, size, qtyValue!!, unit, countValue, shipmentId, palletText.trim().ifEmpty { null },
                                putAway,
                            )
                        }
                        if (alreadyCut) Graph.printQueue.printLabels(items.map { LabelSpec.Remainder(it) }, "${code.trim()} open")
                        else Graph.printQueue.print(items, code.trim())
                        count = "1"
                    }
                },
                enabled = valid,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Print $countValue label" + if (countValue == 1) "" else "s") }
        }
    }
}
