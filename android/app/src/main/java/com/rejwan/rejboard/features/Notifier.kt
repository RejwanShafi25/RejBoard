package com.rejwan.rejboard.features

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import com.rejwan.rejboard.MainActivity
import com.rejwan.rejboard.R

/** The web Notification API (checklist reminders) as Android notifications; tapping one opens the board, like on the desktop. */
class Notifier(private val act: Activity, private val requestPermission: (String) -> Boolean) {
    private val ctx: Context = act.applicationContext
    private val prefs = ctx.getSharedPreferences("notify", Context.MODE_PRIVATE)

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL, ctx.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_HIGH)
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    /** "granted" | "denied" | "default", as Notification.permission */
    fun permission(): String {
        val enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (granted && enabled) return "granted"
            return if (prefs.getBoolean("asked", false)) "denied" else "default"
        }
        return if (enabled) "granted" else "denied"
    }

    fun register(b: Bridge) {
        b.handle("notify:permission") {
            if (Build.VERSION.SDK_INT >= 33 && permission() == "default") {
                prefs.edit().putBoolean("asked", true).apply()
                requestPermission(Manifest.permission.POST_NOTIFICATIONS)
            }
            permission()
        }
        b.handle("notify:show") { a ->
            if (permission() != "granted") return@handle false
            val id = a.optInt(0); val title = Json.str(a, 1) ?: ""; val body = Json.str(a, 2) ?: ""; val tag = Json.str(a, 3) ?: ""
            val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra(EXTRA_ID, id)
            val pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title).setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true).setContentIntent(pi).build()
            try { NotificationManagerCompat.from(ctx).notify(tag.ifEmpty { null }, if (tag.isEmpty()) id else 0, n); true } catch (_: SecurityException) { false }
        }
        b.handle("notify:close") { null }
    }

    companion object {
        const val CHANNEL = "reminders"
        const val EXTRA_ID = "rb_notification_id"
    }
}
