package com.arrab.studio.managed

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.arrab.studio.R

/**
 * Shows a server push. Everything in the payload is plain text; the only thing
 * that can navigate is an allowlisted `arrab://` deep link, opened inside this app.
 *
 * TODO(contract): push data keys are not in the contract yet. Expected data
 * message keys: notificationId, kind, title, body (already localized for the
 * locale sent in /v1/client/sync), deepLink.
 */
object PushNotifier {
  private val deepLinkPattern =
    Regex("^arrab://(companions/[A-Za-z0-9_-]{1,120}|chat/[A-Za-z0-9_-]{1,120}|settings/usage|update)$")

  fun safeDeepLink(raw: String?): String? = raw?.trim()?.takeIf { deepLinkPattern.matches(it) }

  fun show(context: Context, data: Map<String, String>) {
    val id = data["notificationId"]?.takeIf { it.isNotBlank() } ?: return
    val title = data["title"]?.take(200)?.takeIf { it.isNotBlank() } ?: return
    val body = data["body"]?.take(1000)
    val kind = data["kind"]
    NotificationChannels.ensure(context)

    val builder = NotificationCompat.Builder(context, NotificationChannels.forKind(kind))
      .setSmallIcon(R.drawable.ic_arrab_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(openIntent(context, id, safeDeepLink(data["deepLink"])))
      .addAction(0, context.getString(R.string.arrab_action_open), openIntent(context, id, safeDeepLink(data["deepLink"])))
    if (kind == "update") {
      builder.addAction(0, context.getString(R.string.arrab_action_update_now), openIntent(context, id, "arrab://update"))
    }
    try {
      NotificationManagerCompat.from(context).notify(id.hashCode(), builder.build())
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted — the notice still arrives in the in-app bell on next sync.
    }
  }

  private fun openIntent(context: Context, notificationId: String, deepLink: String?): PendingIntent {
    val intent = if (deepLink != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    }
    intent.setPackage(context.packageName)
    intent.putExtra("notificationId", notificationId)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      (notificationId + (deepLink ?: "")).hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
