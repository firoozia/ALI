package com.aryak.hingelabels.printer

import com.aryak.hingelabels.data.Prefs
import com.aryak.hingelabels.label.HingeLabel
import com.aryak.hingelabels.label.LabelRenderer
import com.aryak.hingelabels.label.Tspl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface PrintState {
    data object Idle : PrintState
    data class Running(val sent: Int, val total: Int) : PrintState
    /** All labels left the phone. The user confirms whether every label came out. */
    data class Done(val total: Int) : PrintState
    data class Failed(val sent: Int, val total: Int, val message: String) : PrintState
}

/** One print run at a time, shown by the print dialog. */
class PrintQueue(
    private val printer: BluetoothPrinter,
    private val prefs: Prefs,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<PrintState>(PrintState.Idle)
    val state: StateFlow<PrintState> = _state
    private var job: Job? = null
    private var last: HingeLabel? = null

    /** Prints [copies] of [label]. */
    fun print(label: HingeLabel, copies: Int) {
        if (copies < 1) return
        if (_state.value is PrintState.Running) return
        last = label
        val address = prefs.printerAddress
        if (address == null) {
            _state.value = PrintState.Failed(0, copies, "No printer selected. Pick the XP-420B in Settings.")
            return
        }
        _state.value = PrintState.Running(0, copies)
        job = scope.launch {
            var sent = 0
            try {
                val setup = prefs.tspl
                val batches = Tspl.batches(copies)
                val jobs = withContext(Dispatchers.Default) { LabelRenderer.tsplJobs(label, setup, batches) }
                printer.send(address, jobs) { n ->
                    sent = batches.take(n).sum()
                    _state.value = PrintState.Running(sent, copies)
                }
                _state.value = PrintState.Done(copies)
            } catch (e: CancellationException) {
                _state.value = PrintState.Failed(sent, copies, "Printing cancelled.")
            } catch (e: Exception) {
                _state.value = PrintState.Failed(sent, copies, e.message ?: "Printing failed.")
            }
        }
    }

    /** Stops the running print: a printer still being looked for is given up at once. */
    fun cancel() {
        if (_state.value is PrintState.Running) job?.cancel()
    }

    /** Prints the last run again from label [fromNumber] (1-based) to its end. */
    fun reprintFrom(fromNumber: Int) {
        val total = when (val s = _state.value) {
            is PrintState.Done -> s.total
            is PrintState.Failed -> s.total
            else -> return
        }
        val label = last ?: return
        _state.value = PrintState.Idle
        print(label, total - fromNumber.coerceIn(1, total) + 1)
    }

    /**
     * Sends the calibration command. The printer feeds a few labels while it measures, then stops at the
     * start of a label. Returns a message for the person.
     */
    suspend fun calibrate(): String {
        if (_state.value is PrintState.Running) return "Wait until printing has finished."
        val address = prefs.printerAddress ?: return "No printer selected. Pick the XP-420B first."
        return try {
            printer.send(address, listOf(Tspl.calibrateJob(prefs.tspl))) {}
            "Calibrating: the printer feeds a few labels and stops at the start of one. Then print a test label."
        } catch (e: Exception) {
            e.message ?: "Could not reach the printer."
        }
    }

    fun dismiss() {
        if (_state.value !is PrintState.Running) _state.value = PrintState.Idle
    }
}
