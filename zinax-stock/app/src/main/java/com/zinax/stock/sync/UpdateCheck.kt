package com.zinax.stock.sync

import com.zinax.stock.Graph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/**
 * Looks for a newer APK among the GitHub releases. Each release body says "versionCode: N" and
 * "versionName: X.Y.Z"; a code above the installed one is offered on the home screen.
 */
object UpdateCheck {
    private const val RELEASES = "https://api.github.com/repos/firoozia/ALI/releases?per_page=5"
    private const val EVERY = 6 * 3600 * 1000L

    data class Update(val code: Long, val name: String, val url: String)

    /** The newest release, read at most every few hours; failures are quiet and keep what was known. */
    suspend fun latest(force: Boolean = false): Update? {
        val prefs = Graph.prefs
        val now = System.currentTimeMillis()
        if (force || now - prefs.updateCheckedAt > EVERY) {
            try {
                val found = withContext(Dispatchers.IO) { fetch() }
                prefs.updateCheckedAt = now
                if (found != null) {
                    prefs.updateCode = found.code
                    prefs.updateName = found.name
                    prefs.updateUrl = found.url
                }
            } catch (_: Exception) {
            }
        }
        return if (prefs.updateCode > 0 && prefs.updateUrl.isNotBlank()) Update(prefs.updateCode, prefs.updateName, prefs.updateUrl) else null
    }

    private fun fetch(): Update? {
        val conn = (URL(RELEASES).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        try {
            if (conn.responseCode !in 200..299) return null
            val arr = JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
            for (i in 0 until arr.length()) {
                val r = arr.getJSONObject(i)
                val body = r.optString("body")
                val code = Regex("versionCode:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toLongOrNull() ?: continue
                val name = Regex("versionName:\\s*([0-9.]+)").find(body)?.groupValues?.get(1).orEmpty()
                val assets = r.optJSONArray("assets") ?: continue
                val url = (0 until assets.length()).map { assets.getJSONObject(it) }
                    .firstOrNull { it.optString("name") == "ZinaxStock.apk" }?.optString("browser_download_url") ?: continue
                return Update(code, name, url)
            }
            return null
        } finally {
            conn.disconnect()
        }
    }
}
