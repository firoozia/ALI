package com.zinax.stock.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.zinax.stock.Graph
import com.zinax.stock.core.CodeSuggest
import com.zinax.stock.core.CutCandidate
import com.zinax.stock.core.CutPlan
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.core.Lengths
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.data.Repository
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** True when part of the package has already been cut or shipped. */
val Item.isOpen: Boolean get() = status == ItemStatus.IN_STOCK && remaining < qty - 1e-6

/** Orange OPEN badge for a cut roll, blue FULL for an untouched one. */
@Composable
fun OpenBadge(open: Boolean) {
    val status = LocalStatus.current
    val (bg, fg) = if (open) status.open to status.openText else MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.primary
    Surface(color = bg, shape = RoundedCornerShape(5.dp)) {
        Text(
            if (open) "OPEN" else "FULL",
            color = fg,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
        )
    }
}

/**
 * Cut metres from a roll for a customer: pick the roll (open rolls first), enter customer,
 * invoice and length, cut, and print the customer label. [startItem] opens a roll directly.
 */
@Composable
fun CutScreen(startItem: String?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val dao = Graph.db.dao()
    var itemId by remember { mutableStateOf(startItem) }
    var code by remember { mutableStateOf("") }
    val stock by dao.inStock().collectAsStateWithLifecycle(emptyList())

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { raw ->
            val id = LabelId.normalize(raw)
            scope.launch {
                val found = dao.item(id)
                when {
                    found == null -> snackbar.showSnackbar("No label $id in this phone. Sync and try again.")
                    found.status != ItemStatus.IN_STOCK -> snackbar.showSnackbar("$id is not in stock")
                    else -> { itemId = found.id; code = found.code }
                }
            }
        }
    }
    val scan = {
        scanner.launch(
            ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE, ScanOptions.CODE_128)
                .setPrompt("Point at the roll label").setBeepEnabled(true).setOrientationLocked(false)
        )
    }

    val item = stock.firstOrNull { it.id == itemId }
    ScreenScaffold(
        title = if (item != null) "Cut ${item.code}" else "Cut",
        onBack = { if (itemId != null && startItem == null) itemId = null else onBack() },
        snackbar = snackbar,
        actions = { TextButton(onClick = scan) { Text("Scan roll") } },
    ) { padding ->
        FormBody(padding) {
            if (itemId == null || item == null) {
                if (itemId != null && item == null) {
                    Notice("This roll is no longer in stock. Pick another.", LocalStatus.current.warn, LocalStatus.current.warnSoft)
                }
                PickRoll(stock, code, { code = it }) { picked -> itemId = picked.id; code = picked.code }
            } else {
                CutForm(item, snackbar, onChangeRoll = { itemId = null })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PickRoll(stock: List<Item>, code: String, onCode: (String) -> Unit, onPick: (Item) -> Unit) {
    val codes = remember(stock) { stock.map { it.code }.distinct() }
    val suggestions = remember(codes, code) { if (code in codes) emptyList() else CodeSuggest.filter(codes, code, { it }) }
    OutlinedTextField(
        code, onCode, label = { Text("Colour code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
    )
    if (suggestions.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            suggestions.forEach { c -> FilterChip(selected = false, onClick = { onCode(c) }, label = { Text(c) }) }
        }
    }
    val rolls = remember(stock, code) { stock.filter { it.code.equals(code.trim(), ignoreCase = true) } }
    if (code.isNotBlank() && rolls.isEmpty() && suggestions.isEmpty()) {
        Text("No rolls of $code in stock.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (rolls.isNotEmpty()) {
        val byId = rolls.associateBy { it.id }
        val ordered = remember(rolls) { CutPlan.order(rolls.map { CutCandidate(it.id, it.remaining, it.qty, it.receivedAt) }) }
        val best = ordered.firstOrNull()?.id
        Text(
            if (ordered.any { it.open }) "Open rolls first, smallest first" else "Full rolls, oldest first",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ordered.mapNotNull { byId[it.id] }.forEach { r ->
            val isBest = r.id == best
            Card(
                modifier = Modifier.fillMaxWidth().clickable { onPick(r) },
                shape = RoundedCornerShape(10.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(if (isBest) 2.dp else 1.dp, if (isBest) LocalStatus.current.open else MaterialTheme.colorScheme.outline),
            ) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OpenBadge(r.isOpen)
                    Column(Modifier.weight(1f)) {
                        if (isBest) Text("Suggested", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                        Text(r.id, style = MonoStyle.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize))
                        LocationBadge(r.location)
                    }
                    Text(
                        Format.qtyUnit(r.remaining, r.unit),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

@Composable
private fun CutForm(item: Item, snackbar: SnackbarHostState, onChangeRoll: () -> Unit) {
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    val prefs = Graph.prefs
    var customer by remember { mutableStateOf("") }
    var invoice by remember { mutableStateOf("") }
    var lengthText by remember { mutableStateOf("") }
    val metresRoll = item.unit.equals("m", ignoreCase = true)
    var cm by remember { mutableStateOf(prefs.cutInCm && metresRoll) }
    var askEnd by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    val length = Lengths.parse(lengthText, cm && metresRoll)
    val fits = length != null && length <= item.remaining + 1e-6
    val left = if (length != null) CutPlan.left(item.remaining, length) else null

    fun doCut(end: Repository.EndChoice) {
        val len = length ?: return
        busy = true
        scope.launch {
            try {
                val r = Graph.repo.cut(item.id, len, customer, invoice, end)
                Graph.printQueue.printLabels(
                    listOf(
                        LabelSpec.CustomerCut(
                            customer = r.customer, code = item.code, size = item.size, length = r.length, unit = item.unit,
                            invoice = r.invoice, at = r.at, ref = "${item.id.substringAfterLast('-')}-C${r.cutNo}",
                        )
                    ),
                    "cut for ${r.customer.ifBlank { item.code }}",
                )
                lengthText = ""
                val tail = when {
                    r.wasted > 0 -> ", ${Format.qtyUnit(r.wasted, item.unit)} written off"
                    r.roll.status == ItemStatus.IN_STOCK -> ", ${Format.qtyUnit(r.roll.remaining, item.unit)} left"
                    else -> ", roll used up"
                }
                snackbar.showSnackbar("Cut ${Format.qtyUnit(r.length, item.unit)} of ${item.code}$tail")
            } catch (e: Exception) {
                snackbar.showSnackbar(e.message ?: "Could not cut")
            } finally {
                busy = false
            }
        }
    }

    Panel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OpenBadge(item.isOpen)
            Column(Modifier.weight(1f)) {
                Text(
                    listOf(item.code, Format.size(item.size)).filter { it.isNotBlank() }.joinToString(" · "),
                    fontWeight = FontWeight.SemiBold,
                )
                Text(item.id, style = MonoStyle.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize))
            }
            Text(Format.qtyUnit(item.remaining, item.unit), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            LocationBadge(item.location)
            TextButton(onClick = onChangeRoll) { Text("Change roll") }
        }
    }

    CustomerField(customer, { customer = it })
    OutlinedTextField(
        invoice, { invoice = it }, label = { Text("Invoice no. (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            lengthText, { lengthText = it }, label = { Text("Length" + if (metresRoll) "" else " (${item.unit})") }, singleLine = true,
            modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        if (metresRoll) {
            FilterChip(selected = !cm, onClick = {
                if (cm) { length?.let { lengthText = Lengths.show(it, false) }; cm = false; prefs.cutInCm = false }
            }, label = { Text("m") })
            FilterChip(selected = cm, onClick = {
                if (!cm) { length?.let { lengthText = Lengths.show(it, true) }; cm = true; prefs.cutInCm = true }
            }, label = { Text("cm") })
        }
    }
    when {
        length == null -> {}
        !fits -> Notice("Only ${Format.qtyUnit(item.remaining, item.unit)} on this roll. Pick a bigger roll or cut less.", status.bad, status.badSoft)
        else -> Panel(container = MaterialTheme.colorScheme.primaryContainer, border = MaterialTheme.colorScheme.primaryContainer) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Left on this roll after the cut", modifier = Modifier.weight(1f))
                Text(Format.qtyUnit(left ?: 0.0, item.unit), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
    Button(
        onClick = {
            val len = length ?: return@Button
            if (CutPlan.leavesShortEnd(item.remaining, len, prefs.shortEndMetres.toDouble())) askEnd = true
            else doCut(Repository.EndChoice.KEEP)
        },
        enabled = fits && customer.isNotBlank() && !busy,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("✂ Cut & print customer label") }
    if (customer.isBlank() && length != null) {
        Text("Enter the customer to cut.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    OutlinedButton(
        onClick = { Graph.printQueue.printLabels(listOf(LabelSpec.Remainder(item)), "remainder ${item.id}") },
        enabled = item.isOpen,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Print remainder label (${Format.qtyUnit(item.remaining, item.unit)})") }

    if (askEnd && length != null) {
        val end = CutPlan.left(item.remaining, length)
        AlertDialog(
            onDismissRequest = { askEnd = false },
            title = { Text("Only ${Format.qtyUnit(end, item.unit)} would be left") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("That is below the short-end limit (${Format.qty(prefs.shortEndMetres.toDouble())} m in Settings). What should happen to the end?")
                    EndOption("Give the whole roll to this customer", "${Format.qtyUnit(item.remaining, item.unit)} on the label") {
                        askEnd = false; doCut(Repository.EndChoice.GIVE_ALL)
                    }
                    EndOption("Cut as asked, write off the end as waste", "Logged under Waste with your name") {
                        askEnd = false; doCut(Repository.EndChoice.WASTE)
                    }
                    EndOption("Cut as asked, keep the end in stock", "Stays as an open roll") {
                        askEnd = false; doCut(Repository.EndChoice.KEEP)
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { askEnd = false }) { Text("Back") } },
        )
    }
}

@Composable
private fun EndOption(title: String, detail: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(10.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
