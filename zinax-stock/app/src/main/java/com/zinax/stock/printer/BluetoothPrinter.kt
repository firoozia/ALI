package com.zinax.stock.printer

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.UUID

data class PairedPrinter(val name: String, val address: String)

/** Sends raw TSPL to a paired Bluetooth Classic (SPP) printer such as the XP-420B. */
class BluetoothPrinter(private val context: Context) {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    fun hasPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private val adapter get() = context.getSystemService(BluetoothManager::class.java)?.adapter

    @SuppressLint("MissingPermission")
    fun paired(): List<PairedPrinter> {
        if (!hasPermission()) return emptyList()
        val a = adapter ?: return emptyList()
        if (!a.isEnabled) return emptyList()
        return a.bondedDevices.orEmpty()
            .map { PairedPrinter(it.name ?: it.address, it.address) }
            .sortedByDescending { it.name.contains("XP", ignoreCase = true) || it.name.contains("printer", ignoreCase = true) }
    }

    fun bluetoothOn(): Boolean = adapter?.isEnabled == true

    /**
     * Sends each job in order over one connection. [onSent] reports how many jobs have left the phone.
     * The printer does not confirm each label, so the caller asks the user afterwards.
     */
    @SuppressLint("MissingPermission")
    suspend fun send(address: String, jobs: List<ByteArray>, onSent: (Int) -> Unit) = withContext(Dispatchers.IO) {
        if (!hasPermission()) throw IOException("Allow Nearby devices (Bluetooth) for Zinax Stock in Android settings.")
        val a = adapter ?: throw IOException("This phone has no Bluetooth.")
        if (!a.isEnabled) throw IOException("Turn on Bluetooth and try again.")
        val device = a.getRemoteDevice(address)
        a.cancelDiscovery()
        val socket = connect(device)
        try {
            val out = socket.outputStream
            jobs.forEachIndexed { i, job ->
                var pos = 0
                while (pos < job.size) {
                    val n = minOf(4096, job.size - pos)
                    out.write(job, pos, n)
                    pos += n
                }
                out.flush()
                onSent(i + 1)
                // Give the printer time to print before the next label fills its buffer.
                delay(700)
            }
            delay(800)
        } finally {
            try { socket.close() } catch (_: IOException) {}
        }
    }

    @SuppressLint("MissingPermission")
    private fun connect(device: android.bluetooth.BluetoothDevice): BluetoothSocket {
        val first = try {
            device.createRfcommSocketToServiceRecord(spp).also { it.connect() }
        } catch (e: IOException) {
            null
        }
        if (first != null) return first
        // Some printers only accept the insecure channel.
        return try {
            device.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() }
        } catch (e: IOException) {
            throw IOException("Could not connect to the printer. Check it is on, paired and not used by another phone.")
        }
    }
}
