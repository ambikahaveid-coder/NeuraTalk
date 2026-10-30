package com.Mindwhile.neuratalk

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Runs while a call is connected. Android gives a backgrounded app a silent
 * microphone (and no camera) unless a foreground service of that type is
 * running, so without this the other person heard nothing as soon as the
 * phone was locked or another app was opened mid-call.
 */
class OngoingCallService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
        val peer = intent?.getStringExtra(EXTRA_PEER)?.takeIf { it.isNotBlank() }

        var types = 0
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }

        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(peer, video), types)
        } catch (e: Exception) {
            // Camera type refused (e.g. permission revoked): keep the microphone.
            try {
                val micOnly = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
                ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(peer, false), micOnly)
            } catch (_: Exception) {
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    // Swiping the app away ends the call; do not leave a stale notification.
    override fun onTaskRemoved(rootIntent: Intent?) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    private fun buildNotification(peer: String?, video: Boolean): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while you are on a NeuraTalk call"
                    setShowBadge(false)
                }
            )
        }

        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        }
        val contentIntent = open?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        val title = if (video) "Video call in progress" else "Call in progress"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title)
            .setContentText(peer?.let { "With $it · tap to return" } ?: "Tap to return to the call")
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .apply { if (contentIntent != null) setContentIntent(contentIntent) }
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "ongoing_call"
        private const val NOTIFICATION_ID = 7301
        const val ACTION_STOP = "com.Mindwhile.neuratalk.ONGOING_CALL_STOP"
        const val EXTRA_VIDEO = "video"
        const val EXTRA_PEER = "peer"
    }
}
