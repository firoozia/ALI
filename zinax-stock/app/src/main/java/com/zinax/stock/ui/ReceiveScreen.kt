package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.zinax.stock.Graph
import com.zinax.stock.Routes
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.data.ExpectedUnit
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** Packages of one code and size on one pallet. */
private data class Group(val pallet: String, val code: String, val size: String, val category: Category, val unit: String, val units: List<ExpectedUnit>) {
    val remaining get() = units.filter { it.itemId == null }
    val done get() = remaining.isEmpty()
    val qtySummary: String
        get() = units.groupingBy { it.qty }.eachCount().entries.sortedByDescending { it.value }
            .joinToString(", ") { (q, n) -> if (n == 1) Format.qtyUnit(q, unit) else "${Format.qtyUnit(q, unit)} ×$n" }
}

private fun groups(units: List<ExpectedUnit>): List<Group> =
    units.groupBy { listOf(it.pallet, it.code, it.size, it.category, it.unit) }
        .map { (k, list) -> Group(k[0], k[1], k[2], Category.fromName(k[3]), k[4], list.sortedBy { it.lineNo }) }

fun palletOrder(pallets: Collection<String>): List<String> =
    pallets.distinct().sortedWith(compareBy<String>({ it.toIntOrNull() ?: Int.MAX_VALUE }, { it }))

@Composable
fun ReceiveScreen(shipmentId: String, nav: NavController, onBack: () -> Unit) {
    val dao = Graph.db.dao()
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    val units by dao.expected(shipmentId).collectAsStateWithLifecycle(emptyList())
    var shipmentName by remember { mutableStateOf("") }
    LaunchedEffect(shipmentId) { shipmentName = dao.shipment(shipmentId)?.name.orEmpty() }

    val all = remember(units) { groups(units) }
    val pallets = remember(units) { palletOrder(units.map { it.pallet }) }
    var selected by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var countFor by remember { mutableStateOf<Group?>(null) }

    LaunchedEffect(pallets) {
        if (selected == null || selected !in pallets) {
            selected = pallets.firstOrNull { p -> all.any { it.pallet == p && !it.done } } ?: pallets.firstOrNull()
        }
    }

    fun print(group: Group, count: Int) {
        scope.launch {
            val ids = group.remaining.take(count).map { it.id }
            val items = Graph.repo.labelExpected(ids)
            Graph.printQueue.print(items, "pallet ${group.pallet} · ${group.code}")
        }
    }

    fun reprint(group: Group) {
        scope.launch {
            val ids = group.units.mapNotNull { it.itemId }
            val items = dao.itemsByIds(ids).sortedBy { it.id }
            Graph.printQueue.print(items, "pallet ${group.pallet} · ${group.code} (reprint)")
        }
    }

    val labelled = units.count { it.itemId != null }
    ScreenScaffold(
        title = "Receive · $shipmentName",
        onBack = onBack,
        actions = { TextButton(onClick = { nav.navigate(Routes.check(shipmentId)) }) { Text("Check") } },
    ) { padding ->
        val visible = if (query.isBlank()) all.filter { it.pallet == selected }
        else all.filter { it.code.contains(query.trim(), ignoreCase = true) }.sortedWith(compareBy<Group>({ it.pallet.toIntOrNull() ?: Int.MAX_VALUE }, { it.pallet }))

        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("$labelled of ${units.size} labelled", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        if (units.isNotEmpty() && labelled == units.size) Pill("Complete", status.ok, status.okSoft)
                    }
                    LinearProgressIndicator(
                        progress = { if (units.isEmpty()) 0f else labelled / units.size.toFloat() },
                        modifier = Modifier.fillMaxWidth(),
                        color = status.ok,
                    )
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(pallets) { p ->
                            val done = all.filter { it.pallet == p }.all { it.done }
                            FilterChip(
                                selected = p == selected && query.isBlank(),
                                onClick = { selected = p; query = "" },
                                label = { Text(if (done) "Pallet $p ✓" else "Pallet $p") },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        label = { Text("Find a code on any pallet") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            items(visible, key = { "${it.pallet}|${it.code}|${it.size}|${it.unit}" }) { g ->
                Panel {
                    CodeRow(
                        code = g.code,
                        title = buildString {
                            append("${g.units.size} ${com.zinax.stock.core.Report.plural(g.category.pack, g.units.size)}")
                            if (g.size.isNotBlank()) append(" · ${Format.size(g.size)}")
                        },
                        subtitle = (if (query.isBlank()) "" else "Pallet ${g.pallet} · ") + g.qtySummary,
                        trailing = {
                            if (g.done) OutlinedButton(onClick = { reprint(g) }) { Text("Reprint") }
                            else Button(onClick = { print(g, g.remaining.size) }) { Text("Print ${g.remaining.size}") }
                        },
                    )
                    if (!g.done && g.remaining.size > 1) {
                        TextButton(onClick = { countFor = g }) { Text("This pallet has fewer? Print a smaller number") }
                    }
                    if (!g.done && g.remaining.size < g.units.size) {
                        Text("${g.units.size - g.remaining.size} already printed", style = MaterialTheme.typography.bodySmall, color = status.warn)
                    }
                }
            }

            item {
                val palletGroups = all.filter { it.pallet == selected }
                if (query.isBlank() && palletGroups.isNotEmpty()) {
                    val open = palletGroups.filter { !it.done }
                    if (open.isEmpty()) Notice("All labels for pallet $selected are printed.", status.ok, status.okSoft, "Pallet $selected complete")
                    else Notice(
                        open.joinToString(", ") { "${it.code} (${it.remaining.size})" } + " still to print.",
                        status.warn, status.warnSoft, "Pallet $selected not finished",
                    )
                }
            }
            item {
                OutlinedButton(
                    onClick = { nav.navigate(Routes.manual(shipmentId, selected)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("+ Add an item that is not on the list") }
            }
            item {
                Button(onClick = { nav.navigate(Routes.check(shipmentId)) }, modifier = Modifier.fillMaxWidth()) { Text("Check shipment") }
            }
        }
    }

    countFor?.let { g ->
        var text by remember(g) { mutableStateOf(g.remaining.size.toString()) }
        AlertDialog(
            onDismissRequest = { countFor = null },
            title = { Text("How many ${g.code} on pallet ${g.pallet}?") },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { v -> text = v.filter { it.isDigit() }.take(4) },
                    label = { Text("Labels to print (max ${g.remaining.size})") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val n = (text.toIntOrNull() ?: 0).coerceIn(0, g.remaining.size)
                    countFor = null
                    if (n > 0) print(g, n)
                }) { Text("Print") }
            },
            dismissButton = { TextButton(onClick = { countFor = null }) { Text("Cancel") } },
        )
    }
}
