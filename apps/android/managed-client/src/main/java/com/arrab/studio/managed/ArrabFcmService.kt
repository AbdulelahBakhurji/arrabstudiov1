package com.arrab.studio.managed

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Firebase Cloud Messaging (Google Play devices, including Samsung and Xiaomi with GMS). */
class ArrabFcmService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    PushBridge.instance?.emitToken("fcm", token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    PushNotifier.show(applicationContext, message.data)
  }
}
