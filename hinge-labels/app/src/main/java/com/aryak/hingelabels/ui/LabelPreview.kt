package com.aryak.hingelabels.ui

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.unit.dp
import com.aryak.hingelabels.label.HingeLabel
import com.aryak.hingelabels.label.LabelRenderer
import com.aryak.hingelabels.label.Tspl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The label exactly as it prints, with a thin border that shows the label's edge (not printed). */
@Composable
fun LabelPreview(label: HingeLabel, setup: Tspl.Setup, modifier: Modifier = Modifier) {
    var bmp by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(label, setup.widthMm, setup.heightMm) {
        bmp = withContext(Dispatchers.Default) { LabelRenderer.render(label, setup) }
    }
    Surface(
        color = Color.White,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = modifier.fillMaxWidth().aspectRatio(setup.widthMm / setup.heightMm.toFloat()),
    ) {
        bmp?.let {
            Image(it.asImageBitmap(), contentDescription = "Label preview", contentScale = ContentScale.Fit, filterQuality = FilterQuality.Medium)
        }
    }
}
