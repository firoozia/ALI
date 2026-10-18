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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Activity
import com.zinax.stock.core.CustomerNames
import com.zinax.stock.core.Format
import com.zinax.stock.core.OutReport
import com.zinax.stock.core.OutSource
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class Range(val label: String) { TODAY("Today"), YESTERDAY("Yesterday"), WEEK("Last 7 days"), MONTH("This month"), CUSTOM("Pick dates…") }

/**
 * Reports of what was shipped out, cut, written off, received, deleted or moved, for a date range,
 * with who did it. [start] picks the first tab.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(onBack: () -> Unit, start: Activity? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val today = remember { Format.dayStart(System.currentTimeMillis()) }
    // null means All: every kind of change in the period, newest first.
    var activity by remember { mutableStateOf(start) }
    val act = activity
    val status = LocalStatus.current
    var range by remember { mutableStateOf(Range.TODAY) }
    var from by remember { mutableLongStateOf(today) }
    var to by remember { mutableLongStateOf(Format.addDays(today, 1)) }
    var user by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var open by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var undoing by remember { mutableStateOf<UndoTarget?>(null) }
    val waiting = rememberWaiting()
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }

    fun choose(r: Range) {
        if (r == Range.CUSTOM) { picking = true; return }
        range = r
        open = null
        when (r) {
            Range.TODAY -> { from = today; to = Format.addDays(today, 1) }
            Range.YESTERDAY -> { from = Format.addDays(today, -1); to = today }
            Range.WEEK -> { from = Format.addDays(today, -6); to = Format.addDays(today, 1) }
            Range.MONTH -> { from = Format.monthStart(today); to = Format.addDays(today, 1) }
            Range.CUSTOM -> {}
        }
    }

    val moveFlow = remember(act, from, to) {
        if (act == null) Graph.db.dao().movementsBetweenAll(from, to) else Graph.db.dao().movementsBetween(act.type, from, to)
    }
    val moves by moveFlow.collectAsStateWithLifecycle(emptyList())
    suspend fun load(): List<OutSource> =
        if (act == null) Activity.entries.flatMap { Graph.activityFor(it, from, to, includeUndone = true) }
        else Graph.activityFor(act, from, to, includeUndone = true)
    var all by remember { mutableStateOf<List<OutSource>>(emptyList()) }
    LaunchedEffect(moves, act, from, to) { all = load() }
    val users = remember(all) { all.map { OutReport.who(it) }.distinct().sorted() }
    // Search by customer, invoice, code or label ID; case and Arabic/Persian letter forms are ignored.
    val shown = remember(all, user, query) {
        val k = CustomerNames.key(query)
        all.filter { user == null || OutReport.who(it) == user }
            .filter { k.isEmpty() || listOf(it.customer, it.invoice, it.code, it.itemId, it.reference).any { f -> CustomerNames.key(f).contains(k) } }
    }
    // Cancelled (undone) entries are listed but never counted: totals, lines and exports use [live].
    val live = remember(shown) { shown.filter { !it.undone } }
    val undoneRows = remember(shown) { shown.filter { it.undone }.sortedByDescending { it.at } }
    val lines = remember(live, act) { if (act == null) emptyList() else OutReport.lines(live) }
    val customers = remember(live, act) { if (act == Activity.CUT) OutReport.customerLines(live) else emptyList() }
    val stamp = remember { SimpleDateFormat("MM-dd HH:mm", Locale.US) }

    ScreenScaffold("Reports", onBack, snackbar) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        item { FilterChip(selected = act == null, onClick = { activity = null; open = null; user = null }, label = { Text("All") }) }
                        items(Activity.entries) { a ->
                            FilterChip(selected = a == act, onClick = { activity = a; open = null; user = null }, label = { Text(a.title) })
                        }
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(Range.entries) { r ->
                            FilterChip(selected = r == range, onClick = { choose(r) }, label = { Text(r.label) })
                        }
                    }
                    Text(OutReport.period(from, to), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        query, { query = it; open = null }, label = { Text("Search customer, invoice or code") },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        trailingIcon = { if (query.isNotEmpty()) TextButton(onClick = { query = ""; open = null }) { Text("Clear") } },
                    )
                    if (users.size > 1 || user != null) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            item { FilterChip(selected = user == null, onClick = { user = null }, label = { Text("All users") }) }
                            items(users) { u -> FilterChip(selected = user == u, onClick = { user = if (user == u) null else u }, label = { Text(u) }) }
                        }
                    }
                }
            }
            if (act != null) item {
                Panel {
                    if (lines.isEmpty()) {
                        Text(
                            if (query.isNotBlank() && all.isNotEmpty()) "Nothing ${act?.verb} matches \"${query.trim()}\" in this period."
                            else "Nothing ${act?.verb} in this period.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Text(
                            "${shown.map { it.itemId }.distinct().size} packages · ${lines.size} codes",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        lines.groupBy { it.unit }.forEach { (u, r) -> KeyValue("Total", Format.qtyUnit(r.sumOf { it.total }, u)) }
                    }
                    Text(
                        "Includes other phones after they sync.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (customers.isNotEmpty()) item {
                Panel {
                    Text("By customer", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    customers.forEachIndexed { i, c ->
                        if (i > 0) HorizontalDivider()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(c.customer, fontWeight = FontWeight.Medium)
                                Text(
                                    listOfNotNull(
                                        "${c.cuts} ${if (c.cuts == 1) "cut" else "cuts"}",
                                        c.codes.joinToString(", "),
                                        c.invoices.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "Inv "),
                                        c.users.joinToString(", ").takeIf { it.isNotBlank() }?.let { "by $it" },
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(c.totalText, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            if (act == null) {
                item {
                    Panel {
                        val groups = Activity.entries.mapNotNull { a -> live.filter { it.type == a.type }.takeIf { it.isNotEmpty() }?.let { a to it } }
                        if (groups.isEmpty()) {
                            Text(
                                if (query.isNotBlank() && all.isNotEmpty()) "Nothing matches \"${query.trim()}\" in this period." else "Nothing happened in this period.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            Text("Everything in this period", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            groups.forEachIndexed { i, (a, list) ->
                                if (i > 0) HorizontalDivider()
                                Row(
                                    Modifier.fillMaxWidth().clickable { activity = a; open = null; user = null },
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(a.title, fontWeight = FontWeight.Medium)
                                        Text(
                                            "${list.map { it.itemId }.distinct().size} packages",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(
                                        list.groupBy { it.unit }.entries.joinToString(", ") { (u, l) -> Format.qtyUnit(l.sumOf { it.qty }, u) },
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                }
                            }
                            Text("Tap a line to see only that kind.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text("Includes other phones after they sync.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(shown.sortedByDescending { it.at }, key = { it.id }) { o ->
                    val kind = Activity.entries.firstOrNull { it.type == o.type }
                    // Yellow: cancelled with Undo. Red: deleted.
                    val deleted = o.type == Activity.VOID.type
                    Panel(
                        container = if (o.undone) status.warnSoft else if (deleted) status.badSoft else MaterialTheme.colorScheme.surface,
                        border = if (o.undone) status.warn else if (deleted) status.bad else MaterialTheme.colorScheme.outline,
                    ) {
                        CodeRow(
                            code = o.code,
                            title = (if (o.undone) "UNDONE · " else "") + (kind?.noun ?: o.type) + " · " + Format.qtyUnit(o.qty, o.unit),
                            subtitle = listOf(stamp.format(Date(o.at)), OutReport.who(o), o.reference.ifBlank { "—" }).joinToString(" · ") +
                                if (o.undone) " · undone by ${o.undoneBy}" else "",
                            trailing = {
                                if (!o.undone && kind != null && kind in OutReport.undoable && o.id.isNotEmpty()) {
                                    UndoButton(o.id, waiting) { undoing = UndoTarget(o.id, o.itemId, o.code, o.qty, o.unit, o.reference, o.type) }
                                }
                            },
                        )
                    }
                }
            }
            items(lines, key = { "${it.code}|${it.size}|${it.unit}" }) { l ->
                val key = "${l.code}|${l.size}|${l.unit}"
                Panel(
                    container = if (act == Activity.VOID) status.badSoft else MaterialTheme.colorScheme.surface,
                    border = if (act == Activity.VOID) status.bad else MaterialTheme.colorScheme.outline,
                ) {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = l.code,
                            title = OutReport.lineSummary(l),
                            subtitle = listOfNotNull(l.category?.label, Format.size(l.size).takeIf { it.isNotBlank() }).joinToString(" · "),
                        )
                        if ((act == Activity.OUT || act == Activity.CUT) && l.references.isNotEmpty()) {
                            Text("To: ${l.references.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        }
                        Text("By: ${l.users.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (open == key) {
                        live.filter { it.code == l.code && it.size == l.size && it.unit == l.unit }.sortedBy { it.at }.forEach { o ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(o.itemId, style = MonoStyle, fontWeight = FontWeight.Medium)
                                    Text(
                                        listOf(stamp.format(Date(o.at)), OutReport.who(o), o.reference.ifBlank { "—" }).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        Format.qtyUnit(o.qty, o.unit) + if (OutReport.isCut(o)) " (cut)" else "",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    if (act != null && act in OutReport.undoable && o.id.isNotEmpty()) {
                                        UndoButton(o.id, waiting) { undoing = UndoTarget(o.id, o.itemId, o.code, o.qty, o.unit, o.reference, o.type) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (act != null && undoneRows.isNotEmpty()) item {
                Panel(container = status.warnSoft, border = status.warn) {
                    Text("Undone in this period (${undoneRows.size}) · not counted above", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    undoneRows.forEach { o ->
                        HorizontalDivider()
                        Text(
                            "${o.code} · ${Format.qtyUnit(o.qty, o.unit)} · ${o.reference.ifBlank { "—" }}",
                            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
                        )
                        Text(
                            "${stamp.format(Date(o.at))} · ${OutReport.who(o)} · undone by ${o.undoneBy}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { scope.launch { if (act == null) Graph.shareAllReport(context, from, to, live, excel = true) else Graph.shareActivityReport(context, act, from, to, live, excel = true) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send Excel") }
                    OutlinedButton(
                        onClick = { scope.launch { if (act == null) Graph.shareAllReport(context, from, to, live, excel = false) else Graph.shareActivityReport(context, act, from, to, live, excel = false) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send as text") }
                }
            }
            item {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try { Graph.sync.sync() } catch (_: Exception) {}
                            all = load()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Sync to include other phones") }
            }
        }
    }

    undoing?.let { target ->
        UndoDialog(
            target = target,
            onConfirm = {
                undoing = null
                scope.launch {
                    try {
                        val roll = Graph.repo.undoShipOut(target.movementId)
                        Graph.printUndoRoll(roll)
                        if (roll != null) snackbar.showSnackbar("New open roll ${roll.id}: ${Format.qtyUnit(roll.remaining, roll.unit)} of ${roll.code}")
                    } catch (e: Exception) {
                        snackbar.showSnackbar(e.message ?: "Could not undo")
                    }
                    all = load()
                }
            },
            onDismiss = { undoing = null },
            onDone = { msg -> scope.launch { snackbar.showSnackbar(msg); all = load() } },
        )
    }

    if (picking) {
        val state = rememberDateRangePickerState(
            initialSelectedStartDateMillis = Format.localDayToUtcDate(from),
            initialSelectedEndDateMillis = Format.localDayToUtcDate(Format.addDays(to, -1)),
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        val s = state.selectedStartDateMillis
                        if (s != null) {
                            val e = state.selectedEndDateMillis ?: s
                            from = Format.utcDateToLocalDay(s)
                            to = Format.addDays(Format.utcDateToLocalDay(e), 1)
                            range = Range.CUSTOM
                            open = null
                        }
                        picking = false
                    },
                    enabled = state.selectedStartDateMillis != null,
                ) { Text("Show") }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
        ) {
            DateRangePicker(state = state, modifier = Modifier.weight(1f))
        }
    }
}
