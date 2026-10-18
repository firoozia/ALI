package com.zinax.stock.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.zinax.stock.Graph
import com.zinax.stock.MainActivity
import com.zinax.stock.R
import com.zinax.stock.core.Format
import com.zinax.stock.data.LowStock
import com.zinax.stock.ui.UiLang
import kotlinx.coroutines.flow.first

/**
 * Tells admins' phones when a product falls to or under its minimum. Each product is told once;
 * it is told again only after its stock went back above the minimum and fell again.
 */
object LowStockNotifier {
    const val CHANNEL = "lowstock"
    const val EXTRA_OPEN_LOW = "zinax_open_low"
    private const val ID = 3000

    fun createChannel(context: Context) {
        val ch = NotificationChannel(CHANNEL, "Low stock", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Products at or under the minimum stock set in Products"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    suspend fun check(context: Context) {
        val prefs = Graph.prefs
        val dao = Graph.db.dao()
        val low = LowStock.lines(dao.allProducts(), dao.inStock().first())
        val now = low.map { it.product.id }.toSet()
        val fresh = low.filter { it.product.id !in prefs.lowNotified }
        prefs.lowNotified = now
        if (fresh.isEmpty() || !prefs.phoneUserIsAdmin) return
        val allowed = Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!allowed) return
        val text = fresh.joinToString("\n") {
            "${it.product.code} ${Format.size(it.product.size)}".trim() + " · " +
                UiLang.tr("{} of min {}").let { t -> t.replaceFirst("{}", Format.qtyUnit(it.have, it.product.unit)).replaceFirst("{}", Format.qtyUnit(it.product.minQty, it.product.unit)) }
        }
        val open = PendingIntent.getActivity(
            context, ID,
            Intent(context, MainActivity::class.java).putExtra(EXTRA_OPEN_LOW, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(UiLang.tr("Low stock: {}").replace("{}", low.size.toString()))
            .setContentText(text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(ID, n)
    }
}
