package com.aryak.hingelabels.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.aryak.hingelabels.data.Lists

/** Add, rename, delete and reorder the entries of one choice list. The last entry cannot be deleted. */
@Composable
fun ListEditor(title: String, items: List<String>, onChange: (List<String>) -> Unit) {
    var adding by remember { mutableStateOf("") }
    var renaming by remember { mutableStateOf<Int?>(null) }
    var renameText by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<Int?>(null) }

    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            items.forEachIndexed { i, item ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(item, modifier = Modifier.weight(1f))
                    IconButton(onClick = { onChange(Lists.move(items, i, -1)) }, enabled = i > 0) {
                        Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "Move up")
                    }
                    IconButton(onClick = { onChange(Lists.move(items, i, 1)) }, enabled = i < items.lastIndex) {
                        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Move down")
                    }
                    IconButton(onClick = { renameText = item; renaming = i }) {
                        Icon(Icons.Filled.Edit, contentDescription = "Rename")
                    }
                    IconButton(onClick = { deleting = i }, enabled = items.size > 1) {
                        Icon(Icons.Filled.Delete, contentDescription = "Delete")
                    }
                }
                if (i < items.lastIndex) HorizontalDivider()
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = adding,
                    onValueChange = { adding = it.replace("\n", "") },
                    placeholder = { Text("Add new") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                    modifier = Modifier.weight(1f),
                )
                val clean = Lists.clean(adding)
                IconButton(onClick = { onChange(Lists.add(items, adding)); adding = "" }, enabled = clean.isNotEmpty() && clean !in items) {
                    Icon(Icons.Filled.Add, contentDescription = "Add")
                }
            }
        }
    }

    renaming?.let { i ->
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Rename") },
            text = {
                OutlinedTextField(
                    renameText, { renameText = it.replace("\n", "") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                )
            },
            confirmButton = {
                TextButton(onClick = { onChange(Lists.rename(items, i, renameText)); renaming = null }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } },
        )
    }
    deleting?.let { i ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete ${items.getOrNull(i) ?: ""}?") },
            confirmButton = {
                TextButton(onClick = { onChange(Lists.remove(items, i)); deleting = null }) { Text("Delete", color = HingeColors.Bad) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}
