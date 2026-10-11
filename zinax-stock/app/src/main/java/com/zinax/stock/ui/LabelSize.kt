package com.zinax.stock.ui

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.zinax.stock.Graph
import com.zinax.stock.core.Category
import com.zinax.stock.core.LabelId
import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.label.LabelRenderer
import com.zinax.stock.label.Tspl
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.ui.theme.LocalStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A made-up roll for previews and the test label. */
fun sampleItem(): Item {
    val t = System.currentTimeMillis()
    return Item(
        id = LabelId.make(LabelId.datePart(t), Graph.prefs.deviceCode, 7), category = Category.PVC.name, code = "101",
        size = "0.30*1400", unit = "m", qty = 120.0, remaining = 120.0, status = ItemStatus.IN_STOCK, shipmentId = null,
        pallet = null, netKg = null, grossKg = null, receivedAt = t, location = "", device = Graph.prefs.deviceCode, updatedAt = t,
    )
}

/** Label size presets, custom width and height, and a preview of the roll and customer labels. */
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
    val status = LocalStatus.current
    when {
        !valid -> Text(
            "Width ${Tspl.MIN_MM}–${Tspl.MAX_WIDTH_MM} mm, height ${Tspl.MIN_MM}–${Tspl.MAX_HEIGHT_MM} mm.",
            style = MaterialTheme.typography.bodySmall, color = status.bad,
        )
        w!! < 50 || h!! < 30 -> Text(
            "Small label: text and QR print small, and long customer names may be hard to read.",
            style = MaterialTheme.typography.bodySmall, color = status.warn,
        )
        else -> Text(
            "After changing the paper roll, calibrate the printer once: hold FEED until one label comes out.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (valid) {
        val setup = prefs.tspl.copy(widthMm = w!!, heightMm = h!!)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LabelPreview(LabelSpec.Roll(sampleItem()), setup, Modifier.weight(1f))
            LabelPreview(
                LabelSpec.CustomerCut("Bahar Design", "101", "0.30*1400", 20.0, "m", "F-12", System.currentTimeMillis(), "A0007-C1"),
                setup, Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun LabelPreview(spec: LabelSpec, setup: Tspl.Setup, modifier: Modifier) {
    var bmp by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(setup.widthMm, setup.heightMm) {
        bmp = withContext(Dispatchers.Default) { LabelRenderer.bitmap(spec, setup) }
    }
    Column(modifier) {
        Surface(
            color = Color.White,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            modifier = Modifier.fillMaxWidth().aspectRatio(setup.widthMm / setup.heightMm.toFloat()),
        ) {
            bmp?.let {
                Image(it.asImageBitmap(), contentDescription = "Label preview", contentScale = ContentScale.Fit, filterQuality = FilterQuality.Medium)
            }
        }
    }
}
