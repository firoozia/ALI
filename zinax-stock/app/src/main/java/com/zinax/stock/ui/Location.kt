package com.zinax.stock.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph

const val NO_LOCATION = "No location"

/** Locations from Settings followed by any other location already used on a package. */
@Composable
fun rememberLocations(): List<String> {
    val tick by Graph.prefs.changes.collectAsStateWithLifecycle()
    val used by Graph.db.dao().usedLocations().collectAsStateWithLifecycle(emptyList())
    val configured = remember(tick) { Graph.prefs.locations }
    return remember(configured, used) { (configured + used).distinct() }
}

/** One row of location buttons. Tapping the selected one clears it. */
@Composable
fun LocationPicker(selected: String, onSelect: (String) -> Unit, label: String = "Put away in") {
    val locations = rememberLocations()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(locations) { loc ->
                FilterChip(
                    selected = loc == selected,
                    onClick = { onSelect(if (loc == selected) "" else loc) },
                    label = { Text(loc) },
                )
            }
        }
        if (selected.isBlank()) {
            Text(
                "No location chosen. Add locations in Settings.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Pick a location from the list or type a new one. */
@Composable
fun MoveDialog(title: String, initial: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var location by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                LocationPicker(location, { location = it }, label = "Choose a place")
                OutlinedTextField(
                    value = location,
                    onValueChange = { location = it },
                    label = { Text("Or type a place, e.g. Warehouse 2 - Floor 1") },
                    singleLine = true,
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(location.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
