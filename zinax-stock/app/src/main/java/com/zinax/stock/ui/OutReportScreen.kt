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
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.Format
import com.zinax.stock.core.OutReport
import com.zinax.stock.core.OutSource
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** What left the warehouse on one day, per code, with the ship-outs behind each line. */
@Composable
fun OutReportScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val today = remember { Format.dayStart(System.currentTimeMillis()) }
    var day by remember { mutableLongStateOf(today) }
    var open by remember { mutableStateOf<String?>(null) }
    val moves by Graph.db.dao().shippedBetween(day, Format.addDays(day, 1)).collectAsStateWithLifecycle(emptyList())
    var outs by remember { mutableStateOf<List<OutSource>>(emptyList()) }
    LaunchedEffect(moves, day) { outs = Graph.outsFor(day) }

    val lines = remember(outs) { OutReport.lines(outs) }
    val time = remember { SimpleDateFormat("HH:mm", Locale.US) }

    ScreenScaffold("Ship-out report", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { day = Format.addDays(day, -1); open = null }) { Text("‹ Previous") }
                    Text(
                        if (day == today) "Today · ${Format.date(day)}" else Format.date(day),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { day = Format.addDays(day, 1); open = null }, enabled = day < today) { Text("Next ›") }
                }
            }
            item {
                Panel {
                    if (lines.isEmpty()) {
                        Text("Nothing was shipped out on this day.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Text(
                            "${outs.map { it.itemId }.distinct().size} packages · ${lines.size} codes",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        lines.groupBy { it.unit }.forEach { (u, r) -> KeyValue("Total", Format.qtyUnit(r.sumOf { it.total }, u)) }
                    }
                    Text(
                        "Includes ship-outs from other phones after they sync.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
                        if (l.references.isNotEmpty()) {
                            Text(
                                "To: ${l.references.joinToString(", ")}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                    if (open == key) {
                        outs.filter { it.code == l.code && it.size == l.size && it.unit == l.unit }.sortedBy { it.at }.forEach { o ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(o.itemId, style = MonoStyle, fontWeight = FontWeight.Medium)
                                    Text(
                                        listOf(time.format(Date(o.at)), o.reference.ifBlank { "—" }, "phone ${o.device}").joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    Format.qtyUnit(o.qty, o.unit) + if (OutReport.isCut(o)) " (cut)" else "",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { scope.launch { Graph.shareOutReport(context, day, excel = true) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send Excel") }
                    OutlinedButton(
                        onClick = { scope.launch { Graph.shareOutReport(context, day, excel = false) } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Send as text") }
                }
            }
            item {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            try { Graph.sync.sync() } catch (_: Exception) {}
                            outs = Graph.outsFor(day)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Sync to include other phones") }
            }
        }
    }
}
