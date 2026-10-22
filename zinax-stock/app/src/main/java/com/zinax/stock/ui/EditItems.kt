package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.zinax.stock.core.Category
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemEdit

/**
 * Correct category, code, size or unit of [items] (one label, or all labels of a code).
 * [onSave] gets only the fields that were changed.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditItemsDialog(items: List<Item>, onSave: (ItemEdit) -> Unit, onDismiss: () -> Unit, onJoint: (() -> Unit)? = null) {
    val first = items.first()
    var category by remember { mutableStateOf(first.category) }
    var code by remember { mutableStateOf(first.code) }
    var size by remember { mutableStateOf(first.size) }
    var unit by remember { mutableStateOf(first.unit) }
    val edit = ItemEdit(
        category.takeIf { it != first.category },
        code.trim().takeIf { it != first.code },
        size.trim().takeIf { it != first.size },
        unit.trim().takeIf { it != first.unit },
    )
    val changed = edit.against(first) != null
    val valid = code.isNotBlank() && unit.isNotBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (items.size == 1) "Edit ${first.id}" else "Edit ${items.size} labels of ${first.code}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onJoint != null) {
                    androidx.compose.material3.OutlinedButton(onClick = onJoint, modifier = Modifier.fillMaxWidth()) {
                        Text("Joint · split this roll in two")
                    }
                }
                Text("Category", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Category.entries.forEach { c ->
                        FilterChip(selected = category == c.name, onClick = { category = c.name }, label = { Text(c.label) })
                    }
                }
                OutlinedTextField(
                    code, { code = it }, label = { Text("Code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(size, { size = it }, label = { Text("Size") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(unit, { unit = it }, label = { Text("Unit") }, singleLine = true, modifier = Modifier.weight(0.6f))
                }
                if (edit.changesLabel && changed) {
                    Text(
                        "Code, size and unit are printed on the label. After saving you can print new labels.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    "Quantities and history stay as they are. The change is logged under Reports → Edited with your name.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(edit) }, enabled = changed && valid) { Text("Next") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
