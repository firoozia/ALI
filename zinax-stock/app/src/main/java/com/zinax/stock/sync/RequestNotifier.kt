package com.zinax.stock.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.zinax.stock.Graph
import com.zinax.stock.MainActivity
import com.zinax.stock.R
import com.zinax.stock.data.ChangeRequest
import com.zinax.stock.data.RequestStatus

/**
 * Notifications at the top of the screen for undo and delete requests: admins' phones are told
 * about new requests, and the phone that asked is told the answer.
 */
object RequestNotifier {
    const val CHANNEL = "requests"
    const val EXTRA_REQUEST = "zinax_request"
    const val EXTRA_REQUEST_ACTION = "zinax_request_action"
    const val OPEN = "open"
    const val APPROVE = "approve"
    const val REJECT = "reject"

    fun createChannel(context: Context) {
        val ch = NotificationChannel(CHANNEL, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Undo and delete requests waiting for an admin, and their answers"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    /** Shows what is new since the last check and remembers it, so nothing is shown twice. */
    suspend fun check(context: Context) {
        val dao = Graph.db.dao()
        val prefs = Graph.prefs
        val allowed = Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val nm = NotificationManagerCompat.from(context)
        for (r in dao.requestsToNotify()) {
            val mine = r.device == prefs.deviceCode
            when {
                r.status == RequestStatus.PENDING && prefs.phoneUserIsAdmin && !mine ->
                    if (allowed) nm.notify(idFor(r), askAdmin(context, r))
                r.status != RequestStatus.PENDING && mine ->
                    if (allowed) nm.notify(idFor(r), answer(context, r))
                // Decided by someone else: the question on this phone is no longer open.
                r.status != RequestStatus.PENDING -> nm.cancel(idFor(r))
            }
            dao.setNotified(r.id, r.status)
        }
    }

    fun cancel(context: Context, requestId: String) {
        NotificationManagerCompat.from(context).cancel(2000 + (requestId.hashCode() and 0xFFFFF))
    }

    private fun idFor(r: ChangeRequest) = 2000 + (r.id.hashCode() and 0xFFFFF)

    private fun intent(context: Context, r: ChangeRequest, action: String, code: Int): PendingIntent {
        val i = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_REQUEST, r.id)
            .putExtra(EXTRA_REQUEST_ACTION, action)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, idFor(r) * 4 + code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun askAdmin(context: Context, r: ChangeRequest) = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("Approval needed · ${r.requestedBy}")
        .setContentText(r.summary)
        .setStyle(NotificationCompat.BigTextStyle().bigText(r.summary + if (r.reason.isNotBlank()) "\nReason: ${r.reason}" else ""))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setContentIntent(intent(context, r, OPEN, 0))
        .addAction(0, "Approve", intent(context, r, APPROVE, 1))
        .addAction(0, "Reject", intent(context, r, REJECT, 2))
        .setAutoCancel(true)
        .build()

    private fun answer(context: Context, r: ChangeRequest) = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(if (r.status == RequestStatus.APPROVED) "Approved by ${r.decidedBy}" else "Rejected by ${r.decidedBy}")
        .setContentText(r.summary)
        .setStyle(NotificationCompat.BigTextStyle().bigText(r.summary + if (r.note.isNotBlank()) "\n${r.note}" else ""))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setContentIntent(intent(context, r, OPEN, 0))
        .setAutoCancel(true)
        .build()
}
