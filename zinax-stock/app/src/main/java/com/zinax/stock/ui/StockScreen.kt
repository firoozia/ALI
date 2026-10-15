package com.zinax.stock.ui

import com.zinax.stock.ui.theme.LocalStatus
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemEdit
import com.zinax.stock.printer.LabelSpec
import kotlinx.coroutines.launch

/** What the move dialog is moving: one package, or every package in a code group on screen. */
private data class MoveTarget(val title: String, val ids: List<String>, val current: String)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StockScreen(onBack: () -> Unit, onCut: (String) -> Unit, onMoveScan: () -> Unit) {
    val scope = rememberCoroutineScope()
    val items by Graph.db.dao().inStock().collectAsStateWithLifecycle(emptyList())
    var query by remember { mutableStateOf("") }
    var place by remember { mutableStateOf<String?>(null) }
    var cat by remember { mutableStateOf<Category?>(null) }
    var openOnly by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<MoveTarget?>(null) }
    var deleting by remember { mutableStateOf<MoveTarget?>(null) }
    var editing by remember { mutableStateOf<List<Item>?>(null) }
    var editPlan by remember { mutableStateOf<Pair<List<Item>, ItemEdit>?>(null) }
    var reprint by remember { mutableStateOf<List<Item>?>(null) }
    var damaging by remember { mutableStateOf<Item?>(null) }
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
    // Groups that have stock, in catalog order, with how many packages each holds.
    val cats = remember(items) {
        val counts = items.groupingBy { it.categoryEnum }.eachCount()
        Category.entries.filter { it in counts }.map { it to counts.getValue(it) }
    }
    val shown = remember(items, query, place, cat, openOnly, notes) {
        items.filter { !openOnly || it.isOpen }
            .filter { cat == null || it.categoryEnum == cat }
            .filter {
                query.isBlank() || it.code.contains(query.trim(), true) || it.id.contains(query.trim(), true) ||
                    it.categoryEnum.label.contains(query.trim(), true) ||
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
            if (cats.size > 1 || cat != null) item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { FilterChip(selected = cat == null, onClick = { cat = null }, label = { Text("All groups") }) }
                    items(cats) { (c, n) ->
                        FilterChip(selected = cat == c, onClick = { cat = if (cat == c) null else c }, label = { Text("${c.label} ($n)") })
                    }
                }
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
                        (if (openOnly) " · open rolls only" else "") +
                        " · " + shown.groupBy { it.unit }.entries.joinToString(", ") { (u, l) -> Format.qtyUnit(l.sumOf { it.remaining }, u) },
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
                    .map { (p, l) -> Triple(p, l.size, Format.qtyUnit(l.sumOf { it.remaining }, first.unit) as String?) }
                Panel {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = first.code,
                            title = (if (opened > 0) "${list.size - opened} full · $opened open" else "${list.size} $pack") +
                                " · ${Format.qtyUnit(total, first.unit)}",
                            highlight = if (opened > 0) "$opened open" else null,
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
                        // Open rolls first, the least left on top because they are used up first; then full ones by date.
                        list.sortedWith(compareByDescending<Item> { it.isOpen }.thenBy { if (it.isOpen) it.remaining else 0.0 }.thenBy { it.receivedAt })
                            .forEach { item ->
                            HorizontalDivider()
                            val status = LocalStatus.current
                            val rowMod = if (item.isOpen) {
                                Modifier.fillMaxWidth()
                                    .background(status.open.copy(alpha = 0.22f))
                                    .drawBehind { drawRect(status.open, size = Size(4.dp.toPx(), size.height)) }
                                    .padding(start = 10.dp, top = 4.dp, bottom = 2.dp)
                            } else Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 2.dp)
                            Column(rowMod) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Text(item.id, style = MonoStyle, fontWeight = FontWeight.Medium)
                                        Text(
                                            listOfNotNull(
                                                Format.qtyUnit(item.remaining, item.unit) + if (item.remaining < item.qty) " of ${Format.qty(item.qty)}" else "",
                                                item.pallet?.let { "Pallet $it" },
                                                Format.date(item.receivedAt),
                                            ).joinToString(" · "),
                                            style = if (item.isOpen) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodySmall,
                                            fontWeight = if (item.isOpen) FontWeight.SemiBold else null,
                                            color = if (item.isOpen) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        if (item.isOpen) OpenBadge(true)
                                        LocationBadge(item.location)
                                    }
                                }
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                                    RowAction("Move") { moving = MoveTarget("Move ${item.id}", listOf(item.id), item.location) }
                                    RowAction("Reprint") { Graph.printQueue.print(listOf(item), item.id) }
                                    RowAction("✂ Cut") { onCut(item.id) }
                                    RowAction("Damage", enabled = item.id !in waiting) { damaging = item }
                                    RowAction("Edit", enabled = item.id !in waiting) { editing = listOf(item) }
                                    if (item.isOpen) {
                                        RowAction("Remainder") { Graph.printQueue.printLabels(listOf(LabelSpec.Remainder(item)), "remainder ${item.id}") }
                                    }
                                    if (item.id in waiting) {
                                        Text(
                                            "Waiting for admin", style = MaterialTheme.typography.labelMedium, color = status.warn,
                                            modifier = Modifier.padding(horizontal = 8.dp).align(Alignment.CenterVertically),
                                        )
                                    } else {
                                        RowAction("Delete", color = status.bad) { deleting = MoveTarget("Delete ${item.id}?", listOf(item.id), "") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    damaging?.let { target ->
        DamageDialog(target, onDismiss = { damaging = null }, onDone = { msg -> scope.launch { snackbar.showSnackbar(msg) } })
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

/** A compact text button for the actions under a roll, so the row stays short. */
@Composable
private fun RowAction(text: String, color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified, enabled: Boolean = true, onClick: () -> Unit) {
    TextButton(
        onClick = onClick, enabled = enabled,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
        modifier = Modifier.heightIn(min = 34.dp),
    ) { Text(text, color = color, style = MaterialTheme.typography.labelLarge) }
}
