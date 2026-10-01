package com.arrab.studio.managed

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.arrab.studio.R

/** Same four channels as iOS thread ids and the desktop Settings → Notifications toggles. */
object NotificationChannels {
  const val UPDATES = "updates"
  const val SECURITY = "security"
  const val COMPANIONS = "companions"
  const val GENERAL = "general"

  fun forKind(kind: String?): String = when (kind) {
    "update" -> UPDATES
    "security" -> SECURITY
    "companion" -> COMPANIONS
    else -> GENERAL
  }

  fun ensure(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channels = listOf(
      NotificationChannel(UPDATES, context.getString(R.string.arrab_channel_updates), NotificationManager.IMPORTANCE_DEFAULT),
      NotificationChannel(SECURITY, context.getString(R.string.arrab_channel_security), NotificationManager.IMPORTANCE_HIGH),
      NotificationChannel(COMPANIONS, context.getString(R.string.arrab_channel_companions), NotificationManager.IMPORTANCE_DEFAULT),
      NotificationChannel(GENERAL, context.getString(R.string.arrab_channel_general), NotificationManager.IMPORTANCE_LOW),
    )
    manager.createNotificationChannels(channels)
  }
}
