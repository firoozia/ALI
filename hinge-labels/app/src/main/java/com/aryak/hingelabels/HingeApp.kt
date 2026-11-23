package com.aryak.hingelabels

import android.app.Application
import com.aryak.hingelabels.data.Prefs
import com.aryak.hingelabels.printer.BluetoothPrinter
import com.aryak.hingelabels.printer.PrintQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** The app's single instances. */
object Graph {
    lateinit var prefs: Prefs
        private set
    lateinit var printer: BluetoothPrinter
        private set
    lateinit var printQueue: PrintQueue
        private set

    fun init(app: Application) {
        prefs = Prefs(app)
        printer = BluetoothPrinter(app)
        printQueue = PrintQueue(printer, prefs, CoroutineScope(SupervisorJob() + Dispatchers.Main))
    }
}

class HingeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
    }
}
