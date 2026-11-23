package com.aryak.hingelabels.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aryak.hingelabels.Graph
import com.aryak.hingelabels.label.Tspl

/** Label size presets, custom width and height, and a preview of the current label at that size. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LabelSizeSection() {
    val prefs = Graph.prefs
    var width by remember { mutableStateOf(prefs.labelWidthMm.toString()) }
    var height by remember { mutableStateOf(prefs.labelHeightMm.toString()) }
    val w = width.toIntOrNull()
    val h = height.toIntOrNull()
    val valid = w != null && h != null && w in Tspl.MIN_MM..Tspl.MAX_WIDTH_MM && h in Tspl.MIN_MM..Tspl.MAX_HEIGHT_MM

    fun choose(pw: Int, ph: Int) {
        width = pw.toString(); height = ph.toString()
        prefs.labelWidthMm = pw; prefs.labelHeightMm = ph
    }

    Text("Label size (mm)", style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Tspl.PRESETS.forEach { (pw, ph) ->
            FilterChip(selected = w == pw && h == ph, onClick = { choose(pw, ph) }, label = { Text("$pw × $ph") })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            width, { v -> width = v.filter { it.isDigit() }.take(3); width.toIntOrNull()?.takeIf { it in Tspl.MIN_MM..Tspl.MAX_WIDTH_MM }?.let { prefs.labelWidthMm = it } },
            label = { Text("Width") }, singleLine = true, modifier = Modifier.weight(1f),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = w == null || w !in Tspl.MIN_MM..Tspl.MAX_WIDTH_MM,
        )
        OutlinedTextField(
            height, { v -> height = v.filter { it.isDigit() }.take(3); height.toIntOrNull()?.takeIf { it in Tspl.MIN_MM..Tspl.MAX_HEIGHT_MM }?.let { prefs.labelHeightMm = it } },
            label = { Text("Height") }, singleLine = true, modifier = Modifier.weight(1f),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = h == null || h !in Tspl.MIN_MM..Tspl.MAX_HEIGHT_MM,
        )
    }
    when {
        !valid -> Text(
            "Width ${Tspl.MIN_MM}–${Tspl.MAX_WIDTH_MM} mm, height ${Tspl.MIN_MM}–${Tspl.MAX_HEIGHT_MM} mm.",
            style = MaterialTheme.typography.bodySmall, color = HingeColors.Bad,
        )
        w!! < 50 || h!! < 30 -> Text(
            "Small label: the text prints small.",
            style = MaterialTheme.typography.bodySmall, color = HingeColors.Warn,
        )
        else -> Text(
            "After changing the paper roll or the size, press Calibrate printer once.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (valid) {
        LabelPreview(prefs.last, prefs.tspl.copy(widthMm = w!!, heightMm = h!!))
    }
}
