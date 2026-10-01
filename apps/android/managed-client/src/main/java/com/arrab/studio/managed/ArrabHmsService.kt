package com.arrab.studio.managed

import com.huawei.hms.push.HmsMessageService
import com.huawei.hms.push.RemoteMessage

/** Huawei Push Kit (Huawei devices without Google Play services). */
class ArrabHmsService : HmsMessageService() {
  override fun onNewToken(token: String?) {
    PushBridge.instance?.emitToken("hms", token)
  }

  override fun onMessageReceived(message: RemoteMessage?) {
    val data = message?.dataOfMap ?: return
    PushNotifier.show(applicationContext, data)
  }
}
