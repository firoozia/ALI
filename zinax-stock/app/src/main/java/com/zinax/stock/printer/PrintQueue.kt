package com.zinax.stock.printer

import com.zinax.stock.data.Item
import com.zinax.stock.data.Prefs
import com.zinax.stock.label.LabelRenderer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface PrintState {
    data object Idle : PrintState
    data class Running(val title: String, val sent: Int, val total: Int) : PrintState
    /** All jobs left the phone. The user confirms whether every label came out. */
    data class Done(val title: String, val items: List<Item>) : PrintState
    data class Failed(val title: String, val items: List<Item>, val sent: Int, val message: String) : PrintState
}

/** One print run at a time, shown by the dialog in MainActivity. */
class PrintQueue(
    private val printer: BluetoothPrinter,
    private val prefs: Prefs,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<PrintState>(PrintState.Idle)
    val state: StateFlow<PrintState> = _state
    private var job: Job? = null

    fun print(items: List<Item>, title: String) {
        if (items.isEmpty()) return
        if (_state.value is PrintState.Running) return
        val address = prefs.printerAddress
        if (address == null) {
            _state.value = PrintState.Failed(title, items, 0, "No printer selected. Pick the XP-420B in Settings.")
            return
        }
        _state.value = PrintState.Running(title, 0, items.size)
        job = scope.launch {
            var sent = 0
            try {
                val setup = prefs.tspl
                val jobs = withContext(Dispatchers.Default) { items.map { LabelRenderer.tsplJob(it, setup) } }
                printer.send(address, jobs) { n ->
                    sent = n
                    _state.value = PrintState.Running(title, n, items.size)
                }
                _state.value = PrintState.Done(title, items)
            } catch (e: Exception) {
                _state.value = PrintState.Failed(title, items, sent, e.message ?: "Printing failed.")
            }
        }
    }

    /** Reprint starting at label [fromNumber] (1-based) of the last run. */
    fun reprintFrom(fromNumber: Int) {
        val s = _state.value
        val (title, items) = when (s) {
            is PrintState.Done -> s.title to s.items
            is PrintState.Failed -> s.title to s.items
            else -> return
        }
        _state.value = PrintState.Idle
        print(items.drop((fromNumber - 1).coerceIn(0, items.size - 1)), title)
    }

    fun dismiss() {
        if (_state.value !is PrintState.Running) _state.value = PrintState.Idle
    }
}
