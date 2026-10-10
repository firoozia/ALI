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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.core.CustomerNames
import com.zinax.stock.core.Format
import com.zinax.stock.data.Customer
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.launch

/** Names in the shared customer library, one per customer even if two phones added the same name. */
@Composable
fun rememberCustomerNames(): List<String> {
    val customers by Graph.db.dao().customers().collectAsStateWithLifecycle(emptyList())
    return remember(customers) { customers.distinctBy { CustomerNames.key(it.name) }.map { it.name } }
}

/** Customer name with suggestions from the library; a new name is added when the cut or ship-out is saved. */
@Composable
fun CustomerField(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val names = rememberCustomerNames()
    var picked by remember { mutableStateOf(false) }
    val suggestions = remember(names, value, picked) { if (picked) emptyList() else CustomerNames.suggest(names, value) }
    val known = remember(names, value) { names.any { CustomerNames.key(it) == CustomerNames.key(value) } }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it); picked = false },
            label = { Text("Customer") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
            supportingText = {
                if (value.isNotBlank() && !known) Text("New customer, added to the library when saved")
            },
        )
        if (suggestions.isNotEmpty()) {
            Panel {
                suggestions.forEach { name ->
                    Text(
                        name,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().clickable { onChange(name); picked = true }.padding(vertical = 6.dp),
                    )
                }
            }
        }
    }
}

/** Add, rename and remove customers. The list is shared with the other phones and the Customers tab of the sheet. */
@Composable
fun CustomersScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val customers by Graph.db.dao().customers().collectAsStateWithLifecycle(emptyList())
    var query by remember { mutableStateOf("") }
    var newName by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf<Customer?>(null) }
    var removing by remember { mutableStateOf<Customer?>(null) }
    val shown = remember(customers, query) {
        val k = CustomerNames.key(query)
        if (k.isEmpty()) customers else customers.filter { CustomerNames.key(it.name).contains(k) }
    }

    ScreenScaffold("Customers", onBack) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        newName, { newName = it }, label = { Text("New customer") }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    )
                    Button(onClick = {
                        val name = newName
                        newName = ""
                        scope.launch { Graph.repo.addCustomer(name) }
                    }, enabled = newName.isNotBlank()) { Text("Add") }
                }
            }
            item {
                OutlinedTextField(query, { query = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            item {
                Text(
                    "${customers.size} customers · shared with other phones and the Customers tab of the sheet",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(shown, key = { it.id }) { c ->
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(c.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "Added ${Format.date(c.createdAt)}" + if (c.createdBy.isNotBlank()) " by ${c.createdBy}" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { renaming = c }) { Text("Rename") }
                        TextButton(onClick = { removing = c }) { Text("Remove", color = LocalStatus.current.bad) }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

    renaming?.let { c ->
        var name by remember(c.id) { mutableStateOf(c.name) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Rename customer") },
            text = { OutlinedTextField(name, { name = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    renaming = null
                    scope.launch { Graph.repo.renameCustomer(c.id, name) }
                }, enabled = name.isNotBlank()) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } },
        )
    }

    removing?.let { c ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Remove ${c.name}?") },
            text = { Text("The name stops being suggested. Past cuts and reports keep it. Typing it again on a cut adds it back.") },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    scope.launch { Graph.repo.hideCustomer(c.id) }
                }) { Text("Remove", color = LocalStatus.current.bad) }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }
}
