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
import androidx.compose.material3.Text
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
fun ReportsScreen(onBack: () -> Unit, start: Activity = Activity.OUT) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val today = remember { Format.dayStart(System.currentTimeMillis()) }
    var activity by remember { mutableStateOf(start) }
    var range by remember { mutableStateOf(Range.TODAY) }
    var from by remember { mutableLongStateOf(today) }
    var to by remember { mutableLongStateOf(Format.addDays(today, 1)) }
    var user by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var undoing by remember { mutableStateOf<UndoTarget?>(null) }

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

    val moves by Graph.db.dao().movementsBetween(activity.type, from, to).collectAsStateWithLifecycle(emptyList())
    var all by remember { mutableStateOf<List<OutSource>>(emptyList()) }
    LaunchedEffect(moves, activity, from, to) { all = Graph.activityFor(activity, from, to) }
    val users = remember(all) { all.map { OutReport.who(it) }.distinct().sorted() }
    val shown = remember(all, user) { if (user == null) all else all.filter { OutReport.who(it) == user } }
    val lines = remember(shown) { OutReport.lines(shown) }
    val customers = remember(shown, activity) { if (activity == Activity.CUT) OutReport.customerLines(shown) else emptyList() }
    val stamp = remember { SimpleDateFormat("MM-dd HH:mm", Locale.US) }

    ScreenScaffold("Reports", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(Activity.entries) { a ->
                            FilterChip(selected = a == activity, onClick = { activity = a; open = null; user = null }, label = { Text(a.title) })
                        }
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(Range.entries) { r ->
                            FilterChip(selected = r == range, onClick = { choose(r) }, label = { Text(r.label) })
                        }
                    }
                    Text(OutReport.period(from, to), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (users.size > 1 || user != null) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            item { FilterChip(selected = user == null, onClick = { user = null }, label = { Text("All users") }) }
                            items(users) { u -> FilterChip(selected = user == u, onClick = { user = if (user == u) null else u }, label = { Text(u) }) }
                        }
                    }
                }
            }
            item {
                Panel {
                    if (lines.isEmpty()) {
                        Text("Nothing ${activity.verb} in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            items(lines, key = { "${it.code}|${it.size}|${it.unit}" }) { l ->
                val key = "${l.code}|${l.size}|${l.unit}"
                Panel {
                    Column(Modifier.clickable { open = if (open == key) null else key }) {
                        CodeRow(
                            code = l.code,
                            title = OutReport.lineSummary(l),
                            subtitle = listOfNotNull(l.category?.label, Format.size(l.size).takeIf { it.isNotBlank() }).joinToString(" · "),
                        )
                        if ((activity == Activity.OUT || activity == Activity.CUT) && l.references.isNotEmpty()) {
                            Text("To: ${l.references.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        }
                        Text("By: ${l.users.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (open == key) {
                        shown.filter { it.code == l.code && it.size == l.size && it.unit == l.unit }.sortedBy { it.at }.forEach { o ->
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
                                    if (activity in OutReport.undoable && o.id.isNotEmpty()) {
                                        TextButton(onClick = { undoing = UndoTarget(o.id, o.itemId, o.code, o.qty, o.unit, o.reference, o.type) }) {
                                            Text("Undo", color = LocalStatus.current.bad)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { scope.launch { Graph.shareActivityReport(context, activity, from, to, shown, excel = true) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send Excel") }
                    OutlinedButton(
                        onClick = { scope.launch { Graph.shareActivityReport(context, activity, from, to, shown, excel = false) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send as text") }
                }
            }
            item {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try { Graph.sync.sync() } catch (_: Exception) {}
                            all = Graph.activityFor(activity, from, to)
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
                        Graph.repo.undoShipOut(target.movementId)
                    } catch (_: Exception) {
                    }
                    all = Graph.activityFor(activity, from, to)
                }
            },
            onDismiss = { undoing = null },
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
