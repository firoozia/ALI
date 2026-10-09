package com.zinax.stock.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.zinax.stock.Graph
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.importer.CsvReader
import com.zinax.stock.importer.PackingListParser
import com.zinax.stock.importer.ParseResult
import com.zinax.stock.importer.XlsxReader
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ImportScreen(onBack: () -> Unit, onSaved: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val status = LocalStatus.current
    var name by remember { mutableStateOf("CN-" + LabelId.datePart(System.currentTimeMillis())) }
    var category by remember { mutableStateOf(Category.PVC) }
    var uri by remember { mutableStateOf<Uri?>(null) }
    var fileName by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<ParseResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun parse(u: Uri, cat: Category) {
        busy = true
        error = null
        scope.launch {
            try {
                result = withContext(Dispatchers.IO) {
                    val lower = fileName.lowercase()
                    context.contentResolver.openInputStream(u)!!.use { input ->
                        if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
                            PackingListParser.parse(CsvReader.read(input.bufferedReader().readText()), cat)
                        } else {
                            val sheets = XlsxReader.read(input)
                            sheets.asSequence().map { PackingListParser.parse(it.rows, cat) }
                                .firstOrNull { it.units.isNotEmpty() }
                                ?: PackingListParser.parse(sheets.firstOrNull()?.rows.orEmpty(), cat)
                        }
                    }
                }
            } catch (e: Exception) {
                result = null
                error = "Could not read the file: ${e.message ?: e.javaClass.simpleName}. Use .xlsx or .csv."
            } finally {
                busy = false
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked != null) {
            uri = picked
            fileName = context.contentResolver.query(picked, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            } ?: picked.lastPathSegment.orEmpty()
            parse(picked, category)
        }
    }

    ScreenScaffold("Import list", onBack) { padding ->
        FormBody(padding) {
            OutlinedTextField(name, { name = it }, label = { Text("Shipment name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Product family for files without a Category column", style = MaterialTheme.typography.bodySmall)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(Category.entries) { c ->
                    FilterChip(selected = c == category, onClick = {
                        category = c
                        uri?.let { parse(it, c) }
                    }, label = { Text(c.label) })
                }
            }
            OutlinedButton(onClick = {
                picker.launch(arrayOf(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "text/csv", "text/comma-separated-values", "text/plain", "application/octet-stream",
                ))
            }, modifier = Modifier.fillMaxWidth()) {
                Text(if (fileName.isEmpty()) "Choose Excel or CSV file" else fileName)
            }
            if (busy) Text("Reading…")
            error?.let { Notice(it, status.bad, status.badSoft) }

            result?.let { r ->
                Panel {
                    Text("Read from file (${r.format})", style = MaterialTheme.typography.labelMedium)
                    KeyValue("Pallets", r.pallets.size.toString())
                    KeyValue("Labels to print", r.units.size.toString())
                    KeyValue("Item codes", r.codes.size.toString())
                    r.totalsByUnit.forEach { (u, q) -> KeyValue("Total", Format.qtyUnit(q, u)) }
                    if (r.sizes.isNotEmpty()) KeyValue("Sizes", r.sizes.joinToString(" · ") { Format.size(it) })
                }
                r.warnings.forEach { Notice(it, status.warn, status.warnSoft) }
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            val id = Graph.repo.importShipment(name.ifBlank { fileName }, fileName, r.units)
                            busy = false
                            onSaved(id)
                        }
                    },
                    enabled = r.units.isNotEmpty() && !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Save shipment") }
            }

            Text(
                "Supplier packing lists are read as they come. For other goods use a table with the columns " +
                    "Pallet, Category, Code, Size, Qty, Unit, Packs. Each row prints Packs labels holding Qty each.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
