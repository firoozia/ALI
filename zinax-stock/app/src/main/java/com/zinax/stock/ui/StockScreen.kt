package com.zinax.stock.ui

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import com.zinax.stock.data.Item
import kotlinx.coroutines.launch

@Composable
fun StockScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val items by Graph.db.dao().inStock().collectAsStateWithLifecycle(emptyList())
    var query by remember { mutableStateOf("") }
    var open by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<Item?>(null) }

    val groups = remember(items, query) {
        items.filter { query.isBlank() || it.code.contains(query.trim(), true) || it.id.contains(query.trim(), true) }
            .groupBy { "${it.category}|${it.code}|${it.size}|${it.unit}" }
            .entries
            .sortedWith(compareBy<Map.Entry<String, List<Item>>>({ it.value.first().categoryEnum.ordinal }, { Report.codeSortKey(it.value.first().code) }, { it.value.first().code }))
    }

    ScreenScaffold("Stock", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                OutlinedTextField(query, { query = it }, label = { Text("Search code or label ID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            item {
                Text(
                    "${items.size} packages in stock · ${items.map { it.code }.distinct().size} codes",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(groups, key = { it.key }) { (key, list) ->
                val first = list.first()
                val total = list.sumOf { it.remaining }
                Panel {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = first.code,
                            title = "${list.size} ${Report.plural(first.categoryEnum.pack, list.size)} · ${Format.qtyUnit(total, first.unit)}",
                            subtitle = listOf(first.categoryEnum.label, Format.size(first.size)).filter { it.isNotBlank() }.joinToString(" · "),
                        )
                    }
                    if (open == key) {
                        list.sortedBy { it.receivedAt }.forEach { item ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.id, style = MonoStyle, fontWeight = FontWeight.Medium)
                                    Text(
                                        listOfNotNull(
                                            Format.qtyUnit(item.remaining, item.unit) + if (item.remaining < item.qty) " of ${Format.qty(item.qty)}" else "",
                                            item.pallet?.let { "Pallet $it" },
                                            item.location.takeIf { it.isNotBlank() },
                                            Format.date(item.receivedAt),
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                TextButton(onClick = { editing = item }) { Text("Place") }
                                TextButton(onClick = { Graph.printQueue.print(listOf(item), item.id) }) { Text("Reprint") }
                            }
                        }
                    }
                }
            }
        }
    }

    editing?.let { item ->
        var location by remember(item.id) { mutableStateOf(item.location) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Where is ${item.id}?") },
            text = { OutlinedTextField(location, { location = it }, label = { Text("Shelf or row, e.g. A-04") }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    editing = null
                    scope.launch { Graph.repo.setLocation(item.id, location) }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
        )
    }
}
