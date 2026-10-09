package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.zinax.stock.Graph
import com.zinax.stock.Routes
import com.zinax.stock.Share
import com.zinax.stock.core.CheckLine
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import com.zinax.stock.ui.theme.LocalStatus

@Composable
fun ShipmentsScreen(nav: NavController, onBack: () -> Unit) {
    val dao = Graph.db.dao()
    val shipments by dao.shipments().collectAsStateWithLifecycle(emptyList())
    val expected by dao.allExpected().collectAsStateWithLifecycle(emptyList())
    val byShipment = remember(expected) { expected.groupBy { it.shipmentId } }

    ScreenScaffold("Shipments", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Button(onClick = { nav.navigate(Routes.IMPORT) }, modifier = Modifier.fillMaxWidth()) { Text("Import packing list") }
            }
            if (shipments.isEmpty()) item {
                Text("No shipments yet. Import the packing list that came with the container.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(shipments, key = { it.id }) { s ->
                val units = byShipment[s.id].orEmpty()
                val done = units.count { it.itemId != null }
                Panel {
                    Text(s.name, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${Format.date(s.createdAt)} · ${palletOrder(units.map { it.pallet }).size} pallets · $done of ${units.size} labelled",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    LinearProgressIndicator(
                        progress = { if (units.isEmpty()) 0f else done / units.size.toFloat() },
                        modifier = Modifier.fillMaxWidth(),
                        color = LocalStatus.current.ok,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { nav.navigate(Routes.receive(s.id)) }) { Text("Receive") }
                        OutlinedButton(onClick = { nav.navigate(Routes.check(s.id)) }) { Text("Check") }
                    }
                }
            }
        }
    }
}

@Composable
fun CheckScreen(shipmentId: String, nav: NavController, onBack: () -> Unit) {
    val context = LocalContext.current
    val dao = Graph.db.dao()
    val status = LocalStatus.current
    val units by dao.expected(shipmentId).collectAsStateWithLifecycle(emptyList())
    val items by dao.itemsForShipment(shipmentId).collectAsStateWithLifecycle(emptyList())
    var name by remember { mutableStateOf("") }
    LaunchedEffect(shipmentId) { name = dao.shipment(shipmentId)?.name.orEmpty() }

    val lines = remember(units) {
        units.groupBy { Triple(it.code, it.size, it.unit) }.map { (k, list) ->
            CheckLine(k.first, k.second, k.third, list.size, list.count { it.itemId != null })
        }.sortedWith(compareBy<CheckLine>({ Report.codeSortKey(it.code) }, { it.code }))
    }
    val linked = remember(units) { units.mapNotNull { it.itemId }.toSet() }
    val extras = remember(items, linked) {
        items.filter { it.id !in linked }.groupBy { Triple(it.code, it.size, it.unit) }
            .map { (k, list) -> CheckLine(k.first, k.second, k.third, 0, list.size) }
    }
    val expectedTotal = lines.sumOf { it.expected }
    val labelled = lines.sumOf { it.labelled }
    val missing = lines.filter { it.missing > 0 }

    ScreenScaffold("Shipment check", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Panel {
                    Text(name, style = MaterialTheme.typography.labelMedium)
                    Text("$labelled / $expectedTotal labelled", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    LinearProgressIndicator(
                        progress = { if (expectedTotal == 0) 0f else labelled / expectedTotal.toFloat() },
                        modifier = Modifier.fillMaxWidth(),
                        color = status.ok,
                    )
                }
            }
            item {
                if (missing.isEmpty() && expectedTotal > 0) {
                    Notice("Every package on the list has a label.", status.ok, status.okSoft, "All correct")
                } else if (missing.isNotEmpty()) {
                    Notice(
                        "${missing.sumOf { it.missing }} package(s) of ${missing.size} code(s) have no label yet. " +
                            "They were not found on the pallets opened so far.",
                        status.bad, status.badSoft, "Missing",
                    )
                }
            }
            items(missing, key = { "m|${it.code}|${it.size}|${it.unit}" }) { l ->
                Panel {
                    CodeRow(
                        code = l.code,
                        title = "${l.missing} missing",
                        subtitle = "${l.expected} expected · ${l.labelled} labelled" + if (l.size.isNotBlank()) " · ${Format.size(l.size)}" else "",
                        codeColor = status.bad,
                        trailing = { Pill("Missing", status.bad, status.badSoft) },
                    )
                }
            }
            items(extras, key = { "x|${it.code}|${it.size}|${it.unit}" }) { l ->
                Panel {
                    CodeRow(
                        code = l.code,
                        title = "${l.labelled} not on the list",
                        subtitle = "Added by hand" + if (l.size.isNotBlank()) " · ${Format.size(l.size)}" else "",
                        codeColor = status.warn,
                        trailing = { Pill("Extra", status.warn, status.warnSoft) },
                    )
                }
            }
            item {
                Button(
                    onClick = { Share.text(context, Report.checkText(name, lines, extras, System.currentTimeMillis())) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Share report") }
            }
            item {
                OutlinedButton(onClick = { nav.navigate(Routes.receive(shipmentId)) }, modifier = Modifier.fillMaxWidth()) { Text("Back to receiving") }
            }
        }
    }
}
