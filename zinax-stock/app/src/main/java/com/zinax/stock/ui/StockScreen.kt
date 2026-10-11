package com.zinax.stock.ui

import com.zinax.stock.ui.theme.LocalStatus
import androidx.compose.material3.AlertDialog
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
import com.zinax.stock.data.ItemEdit
import com.zinax.stock.printer.LabelSpec
import kotlinx.coroutines.launch

/** What the move dialog is moving: one package, or every package in a code group on screen. */
private data class MoveTarget(val title: String, val ids: List<String>, val current: String)

@Composable
fun StockScreen(onBack: () -> Unit, onCut: (String) -> Unit, onMoveScan: () -> Unit) {
    val scope = rememberCoroutineScope()
    val items by Graph.db.dao().inStock().collectAsStateWithLifecycle(emptyList())
    var query by remember { mutableStateOf("") }
    var place by remember { mutableStateOf<String?>(null) }
    var openOnly by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<MoveTarget?>(null) }
    var deleting by remember { mutableStateOf<MoveTarget?>(null) }
    var editing by remember { mutableStateOf<List<Item>?>(null) }
    var editPlan by remember { mutableStateOf<Pair<List<Item>, ItemEdit>?>(null) }
    var reprint by remember { mutableStateOf<List<Item>?>(null) }
    val waiting = rememberWaiting()
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }

    val places = remember(items) {
        val used = items.map { it.location.ifBlank { NO_LOCATION } }.distinct()
        (Graph.prefs.locations.filter { it in used } + used.filter { it !in Graph.prefs.locations }.sortedBy { it == NO_LOCATION })
    }
    val catalog by Graph.db.dao().products().collectAsStateWithLifecycle(emptyList())
    // Colour or description from the catalog, shown under the code and searchable.
    val notes = remember(catalog) {
        catalog.filter { !it.hidden && it.note.isNotBlank() }.associate { "${it.groupId}|${it.code}|${it.size}|${it.unit}" to it.note }
    }
    val openCount = remember(items) { items.count { it.isOpen } }
    val shown = remember(items, query, place, openOnly, notes) {
        items.filter { !openOnly || it.isOpen }
            .filter {
                query.isBlank() || it.code.contains(query.trim(), true) || it.id.contains(query.trim(), true) ||
                    notes["${it.category}|${it.code}|${it.size}|${it.unit}"]?.contains(query.trim(), true) == true
            }
            .filter { place == null || it.location.ifBlank { NO_LOCATION } == place }
    }
    val groups = remember(shown) {
        shown.groupBy { "${it.category}|${it.code}|${it.size}|${it.unit}" }
            .entries
            .sortedWith(compareBy<Map.Entry<String, List<Item>>>({ it.value.first().categoryEnum.ordinal }, { Report.codeSortKey(it.value.first().code) }, { it.value.first().code }))
    }

    ScreenScaffold("Stock", onBack, snackbar, actions = { TextButton(onClick = onMoveScan) { Text("Move by scan") } }) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                OutlinedTextField(query, { query = it }, label = { Text("Search code, label ID or colour") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            if (places.size > 1 || place != null || openCount > 0) item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (openCount > 0 || openOnly) item {
                        FilterChip(selected = openOnly, onClick = { openOnly = !openOnly }, label = { Text("Open rolls ($openCount)") })
                    }
                    item { FilterChip(selected = place == null, onClick = { place = null }, label = { Text("All places") }) }
                    items(places) { p ->
                        FilterChip(selected = place == p, onClick = { place = if (place == p) null else p }, label = { Text(p) })
                    }
                }
            }
            item {
                Text(
                    "${shown.size} packages · ${shown.map { it.code }.distinct().size} codes" + (place?.let { " in $it" } ?: " in stock") +
                        if (openOnly) " · open rolls only" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(groups, key = { it.key }) { (key, list) ->
                val first = list.first()
                val total = list.sumOf { it.remaining }
                val opened = list.count { it.isOpen }
                val pack = Report.plural(first.categoryEnum.pack, list.size)
                val byPlace = list.groupBy { it.location.ifBlank { NO_LOCATION } }
                    .entries.sortedByDescending { it.value.size }
                    .map { (p, l) -> p to l.size }
                Panel {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = first.code,
                            title = (if (opened > 0) "${list.size - opened} full · $opened open" else "${list.size} $pack") +
                                " · ${Format.qtyUnit(total, first.unit)}",
                            subtitle = listOf(first.categoryEnum.label, Format.size(first.size), notes[key].orEmpty())
                                .filter { it.isNotBlank() }.joinToString(" · "),
                        )
                        Spacer(Modifier.height(6.dp))
                        LocationBadges(byPlace)
                    }
                    if (open == key) {
                        Row {
                            TextButton(onClick = {
                                moving = MoveTarget("Move all ${list.size} of ${first.code}", list.map { it.id }, place.takeIf { it != NO_LOCATION }.orEmpty())
                            }) { Text("Move all ${list.size}") }
                            TextButton(onClick = { editing = list }) { Text("Edit") }
                            TextButton(onClick = {
                                deleting = MoveTarget("Delete all ${list.size} of ${first.code}?", list.map { it.id }, "")
                            }) { Text("Delete all ${list.size}", color = LocalStatus.current.bad) }
                        }
                        list.sortedBy { it.receivedAt }.forEach { item ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(item.id, style = MonoStyle, fontWeight = FontWeight.Medium)
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        if (item.isOpen) OpenBadge(true)
                                        LocationBadge(item.location)
                                    }
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
                                Column {
                                    Row {
                                        TextButton(onClick = { moving = MoveTarget("Move ${item.id}", listOf(item.id), item.location) }) { Text("Move") }
                                        TextButton(onClick = { Graph.printQueue.print(listOf(item), item.id) }) { Text("Reprint") }
                                    }
                                    Row {
                                        TextButton(onClick = { onCut(item.id) }) { Text("✂ Cut") }
                                        if (item.id in waiting) {
                                            Text("Waiting for admin", style = MaterialTheme.typography.labelMedium, color = LocalStatus.current.warn)
                                        } else {
                                            TextButton(onClick = { deleting = MoveTarget("Delete ${item.id}?", listOf(item.id), "") }) {
                                                Text("Delete", color = LocalStatus.current.bad)
                                            }
                                        }
                                    }
                                    Row {
                                        TextButton(onClick = { editing = listOf(item) }, enabled = item.id !in waiting) { Text("Edit") }
                                        if (item.isOpen) {
                                            TextButton(onClick = { Graph.printQueue.printLabels(listOf(LabelSpec.Remainder(item)), "remainder ${item.id}") }) {
                                                Text("Remainder")
                                            }
                                        }
                                    }
                                }
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

    editing?.let { list ->
        EditItemsDialog(list, onSave = { e -> editing = null; editPlan = list to e }, onDismiss = { editing = null })
    }

    editPlan?.let { (list, e) ->
        val first = list.first()
        ApprovalDialog(
            title = if (list.size == 1) "Save changes to ${first.id}?" else "Save changes to ${list.size} labels?",
            body = (e.against(first)?.describe(first) ?: "") + ".",
            confirmLabel = "Save",
            onConfirm = {
                editPlan = null
                scope.launch {
                    try {
                        val updated = Graph.repo.editItems(list.map { it.id }, e)
                        snackbar.showSnackbar("Saved ${updated.size} label(s)")
                        if (e.changesLabel && updated.isNotEmpty()) reprint = updated
                    } catch (ex: Exception) {
                        snackbar.showSnackbar(ex.message ?: "Could not save")
                    }
                }
            },
            request = { reason -> Graph.repo.requestEdit(list.map { it.id }, e, reason) },
            onDone = { msg -> editPlan = null; scope.launch { snackbar.showSnackbar(msg) } },
            onDismiss = { editPlan = null },
        )
    }

    reprint?.let { list ->
        AlertDialog(
            onDismissRequest = { reprint = null },
            title = { Text("Print new labels?") },
            text = { Text("The code, size or unit on ${list.size} printed label(s) is now different. Print new labels and stick them over the old ones.") },
            confirmButton = {
                TextButton(onClick = {
                    reprint = null
                    Graph.printQueue.printLabels(
                        list.map { if (it.isOpen) LabelSpec.Remainder(it) else LabelSpec.Roll(it) },
                        "corrected ${list.first().code}",
                    )
                }) { Text("Print ${list.size}") }
            },
            dismissButton = { TextButton(onClick = { reprint = null }) { Text("Later") } },
        )
    }

    deleting?.let { target ->
        ApprovalDialog(
            title = target.title,
            body = "Use this only for labels entered by mistake. They leave stock and the Stock tab of the sheet " +
                "and stay in the Items tab marked VOID. Throw the printed label away. " +
                "If it came from a packing list, it goes back to \"to print\" in Receive.",
            confirmLabel = "Delete",
            onConfirm = {
                deleting = null
                scope.launch { Graph.repo.voidItems(target.ids) }
            },
            request = { reason -> Graph.repo.requestDelete(target.ids, reason) },
            onDone = { msg -> deleting = null; scope.launch { snackbar.showSnackbar(msg) } },
            onDismiss = { deleting = null },
        )
    }
}
