package com.zinax.stock.sync

import androidx.room.withTransaction
import com.zinax.stock.core.Format
import com.zinax.stock.data.AppDatabase
import com.zinax.stock.data.ExpectedUnit
import com.zinax.stock.data.Item
import com.zinax.stock.data.Movement
import com.zinax.stock.data.Prefs
import com.zinax.stock.data.Shipment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Two-way sync with the Google Apps Script web app bound to the stock sheet.
 * Push: every row changed on this phone. Pull: every row the sheet changed since the last sync.
 * The newer updatedAt wins on both sides.
 */
class SheetsSync(private val db: AppDatabase, private val prefs: Prefs) {
    private val dao = db.dao()
    private val lock = Mutex()

    suspend fun sync(): String = lock.withLock {
        if (!prefs.syncConfigured) return "Add the web app URL and token in Settings to sync."
        try {
            val shipments = dao.dirtyShipments()
            val expected = dao.dirtyExpected()
            val items = dao.dirtyItems()
            val movements = dao.dirtyMovements()
            val pushedAt = System.currentTimeMillis()

            val body = JSONObject()
                .put("action", "sync")
                .put("token", prefs.token)
                .put("device", prefs.deviceCode)
                .put("since", prefs.lastServerSync)
                .put("shipments", JSONArray(shipments.map { it.toJson() }))
                .put("expected", JSONArray(expected.map { it.toJson() }))
                .put("items", JSONArray(items.map { it.toJson() }))
                .put("movements", JSONArray(movements.map { it.toJson() }))

            val response = JSONObject(post(prefs.webAppUrl, body.toString()))
            if (!response.optBoolean("ok")) throw IOException(response.optString("error", "The sheet refused the sync."))

            db.withTransaction {
                shipments.map { it.id }.chunked(500).forEach { dao.cleanShipments(it, pushedAt) }
                expected.map { it.id }.chunked(500).forEach { dao.cleanExpected(it, pushedAt) }
                items.map { it.id }.chunked(500).forEach { dao.cleanItems(it, pushedAt) }
                movements.map { it.id }.chunked(500).forEach { dao.cleanMovements(it) }
                mergeShipments(response.optJSONArray("shipments"))
                mergeExpected(response.optJSONArray("expected"))
                mergeItems(response.optJSONArray("items"))
            }
            prefs.lastServerSync = response.optLong("now", prefs.lastServerSync)
            response.optString("sheetUrl").takeIf { it.startsWith("https://") }?.let { prefs.sheetUrl = it }
            val pushed = shipments.size + expected.size + items.size + movements.size
            val msg = "Synced ${Format.dateTime(System.currentTimeMillis())} · sent $pushed change(s)"
            prefs.lastSyncMessage = msg
            msg
        } catch (e: Exception) {
            val msg = "Sync failed ${Format.dateTime(System.currentTimeMillis())}: ${e.message ?: e.javaClass.simpleName}"
            prefs.lastSyncMessage = msg
            throw IOException(msg, e)
        }
    }

    // ---------- merge ----------

    private suspend fun mergeShipments(arr: JSONArray?) {
        if (arr == null) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Shipment(it.getString("id"), it.optString("name"), it.optString("source"), it.optLong("createdAt"), it.optLong("updatedAt"), dirty = false)
        }.filter { remote -> dao.shipment(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putShipments(rows)
    }

    private suspend fun mergeExpected(arr: JSONArray?) {
        if (arr == null) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            ExpectedUnit(
                id = it.getString("id"), shipmentId = it.optString("shipmentId"), pallet = it.optString("pallet"),
                lineNo = it.optInt("lineNo"), category = it.optString("category"), code = it.optString("code"),
                size = it.optString("size"), qty = it.optDouble("qty", 0.0), unit = it.optString("unit"),
                netKg = it.optNullableDouble("netKg"), grossKg = it.optNullableDouble("grossKg"),
                itemId = it.optString("itemId").ifEmpty { null }, updatedAt = it.optLong("updatedAt"), dirty = false,
            )
        }.filter { remote -> dao.expectedById(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putExpected(rows)
    }

    private suspend fun mergeItems(arr: JSONArray?) {
        if (arr == null) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Item(
                id = it.getString("id"), category = it.optString("category"), code = it.optString("code"),
                size = it.optString("size"), unit = it.optString("unit"), qty = it.optDouble("qty", 0.0),
                remaining = it.optDouble("remaining", 0.0), status = it.optString("status"),
                shipmentId = it.optString("shipmentId").ifEmpty { null }, pallet = it.optString("pallet").ifEmpty { null },
                netKg = it.optNullableDouble("netKg"), grossKg = it.optNullableDouble("grossKg"),
                receivedAt = it.optLong("receivedAt"), location = it.optString("location"),
                device = it.optString("device"), updatedAt = it.optLong("updatedAt"), dirty = false,
            )
        }.filter { remote -> dao.item(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putItems(rows)
    }

    // ---------- JSON ----------

    private fun JSONObject.optNullableDouble(key: String): Double? =
        if (!has(key) || isNull(key) || optString(key).isEmpty()) null else optDouble(key).takeIf { !it.isNaN() }

    private fun Shipment.toJson() = JSONObject()
        .put("id", id).put("name", name).put("source", source).put("createdAt", createdAt).put("updatedAt", updatedAt)

    private fun ExpectedUnit.toJson() = JSONObject()
        .put("id", id).put("shipmentId", shipmentId).put("pallet", pallet).put("lineNo", lineNo)
        .put("category", category).put("code", code).put("size", size).put("qty", qty).put("unit", unit)
        .put("netKg", netKg ?: JSONObject.NULL).put("grossKg", grossKg ?: JSONObject.NULL)
        .put("itemId", itemId ?: "").put("updatedAt", updatedAt)

    private fun Item.toJson() = JSONObject()
        .put("id", id).put("category", category).put("code", code).put("size", size).put("unit", unit)
        .put("qty", qty).put("remaining", remaining).put("status", status)
        .put("shipmentId", shipmentId ?: "").put("pallet", pallet ?: "")
        .put("netKg", netKg ?: JSONObject.NULL).put("grossKg", grossKg ?: JSONObject.NULL)
        .put("receivedAt", receivedAt).put("location", location).put("device", device).put("updatedAt", updatedAt)

    private fun Movement.toJson() = JSONObject()
        .put("id", id).put("itemId", itemId).put("type", type).put("qty", qty).put("reference", reference)
        .put("at", at).put("device", device).put("code", code).put("size", size).put("unit", unit)

    // ---------- HTTP ----------

    /** Apps Script answers a POST with a redirect to the result, which must be fetched with GET. */
    private suspend fun post(url: String, body: String): String = withContext(Dispatchers.IO) {
        var conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            instanceFollowRedirects = false
            connectTimeout = 20_000
            readTimeout = 90_000
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        var code = conn.responseCode
        var hops = 0
        while (code in 300..399 && hops < 5) {
            val location = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = (URL(location).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 90_000
            }
            code = conn.responseCode
            hops++
        }
        if (code !in 200..299) {
            val err = conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(200).orEmpty()
            conn.disconnect()
            throw IOException("HTTP $code $err".trim())
        }
        val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        conn.disconnect()
        if (!text.trimStart().startsWith("{")) throw IOException("The web app did not return data. Check the URL and that it is deployed for \"Anyone\".")
        text
    }
}
