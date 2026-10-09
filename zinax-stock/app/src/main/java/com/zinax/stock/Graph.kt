package com.zinax.stock

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.zinax.stock.core.Format
import com.zinax.stock.core.ItemRow
import com.zinax.stock.core.Report
import com.zinax.stock.core.StockSource
import com.zinax.stock.core.XlsxWriter
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
import kotlinx.coroutines.withContext
import java.io.File

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

    /** Writes the stock workbook to the app cache and returns it. */
    suspend fun stockReportFile(): File = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val items = db.dao().inStock().first()
        val lines = Report.stockLines(items.map { StockSource(it.categoryEnum, it.code, it.size, it.unit, it.remaining) })
        val rows = items.map {
            ItemRow(it.id, it.categoryEnum, it.code, it.size, it.remaining, it.qty, it.unit, it.pallet, it.location, it.receivedAt)
        }
        val dir = File(app.cacheDir, "reports").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val stamp = Format.dateTime(now).replace(" ", "_").replace(":", "")
        File(dir, "Zinax-Stock-$stamp.xlsx").apply {
            writeBytes(XlsxWriter.write(Report.stockWorkbook(lines, rows, now)))
        }
    }

    /** Sends the stock report as text or as an Excel file; Settings decides unless [excel] is given. */
    suspend fun shareStockReport(context: Context, excel: Boolean = prefs.reportAsExcel) {
        if (excel) {
            Share.file(context, stockReportFile(), XLSX_MIME, "Zinax stock ${Format.dateTime(System.currentTimeMillis())}")
        } else {
            Share.text(context, stockReportText())
        }
    }

    const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

/**
 * Sharing goes through Android's share sheet so every WhatsApp on the phone is offered:
 * WhatsApp, WhatsApp Business and a dual (second) WhatsApp.
 */
object Share {
    fun text(context: Context, text: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        start(context, send)
    }

    fun file(context: Context, file: File, mime: String, caption: String) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, caption)
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        start(context, send)
    }

    private fun start(context: Context, send: Intent) {
        val chooser = Intent.createChooser(send, "Send to").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (send.hasExtra(Intent.EXTRA_STREAM)) chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            context.startActivity(chooser)
        } catch (_: ActivityNotFoundException) {
        }
    }

    fun openUrl(context: Context, url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
