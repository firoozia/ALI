package com.zinax.stock.sync

import androidx.room.withTransaction
import com.zinax.stock.core.Format
import com.zinax.stock.data.AppDatabase
import com.zinax.stock.data.AppUser
import com.zinax.stock.data.ChangeRequest
import com.zinax.stock.data.StockCount
import com.zinax.stock.data.Customer
import com.zinax.stock.data.GroupRow
import com.zinax.stock.data.Product
import com.zinax.stock.data.RequestStatus
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
class SheetsSync(
    private val db: AppDatabase,
    private val prefs: Prefs,
    /** Runs after each successful sync: notifications, and checking the signed-in user. */
    private val afterSync: suspend () -> Unit = {},
) {
    private val dao = db.dao()
    private val lock = Mutex()

    suspend fun sync(): String = lock.withLock {
        if (!prefs.syncConfigured) return "Add the web app URL and token in Settings to sync."
        try {
            val shipments = dao.dirtyShipments()
            val expected = dao.dirtyExpected()
            val items = dao.dirtyItems()
            val movements = dao.dirtyMovements()
            val customers = dao.dirtyCustomers()
            val users = dao.dirtyUsers()
            val requests = dao.dirtyRequests()
            val groups = dao.dirtyGroups()
            val products = dao.dirtyProducts()
            val counts = dao.dirtyCounts()
            val pushedAt = System.currentTimeMillis()

            val body = JSONObject()
                .put("action", "sync")
                .put("token", prefs.token)
                .put("device", prefs.deviceCode)
                .put("user", prefs.userName)
                .put("appVersion", prefs.appVersion)
                .put("since", prefs.lastServerSync)
                .put("movementsSince", if (prefs.movementsBackfilled) prefs.lastServerSync else 0L)
                .put("shipments", JSONArray(shipments.map { it.toJson() }))
                .put("expected", JSONArray(expected.map { it.toJson() }))
                .put("items", JSONArray(items.map { it.toJson() }))
                .put("movements", JSONArray(movements.map { it.toJson() }))
                .put("customers", JSONArray(customers.map { it.toJson() }))
                .put("users", JSONArray(users.map { it.toJson() }))
                .put("requests", JSONArray(requests.map { it.toJson() }))
                .put("groups", JSONArray(groups.map { it.toJson() }))
                .put("products", JSONArray(products.map { it.toJson() }))
                .put("counts", JSONArray(counts.map { it.toJson() }))

            val response = JSONObject(post(prefs.webAppUrl, body.toString()))
            if (!response.optBoolean("ok")) throw IOException(response.optString("error", "The sheet refused the sync."))

            db.withTransaction {
                shipments.map { it.id }.chunked(500).forEach { dao.cleanShipments(it, pushedAt) }
                expected.map { it.id }.chunked(500).forEach { dao.cleanExpected(it, pushedAt) }
                items.map { it.id }.chunked(500).forEach { dao.cleanItems(it, pushedAt) }
                movements.map { it.id }.chunked(500).forEach { dao.cleanMovements(it) }
                customers.map { it.id }.chunked(500).forEach { dao.cleanCustomers(it, pushedAt) }
                users.map { it.id }.chunked(500).forEach { dao.cleanUsers(it, pushedAt) }
                requests.map { it.id }.chunked(500).forEach { dao.cleanRequests(it, pushedAt) }
                groups.map { it.id }.chunked(500).forEach { dao.cleanGroups(it, pushedAt) }
                products.map { it.id }.chunked(500).forEach { dao.cleanProducts(it, pushedAt) }
                counts.map { it.id }.chunked(500).forEach { dao.cleanCounts(it) }
                mergeShipments(response.optJSONArray("shipments"))
                mergeExpected(response.optJSONArray("expected"))
                mergeItems(response.optJSONArray("items"))
                mergeMovements(response.optJSONArray("movements"))
                mergeCustomers(response.optJSONArray("customers"))
                mergeUsers(response.optJSONArray("users"))
                mergeRequests(response.optJSONArray("requests"))
                mergeGroups(response.optJSONArray("groups"))
                mergeProducts(response.optJSONArray("products"))
            }
            response.optString("rev").takeIf { it.isNotEmpty() }?.let { prefs.lastRev = it }
            if (response.has("movements")) prefs.movementsBackfilled = true
            prefs.lastServerSync = response.optLong("now", prefs.lastServerSync)
            response.optJSONArray("devices")?.let { prefs.devicesJson = it.toString() }
            response.optLong("lastBackup", 0L).takeIf { it > 0 }?.let { prefs.lastBackup = it }
            response.optString("sheetUrl").takeIf { it.startsWith("https://") }?.let { prefs.sheetUrl = it }
            val pushed = shipments.size + expected.size + items.size + movements.size + customers.size + users.size + requests.size + groups.size + products.size
            val msg = "Synced ${Format.dateTime(System.currentTimeMillis())} · sent $pushed change(s)"
            prefs.lastSyncMessage = msg
            try { afterSync() } catch (_: Exception) {}
            msg
        } catch (e: Exception) {
            val msg = "Sync failed ${Format.dateTime(System.currentTimeMillis())}: ${e.message ?: e.javaClass.simpleName}"
            prefs.lastSyncMessage = msg
            throw IOException(msg, e)
        }
    }

    /**
     * Quick check whether anything changed in the sheet since the last sync; syncs if so.
     * Used every few seconds while the app is open, so approvals arrive quickly.
     */
    suspend fun syncIfChanged() {
        if (!prefs.syncConfigured) return
        val res = JSONObject(post(prefs.webAppUrl, JSONObject().put("action", "poll").put("token", prefs.token).toString()))
        if (!res.optBoolean("ok")) return
        val rev = res.optString("rev")
        if (rev.isEmpty() || rev != prefs.lastRev || dao.dirtyRequests().isNotEmpty()) sync()
    }

    /** Checks the admin code shown in the Apps Script log. Throws with the reason when it is wrong. */
    suspend fun verifyAdminCode(code: String) {
        if (!prefs.syncConfigured) throw IOException("Add the web app URL and token first.")
        val res = JSONObject(
            post(prefs.webAppUrl, JSONObject().put("action", "verifyAdmin").put("token", prefs.token).put("code", code.trim()).toString())
        )
        if (!res.optBoolean("ok")) {
            val err = res.optString("error")
            throw IOException(if (err == "Unknown action") "Update the Apps Script to version 1.9.0 and deploy a new version first." else err.ifEmpty { "Wrong admin code" })
        }
    }

    // ---------- merge ----------

    private suspend fun mergeGroups(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            GroupRow(
                id = it.getString("id"), name = it.optString("name"), unit = it.optString("unit"), pack = it.optString("pack"),
                sort = it.optInt("order"), hidden = it.optBoolean("hidden", false), updatedAt = it.optLong("updatedAt"), dirty = false,
            )
        }.filter { remote -> dao.group(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putGroups(rows)
    }

    private suspend fun mergeProducts(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Product(
                id = it.getString("id"), groupId = it.optString("groupId"), code = it.optString("code"), size = it.optString("size"),
                unit = it.optString("unit"), packQty = it.optDouble("packQty", 0.0).takeIf { q -> !q.isNaN() } ?: 0.0,
                note = it.optString("note"), hidden = it.optBoolean("hidden", false), updatedAt = it.optLong("updatedAt"), dirty = false,
                minQty = it.optDouble("minQty", 0.0).takeIf { q -> !q.isNaN() } ?: 0.0,
            ) to it.has("minQty")
        }.mapNotNull { (remote, hasMin) ->
            val local = dao.product(remote.id)
            when {
                local == null -> remote
                local.dirty || local.updatedAt > remote.updatedAt -> null
                // An older script does not send the minimum; keep the one already here.
                !hasMin -> remote.copy(minQty = local.minQty)
                else -> remote
            }
        }
        if (rows.isNotEmpty()) dao.putProducts(rows)
    }

    private suspend fun mergeUsers(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            AppUser(
                id = it.getString("id"), name = it.optString("name"), role = it.optString("role"),
                canReceive = it.optBoolean("canReceive", false), active = it.optBoolean("active", true),
                pinHash = it.optString("pinHash"), salt = it.optString("salt"), updatedAt = it.optLong("updatedAt"), dirty = false,
            )
        }.filter { remote -> dao.user(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putUsers(rows)
    }

    private suspend fun mergeRequests(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.mapNotNull {
            val remote = ChangeRequest(
                id = it.getString("id"), kind = it.optString("kind"), target = it.optString("target"),
                summary = it.optString("summary"), reason = it.optString("reason"), requestedBy = it.optString("requestedBy"),
                device = it.optString("device"), requestedAt = it.optLong("requestedAt"),
                status = it.optString("status").ifEmpty { RequestStatus.PENDING }, decidedBy = it.optString("decidedBy"),
                decidedAt = it.optLong("decidedAt"), note = it.optString("note"), updatedAt = it.optLong("updatedAt"), dirty = false,
                payload = it.optString("payload"),
            )
            val local = dao.request(remote.id)
            when {
                local == null -> remote
                // A decision is final: the first one the sheet saw wins.
                remote.status != RequestStatus.PENDING && local.status != remote.status -> remote.copy(notified = local.notified)
                local.dirty || local.updatedAt > remote.updatedAt -> null
                else -> remote.copy(notified = local.notified)
            }
        }
        if (rows.isNotEmpty()) dao.putRequests(rows)
    }

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
                labelId = it.optString("labelId").ifEmpty { null },
            )
        }.mapNotNull { remote ->
            val local = dao.expectedById(remote.id)
            when {
                local == null -> remote
                local.dirty || local.updatedAt > remote.updatedAt -> null
                // An older script does not return the label ID; keep the one already here.
                else -> remote.copy(labelId = remote.labelId ?: local.labelId)
            }
        }
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
                reservedFor = it.optString("reservedFor"),
            ) to it.has("reservedFor")
        }.mapNotNull { (remote, hasReserve) ->
            val local = dao.item(remote.id)
            when {
                local == null -> remote
                local.dirty || local.updatedAt > remote.updatedAt -> null
                // An older script does not send the reservation; keep the one already here.
                !hasReserve -> remote.copy(reservedFor = local.reservedFor)
                else -> remote
            }
        }
        if (rows.isNotEmpty()) dao.putItems(rows)
    }

    private suspend fun mergeMovements(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Movement(
                id = it.getString("id"), itemId = it.optString("itemId"), type = it.optString("type"),
                qty = it.optDouble("qty", 0.0), reference = it.optString("reference"), at = it.optLong("at"),
                device = it.optString("device"), code = it.optString("code"), size = it.optString("size"),
                unit = it.optString("unit"), dirty = false, user = it.optString("user"),
                customer = it.optString("customer"), invoice = it.optString("invoice"),
            )
        }
        rows.chunked(500).forEach { dao.putMovementsIfAbsent(it) }
    }

    private suspend fun mergeCustomers(arr: JSONArray?) {
        if (arr == null || arr.length() == 0) return
        val rows = (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Customer(
                id = it.getString("id"), name = it.optString("name"), createdAt = it.optLong("createdAt"),
                createdBy = it.optString("createdBy"), updatedAt = it.optLong("updatedAt"),
                hidden = it.optBoolean("hidden", false), dirty = false,
            )
        }.filter { remote -> dao.customer(remote.id).let { it == null || (!it.dirty && it.updatedAt <= remote.updatedAt) } }
        if (rows.isNotEmpty()) dao.putCustomers(rows)
    }

    // ---------- JSON ----------

    private fun JSONObject.optNullableDouble(key: String): Double? =
        if (!has(key) || isNull(key) || optString(key).isEmpty()) null else optDouble(key).takeIf { !it.isNaN() }

    private fun GroupRow.toJson() = JSONObject()
        .put("id", id).put("name", name).put("unit", unit).put("pack", pack).put("order", sort).put("hidden", hidden)
        .put("updatedAt", updatedAt)

    private fun StockCount.toJson() = JSONObject()
        .put("id", id).put("place", place).put("at", at).put("user", user).put("device", device)
        .put("expected", expected).put("found", found).put("missing", missing).put("extra", extra)
        .put("missingIds", JSONArray(missingIds.split(",").map { it.trim() }.filter { it.isNotEmpty() }))
        .put("extraIds", JSONArray(extraIds.split(",").map { it.trim() }.filter { it.isNotEmpty() }))

    private fun Product.toJson() = JSONObject()
        .put("id", id).put("groupId", groupId).put("code", code).put("size", size).put("unit", unit).put("packQty", packQty)
        .put("note", note).put("hidden", hidden).put("updatedAt", updatedAt).put("minQty", minQty)

    private fun AppUser.toJson() = JSONObject()
        .put("id", id).put("name", name).put("role", role).put("canReceive", canReceive).put("active", active)
        .put("pinHash", pinHash).put("salt", salt).put("updatedAt", updatedAt)

    private fun ChangeRequest.toJson() = JSONObject()
        .put("id", id).put("kind", kind).put("target", target).put("summary", summary).put("reason", reason)
        .put("requestedBy", requestedBy).put("device", device).put("requestedAt", requestedAt).put("status", status)
        .put("decidedBy", decidedBy).put("decidedAt", decidedAt).put("note", note).put("updatedAt", updatedAt).put("payload", payload)

    private fun Customer.toJson() = JSONObject()
        .put("id", id).put("name", name).put("createdAt", createdAt).put("createdBy", createdBy)
        .put("updatedAt", updatedAt).put("hidden", hidden)

    private fun Shipment.toJson() = JSONObject()
        .put("id", id).put("name", name).put("source", source).put("createdAt", createdAt).put("updatedAt", updatedAt)

    private fun ExpectedUnit.toJson() = JSONObject()
        .put("id", id).put("shipmentId", shipmentId).put("pallet", pallet).put("lineNo", lineNo)
        .put("category", category).put("code", code).put("size", size).put("qty", qty).put("unit", unit)
        .put("netKg", netKg ?: JSONObject.NULL).put("grossKg", grossKg ?: JSONObject.NULL)
        .put("itemId", itemId ?: "").put("updatedAt", updatedAt).put("labelId", labelId ?: "")

    private fun Item.toJson() = JSONObject()
        .put("id", id).put("category", category).put("code", code).put("size", size).put("unit", unit)
        .put("qty", qty).put("remaining", remaining).put("status", status)
        .put("shipmentId", shipmentId ?: "").put("pallet", pallet ?: "")
        .put("netKg", netKg ?: JSONObject.NULL).put("grossKg", grossKg ?: JSONObject.NULL)
        .put("receivedAt", receivedAt).put("location", location).put("device", device).put("updatedAt", updatedAt).put("reservedFor", reservedFor)

    private fun Movement.toJson() = JSONObject()
        .put("id", id).put("itemId", itemId).put("type", type).put("qty", qty).put("reference", reference)
        .put("at", at).put("device", device).put("code", code).put("size", size).put("unit", unit).put("user", user)
        .put("customer", customer).put("invoice", invoice)

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
            try { conn.errorStream?.close() } catch (_: IOException) {}
            conn.disconnect()
            throw IOException(httpError(code))
        }
        val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        conn.disconnect()
        if (!text.trimStart().startsWith("{")) {
            throw IOException(
                if (text.contains("accounts.google.com") || text.contains("ServiceLogin")) {
                    "The web app asks for a Google sign-in. In Apps Script set the deployment's \"Who has access\" to Anyone."
                } else {
                    "The web app did not return data. Check the Web app URL in Settings and deploy a new version of the script."
                }
            )
        }
        text
    }

    /** A short reason for a failed request, instead of Google's error page. */
    private fun httpError(code: Int): String = when (code) {
        404 -> "Web app not found (404). In Apps Script open Deploy → Manage deployments, copy the Web app URL of the active deployment and paste it in Settings → Google Sheet."
        401, 403 -> "No access to the web app ($code). The deployment must run as Me with \"Who has access\" set to Anyone."
        429 -> "Google is busy (429). The app tries again by itself in a minute."
        in 500..599 -> "Google had a problem ($code). The app tries again by itself in a minute."
        else -> "The web app answered with error $code."
    }
}
