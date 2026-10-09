package com.zinax.stock.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
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

/** What the move dialog is moving: one package, or every package in a code group on screen. */
private data class MoveTarget(val title: String, val ids: List<String>, val current: String)

@Composable
fun StockScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val items by Graph.db.dao().inStock().collectAsStateWithLifecycle(emptyList())
    var query by remember { mutableStateOf("") }
    var place by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<MoveTarget?>(null) }

    val places = remember(items) {
        val used = items.map { it.location.ifBlank { NO_LOCATION } }.distinct()
        (Graph.prefs.locations.filter { it in used } + used.filter { it !in Graph.prefs.locations }.sortedBy { it == NO_LOCATION })
    }
    val shown = remember(items, query, place) {
        items.filter { query.isBlank() || it.code.contains(query.trim(), true) || it.id.contains(query.trim(), true) }
            .filter { place == null || it.location.ifBlank { NO_LOCATION } == place }
    }
    val groups = remember(shown) {
        shown.groupBy { "${it.category}|${it.code}|${it.size}|${it.unit}" }
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
            if (places.size > 1 || place != null) item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { FilterChip(selected = place == null, onClick = { place = null }, label = { Text("All places") }) }
                    items(places) { p ->
                        FilterChip(selected = place == p, onClick = { place = if (place == p) null else p }, label = { Text(p) })
                    }
                }
            }
            item {
                Text(
                    "${shown.size} packages · ${shown.map { it.code }.distinct().size} codes" + (place?.let { " in $it" } ?: " in stock"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(groups, key = { it.key }) { (key, list) ->
                val first = list.first()
                val total = list.sumOf { it.remaining }
                val byPlace = list.groupBy { it.location.ifBlank { NO_LOCATION } }
                    .entries.sortedByDescending { it.value.size }
                    .map { (p, l) -> p to l.size }
                Panel {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = first.code,
                            title = "${list.size} ${Report.plural(first.categoryEnum.pack, list.size)} · ${Format.qtyUnit(total, first.unit)}",
                            subtitle = listOf(first.categoryEnum.label, Format.size(first.size)).filter { it.isNotBlank() }.joinToString(" · "),
                        )
                        Spacer(Modifier.height(6.dp))
                        LocationBadges(byPlace)
                    }
                    if (open == key) {
                        TextButton(onClick = {
                            moving = MoveTarget("Move all ${list.size} of ${first.code}", list.map { it.id }, place.takeIf { it != NO_LOCATION }.orEmpty())
                        }) { Text("Move all ${list.size} to another place") }
                        list.sortedBy { it.receivedAt }.forEach { item ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(item.id, style = MonoStyle, fontWeight = FontWeight.Medium)
                                    LocationBadge(item.location)
                                    Text(
                                        listOfNotNull(
                                            Format.qtyUnit(item.remaining, item.unit) + if (item.remaining < item.qty) " of ${Format.qty(item.qty)}" else "",
                                            item.pallet?.let { "Pallet $it" },
                                            Format.date(item.receivedAt),
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                TextButton(onClick = { moving = MoveTarget("Move ${item.id}", listOf(item.id), item.location) }) { Text("Move") }
                                TextButton(onClick = { Graph.printQueue.print(listOf(item), item.id) }) { Text("Reprint") }
                            }
                        }
                    }
                }
            }
        }
    }

    moving?.let { target ->
        MoveDialog(
            title = target.title,
            initial = target.current,
            onSave = { loc ->
                moving = null
                scope.launch { Graph.repo.setLocations(target.ids, loc) }
            },
            onDismiss = { moving = null },
        )
    }
}
