package com.zinax.stock

import com.zinax.stock.data.AppUser
import com.zinax.stock.data.Prefs
import com.zinax.stock.data.StockDao
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Who is signed in on this phone. Null means the app is locked. The app locks after
 * [Prefs.lockMinutes] without a touch and whenever it leaves the screen, except for the
 * app's own trips to the camera, the share sheet and the file picker.
 */
class Session(private val prefs: Prefs, private val dao: StockDao) {
    private val _user = MutableStateFlow<AppUser?>(null)
    val user: StateFlow<AppUser?> = _user

    val current: AppUser? get() = _user.value
    val isAdmin: Boolean get() = current?.isAdmin == true
    val canReceive: Boolean get() = current?.mayReceive == true

    @Volatile var lastActive: Long = System.currentTimeMillis()
        private set

    /** Set just before the app opens the camera, share sheet or file picker, so leaving for it does not lock. */
    @Volatile var expectingExternal: Boolean = false

    fun login(u: AppUser) {
        prefs.userName = u.name
        prefs.lastUserId = u.id
        prefs.phoneUserIsAdmin = u.isAdmin
        lastActive = System.currentTimeMillis()
        _user.value = u
    }

    fun lock() {
        _user.value = null
    }

    fun touch() {
        lastActive = System.currentTimeMillis()
    }

    /** Before the camera, share sheet or file picker opens. */
    fun leaving() {
        expectingExternal = true
        touch()
    }

    fun idleTooLong(now: Long = System.currentTimeMillis()): Boolean {
        val minutes = prefs.lockMinutes
        return minutes > 0 && now - lastActive > minutes * 60_000L
    }

    /** After a sync: picks up a changed role or name, and locks if the user was turned off. */
    suspend fun refresh() {
        val u = current ?: return
        val fresh = dao.user(u.id)
        if (fresh == null || !fresh.active) {
            lock()
            return
        }
        if (fresh != u) {
            prefs.userName = fresh.name
            prefs.phoneUserIsAdmin = fresh.isAdmin
            _user.value = fresh
        }
    }
}
