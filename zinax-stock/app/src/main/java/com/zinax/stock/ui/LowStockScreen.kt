package com.zinax.stock.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zinax.stock.Graph
import com.zinax.stock.Share
import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.Report
import com.zinax.stock.data.LowStock
import com.zinax.stock.ui.theme.LocalStatus

/** Products at or under the minimum set in Products, with how much is missing; can be sent for ordering. */
@Composable
fun LowStockScreen(onBack: () -> Unit, onCatalog: () -> Unit) {
    val context = LocalContext.current
    val status = LocalStatus.current
    val dao = Graph.db.dao()
    val products by dao.products().collectAsStateWithLifecycle(emptyList())
    val items by dao.inStock().collectAsStateWithLifecycle(emptyList())
    val me by Graph.session.user.collectAsStateWithLifecycle()
    val low = remember(products, items) { LowStock.lines(products, items) }
    val withMin = products.count { !it.hidden && it.minQty > 0 }

    ScreenScaffold("Low stock", onBack) { padding ->
        FormBody(padding) {
            Text(
                "$withMin products have a minimum · ${low.size} at or under it",
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            )
            if (withMin == 0) {
                Notice(
                    "No minimums yet. Set Minimum stock on each product in Settings → Products & groups, or fill the MinQty column of the Products tab in the sheet.",
                    status.warn, status.warnSoft,
                )
            } else if (low.isEmpty()) {
                Pill("Everything is above its minimum", status.ok, status.okSoft)
            }
            if (low.isNotEmpty()) {
                Panel {
                    low.forEachIndexed { i, l ->
                        if (i > 0) HorizontalDivider()
                        val p = l.product
                        Column {
                            CodeRow(
                                code = p.code,
                                title = "${Format.qtyUnit(l.have, p.unit)} of min ${Format.qtyUnit(p.minQty, p.unit)}",
                                subtitle = listOf(Category.fromName(p.groupId).label, Format.size(p.size), p.note)
                                    .filter { it.isNotBlank() }.joinToString(" · "),
                                codeColor = if (l.empty) status.bad else status.warn,
                            )
                            Text(
                                (if (l.empty) "Out of stock" else "${l.packages} ${Report.plural(Category.fromName(p.groupId).pack, l.packages)} left") +
                                    " · short ${Format.qtyUnit(l.short, p.unit)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (l.empty) status.bad else status.warn,
                            )
                        }
                    }
                }
                Button(onClick = {
                    val text = "*Zinax low stock* · ${Format.dateTime(System.currentTimeMillis())}\n\n" + low.joinToString("\n") { l ->
                        val p = l.product
                        "${p.code} ${Format.size(p.size)}".trim() + " · ${Format.qtyUnit(l.have, p.unit)} of min ${Format.qtyUnit(p.minQty, p.unit)}" +
                            " · short ${Format.qtyUnit(l.short, p.unit)}"
                    }
                    Share.text(context, text)
                }, modifier = Modifier.fillMaxWidth()) { Text("Send the list") }
            }
            if (me?.isAdmin == true) {
                OutlinedButton(onClick = onCatalog, modifier = Modifier.fillMaxWidth()) { Text("Set minimums in Products") }
            }
        }
    }
}
