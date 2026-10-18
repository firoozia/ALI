package com.zinax.stock.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import com.zinax.stock.data.GroupRow
import com.zinax.stock.data.Item
import com.zinax.stock.data.Product
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** Packages and total quantity in stock. */
private data class Held(val packs: Int, val total: Double)

private fun keyOf(group: String, code: String, size: String, unit: String) = "$group|$code|$size|$unit"

/** Admins keep the product catalog and the product groups. Shared with every phone and the sheet. */
@Composable
fun CatalogScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val dao = Graph.db.dao()
    val products by dao.products().collectAsStateWithLifecycle(emptyList())
    val groups by dao.groups().collectAsStateWithLifecycle(emptyList())
    val stock by dao.inStock().collectAsStateWithLifecycle(emptyList())
    val groupsVersion by Graph.groupsVersion.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }
    var query by remember { mutableStateOf("") }
    var showRemoved by remember { mutableStateOf(false) }
    var editingProduct by remember { mutableStateOf<Product?>(null) }
    var productError by remember { mutableStateOf<String?>(null) }
    var editingGroup by remember { mutableStateOf<GroupRow?>(null) }
    var groupError by remember { mutableStateOf<String?>(null) }
    var reprint by remember { mutableStateOf<List<Item>?>(null) }
    var fixes by remember { mutableStateOf<List<com.zinax.stock.data.Repository.UnitFix>>(emptyList()) }
    var confirmTidy by remember { mutableStateOf(false) }
    var tidying by remember { mutableStateOf(false) }
    LaunchedEffect(stock, products) { fixes = try { Graph.repo.unitFixes() } catch (_: Exception) { emptyList() } }

    val held = remember(stock) {
        stock.groupBy { keyOf(it.category, it.code, it.size, it.unit) }.mapValues { (_, l) -> Held(l.size, l.sumOf { it.remaining }) }
    }
    val heldByGroup = remember(stock) { stock.groupBy { it.category }.mapValues { (_, l) -> l.size } }

    ScreenScaffold(
        "Products & groups", onBack, snackbar,
        actions = {
            TextButton(onClick = {
                if (tab == 0) editingProduct = Product("", Category.entries.first().name, "", "", Category.entries.first().unit, 0.0, "", false, 0)
                else editingGroup = GroupRow("", "", "pcs", "pack", 0, false, 0)
            }) { Text(if (tab == 0) "Add product" else "Add group") }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Products (${products.count { !it.hidden }})") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Groups (${groups.count { !it.hidden }})") })
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (fixes.isNotEmpty()) item {
                    Panel(container = LocalStatus.current.warnSoft, border = LocalStatus.current.warn) {
                        Text("Units written in different ways", fontWeight = FontWeight.SemiBold, color = LocalStatus.current.warn)
                        fixes.forEach { f ->
                            Text(
                                "“${f.from}” → “${f.to}”: " + listOfNotNull(
                                    "${f.labels} label(s) in stock".takeIf { f.labels > 0 },
                                    "${f.products} product(s)".takeIf { f.products > 0 },
                                    "${f.lines} line(s) to receive".takeIf { f.lines > 0 },
                                ).joinToString(", "),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text(
                            "The same product with different spellings shows as separate rows in Stock and reports.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        androidx.compose.material3.Button(onClick = { confirmTidy = true }, enabled = !tidying) {
                            Text(if (tidying) "Tidying…" else "Tidy units")
                        }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (tab == 0) {
                            OutlinedTextField(
                                query, { query = it }, label = { Text("Search code, size or note") }, singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("Show removed", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Switch(checked = showRemoved, onCheckedChange = { showRemoved = it })
                        }
                    }
                }
                if (tab == 0) {
                    val q = query.trim()
                    val shown = products
                        .filter { showRemoved || !it.hidden }
                        .filter { q.isEmpty() || it.code.contains(q, true) || it.size.contains(q, true) || it.note.contains(q, true) }
                        .sortedWith(compareBy({ Category.fromName(it.groupId).ordinal }, { Report.codeSortKey(it.code) }, { it.code }, { it.size }))
                    if (shown.isEmpty()) item { Text("No products yet. Tap Add product.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(shown, key = { it.id }) { p ->
                        Column {
                        val h = held[keyOf(p.groupId, p.code, p.size, p.unit)]
                        val g = Category.fromName(p.groupId)
                        Column(Modifier.fillMaxWidth().clickable { editingProduct = p }.padding(vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        p.code + if (p.note.isNotBlank()) " · ${p.note}" else "",
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (p.hidden) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        listOfNotNull(
                                            g.label, Format.size(p.size).ifBlank { null },
                                            p.packQty.takeIf { it > 0 }?.let { "${Format.qtyUnit(it, p.unit)} per ${g.pack}" } ?: p.unit,
                                            "removed".takeIf { p.hidden },
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    if (h == null) "none in stock" else "${h.packs} ${Report.plural(g.pack, h.packs)} · ${Format.qtyUnit(h.total, p.unit)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (h == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                        HorizontalDivider()
                        }
                    }
                } else {
                    val shown = groups.filter { showRemoved || !it.hidden }
                    items(shown, key = { it.id + groupsVersion }) { g ->
                        Column {
                        val count = products.count { it.groupId == g.id && !it.hidden }
                        Column(Modifier.fillMaxWidth().clickable { editingGroup = g }.padding(vertical = 6.dp)) {
                            Text(g.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                listOfNotNull(
                                    "${g.unit} per ${g.pack}", "$count products", "${heldByGroup[g.id] ?: 0} in stock",
                                    "removed".takeIf { g.hidden },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        HorizontalDivider()
                        }
                    }
                }
            }
        }
    }

    editingProduct?.let { p ->
        ProductDialog(
            product = p,
            error = productError,
            onSave = { saved, apply ->
                productError = null
                scope.launch {
                    try {
                        val result = Graph.repo.saveProduct(saved, apply)
                        val corrected = result.corrected
                        editingProduct = null
                        snackbar.showSnackbar(
                            (if (result.merged) "${saved.code} joined the same product already in ${Category.fromName(saved.groupId).label}"
                            else "Saved ${saved.code}") +
                                if (corrected.isNotEmpty()) " · ${corrected.size} label(s) moved" else ""
                        )
                        val labelChanged = corrected.isNotEmpty() && (saved.code != p.code || saved.size != p.size || saved.unit != p.unit)
                        if (labelChanged) reprint = corrected
                    } catch (e: Exception) {
                        // Shown inside the dialog, where it can be seen.
                        productError = e.message ?: "Could not save"
                    }
                }
            },
            onRemove = { removed ->
                editingProduct = null
                scope.launch {
                    Graph.repo.hideProduct(p.id, removed)
                    snackbar.showSnackbar(if (removed) "${p.code} removed from the catalog. Labels in stock stay." else "${p.code} is back")
                }
            },
            onDismiss = { editingProduct = null; productError = null },
        )
    }

    editingGroup?.let { g ->
        GroupDialog(
            group = g,
            inStock = heldByGroup[g.id] ?: 0,
            error = groupError,
            onSave = { name, unit, pack ->
                groupError = null
                scope.launch {
                    try {
                        Graph.repo.saveGroup(g.id.ifBlank { null }, name, unit, pack)
                        editingGroup = null
                        snackbar.showSnackbar("Saved $name")
                    } catch (e: Exception) {
                        groupError = e.message ?: "Could not save"
                    }
                }
            },
            onRemove = { removed ->
                editingGroup = null
                scope.launch {
                    try {
                        Graph.repo.hideGroup(g.id, removed)
                        snackbar.showSnackbar(if (removed) "${g.name} removed" else "${g.name} is back")
                    } catch (e: Exception) {
                        snackbar.showSnackbar(e.message ?: "Could not remove")
                    }
                }
            },
            onDismiss = { editingGroup = null; groupError = null },
        )
    }

    if (confirmTidy) {
        AlertDialog(
            onDismissRequest = { confirmTidy = false },
            title = { Text("Tidy units?") },
            text = {
                Text(
                    fixes.joinToString("\n") { "“${it.from}” → “${it.to}”" } +
                        "\n\nLabels in stock are corrected and logged under Reports → Edited. Products that become the same " +
                        "are joined. Printed labels can stay; the QR still works. Past ship-outs and cuts keep their spelling."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmTidy = false
                    tidying = true
                    scope.launch {
                        try {
                            val n = Graph.repo.tidyUnits()
                            snackbar.showSnackbar("Units tidied: $n change(s)")
                            fixes = Graph.repo.unitFixes()
                        } catch (e: Exception) {
                            snackbar.showSnackbar(e.message ?: "Could not tidy units")
                        }
                        tidying = false
                    }
                }) { Text("Tidy units") }
            },
            dismissButton = { TextButton(onClick = { confirmTidy = false }) { Text("Cancel") } },
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
                    Graph.printQueue.printLabels(list.map { if (it.isOpen) LabelSpec.Remainder(it) else LabelSpec.Roll(it) }, "corrected ${list.first().code}")
                }) { Text("Print ${list.size}") }
            },
            dismissButton = { TextButton(onClick = { reprint = null }) { Text("Later") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProductDialog(
    product: Product, error: String?, onSave: (Product, Boolean) -> Unit, onRemove: (Boolean) -> Unit, onDismiss: () -> Unit,
) {
    val isNew = product.id.isBlank()
    var group by remember { mutableStateOf(product.groupId) }
    var code by remember { mutableStateOf(product.code) }
    var size by remember { mutableStateOf(product.size) }
    var unit by remember { mutableStateOf(product.unit) }
    var qty by remember { mutableStateOf(if (product.packQty > 0) Format.qty(product.packQty) else "") }
    var note by remember { mutableStateOf(product.note) }
    var applyToStock by remember { mutableStateOf(true) }
    var inStock by remember { mutableIntStateOf(0) }
    LaunchedEffect(product.id) { if (!isNew) inStock = Graph.repo.stockOf(product).size }
    val keyChanged = !isNew && (group != product.groupId || code.trim() != product.code || size.trim() != product.size || unit.trim() != product.unit)
    val groupsList = (Category.entries + Category.fromName(product.groupId)).distinct()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "Add product" else "Edit ${product.code}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Group", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    groupsList.forEach { c ->
                        FilterChip(selected = group == c.name, onClick = {
                            // A new product takes the group's usual unit.
                            if (isNew && unit == Category.fromName(group).unit) unit = c.unit
                            group = c.name
                        }, label = { Text(c.label) })
                    }
                }
                OutlinedTextField(
                    code, { code = it }, label = { Text("Code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(size, { size = it }, label = { Text("Size (optional)") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(unit, { unit = it }, label = { Text("Unit") }, singleLine = true, modifier = Modifier.weight(0.6f))
                }
                OutlinedTextField(
                    qty, { qty = it }, label = { Text("Usual quantity per ${Category.fromName(group).pack} (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(note, { note = it }, label = { Text("Colour or description (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (keyChanged && inStock > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = applyToStock, onCheckedChange = { applyToStock = it })
                        Text("Also correct the $inStock label(s) of this product in stock (logged under Reports → Edited)", style = MaterialTheme.typography.bodySmall)
                    }
                }
                error?.let { Text(it, color = LocalStatus.current.bad, fontWeight = FontWeight.SemiBold) }
                if (!isNew) {
                    TextButton(onClick = { onRemove(!product.hidden) }) {
                        Text(if (product.hidden) "Bring back to the catalog" else "Remove from the catalog", color = LocalStatus.current.bad)
                    }
                    if (!product.hidden) {
                        Text(
                            "Removing only stops suggesting it. Labels in stock stay; delete those from Stock.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = code.isNotBlank() && unit.isNotBlank(),
                onClick = {
                    onSave(
                        product.copy(groupId = group, code = code, size = size, unit = unit, packQty = Format.number(qty) ?: 0.0, note = note),
                        keyChanged && applyToStock,
                    )
                },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun GroupDialog(
    group: GroupRow, inStock: Int, error: String?, onSave: (String, String, String) -> Unit, onRemove: (Boolean) -> Unit, onDismiss: () -> Unit,
) {
    val isNew = group.id.isBlank()
    var name by remember { mutableStateOf(group.name) }
    var unit by remember { mutableStateOf(group.unit) }
    var pack by remember { mutableStateOf(group.pack) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "Add group" else "Edit ${group.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name, e.g. MDF board") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(unit, { unit = it }, label = { Text("Usual unit") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(pack, { pack = it }, label = { Text("One package is a") }, singleLine = true, modifier = Modifier.weight(1f))
                }
                Text(
                    "Unit: m, kg, pcs… Package: roll, gallon, bag, carton, sheet…",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let { Text(it, color = LocalStatus.current.bad, fontWeight = FontWeight.SemiBold) }
                if (!isNew && group.id != Category.OTHER.name) {
                    TextButton(onClick = { onRemove(!group.hidden) }) {
                        Text(if (group.hidden) "Bring back" else "Remove group", color = LocalStatus.current.bad)
                    }
                    if (!group.hidden && inStock > 0) {
                        Text(
                            "$inStock label(s) in stock are in this group. They stay in stock under this name; " +
                                "it is only no longer offered for new labels.",
                            style = MaterialTheme.typography.bodySmall, color = LocalStatus.current.warn,
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = name.isNotBlank() && unit.isNotBlank(), onClick = { onSave(name, unit, pack) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
