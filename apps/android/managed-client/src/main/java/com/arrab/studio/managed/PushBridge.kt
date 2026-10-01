package com.arrab.studio.managed

import android.app.Activity
import android.content.Context
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.firebase.messaging.FirebaseMessaging
import com.huawei.agconnect.AGConnectOptionsBuilder
import com.huawei.hms.aaid.HmsInstanceId
import com.huawei.hms.api.HuaweiApiAvailability

/**
 * Tauri mobile plugin "arrab-push". JS calls `plugin:arrab-push|registerPush`
 * and listens for the "token" event (see src/lib/managed-client/push-bridge.ts).
 * The app only ever holds the OS-issued token — no provider keys.
 */
@TauriPlugin
class PushBridge(private val activity: Activity) : Plugin(activity) {
  init {
    instance = this
  }

  @Command
  fun registerPush(invoke: Invoke) {
    val context = activity.applicationContext
    NotificationChannels.ensure(context)
    when (providerFor(context)) {
      "hms" -> Thread {
        val token = try {
          val appId = AGConnectOptionsBuilder().build(context).getString("client/app_id")
          HmsInstanceId.getInstance(context).getToken(appId, "HCM")
        } catch (_: Exception) {
          null
        }
        invoke.resolve(registration("hms", token))
      }.start()
      "fcm" -> FirebaseMessaging.getInstance().token
        .addOnSuccessListener { token -> invoke.resolve(registration("fcm", token)) }
        .addOnFailureListener { invoke.resolve(registration("fcm", null)) }
      else -> invoke.resolve(registration("none", null))
    }
  }

  fun emitToken(provider: String, token: String?) {
    trigger("token", registration(provider, token))
  }

  companion object {
    @Volatile
    var instance: PushBridge? = null

    /** HMS only when Huawei Mobile Services is present and Google Play services is not. */
    fun providerFor(context: Context): String {
      val gms = try {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
      } catch (_: Throwable) {
        false
      }
      val hms = try {
        HuaweiApiAvailability.getInstance().isHuaweiMobileServicesAvailable(context) ==
          com.huawei.hms.api.ConnectionResult.SUCCESS
      } catch (_: Throwable) {
        false
      }
      return when {
        hms && !gms -> "hms"
        gms -> "fcm"
        else -> "none"
      }
    }

    fun registration(provider: String, token: String?): JSObject = JSObject().apply {
      put("provider", provider)
      put("token", token?.takeIf { it.isNotBlank() })
    }
  }
}
