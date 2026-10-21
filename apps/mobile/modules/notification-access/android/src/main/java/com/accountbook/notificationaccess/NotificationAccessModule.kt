package com.accountbook.notificationaccess

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

/** JS에는 현재 OS 상태와 명시적 설정 이동만 제공한다. 권한을 대신 허용하지 않는다. */
class NotificationAccessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AccountBookNotificationAccess")
    AsyncFunction("getStatus") {
      val context = requireNotNull(appContext.reactContext)
      val component = ComponentName(context, NotificationAccessService::class.java)
      val granted = if (Build.VERSION.SDK_INT >= 27) {
        context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(component)
      } else {
        Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
          ?.split(':')?.any { ComponentName.unflattenFromString(it) == component } ?: false
      }
      mapOf("available" to true, "accessGranted" to granted,
        "listenerConnected" to (granted && NotificationAccessService.connected))
    }
    AsyncFunction("openSettings") {
      val activity = appContext.currentActivity
      if (activity == null) false else {
        try {
          activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
          true
        } catch (_: android.content.ActivityNotFoundException) { false }
          catch (_: SecurityException) { false }
      }
    }.runOnQueue(Queues.MAIN)
  }
}
