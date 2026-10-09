package com.zinax.stock

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.zinax.stock.core.Report
import com.zinax.stock.core.StockSource
import com.zinax.stock.data.AppDatabase
import com.zinax.stock.data.Prefs
import com.zinax.stock.data.Repository
import com.zinax.stock.printer.BluetoothPrinter
import com.zinax.stock.printer.PrintQueue
import com.zinax.stock.sync.ReportWorker
import com.zinax.stock.sync.SheetsSync
import com.zinax.stock.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first

/** App-wide singletons. */
object Graph {
    lateinit var app: Application
    lateinit var prefs: Prefs
    lateinit var db: AppDatabase
    lateinit var repo: Repository
    lateinit var printer: BluetoothPrinter
    lateinit var printQueue: PrintQueue
    lateinit var sync: SheetsSync
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun init(app: Application) {
        this.app = app
        prefs = Prefs(app)
        db = AppDatabase.create(app)
        repo = Repository(db, prefs) { SyncWorker.soon(app) }
        printer = BluetoothPrinter(app)
        printQueue = PrintQueue(printer, prefs, scope)
        sync = SheetsSync(db, prefs)
    }

    suspend fun stockReportText(): String {
        val items = db.dao().inStock().first()
        val lines = Report.stockLines(items.map { StockSource(it.categoryEnum, it.code, it.size, it.unit, it.remaining) })
        return Report.stockText(lines, System.currentTimeMillis())
    }
}

class ZinaxApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
        ReportWorker.createChannel(this)
        SyncWorker.schedulePeriodic(this)
        ReportWorker.schedule(this)
    }
}

object Share {
    /** Opens WhatsApp (or WhatsApp Business) with [text]; the user picks the group. */
    fun toWhatsApp(context: Context, text: String) {
        val base = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            try {
                context.startActivity(Intent(base).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: ActivityNotFoundException) {
            }
        }
        context.startActivity(Intent.createChooser(base, "Send report").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun openUrl(context: Context, url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
