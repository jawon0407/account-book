package com.accountbook.notificationaccess

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** JS에는 현재 OS 상태와 명시적 설정 이동만 제공한다. 권한을 대신 허용하지 않는다. */
class NotificationAccessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AccountBookNotificationAccess")
    OnActivityEntersForeground { NotificationAccessService.capture.foreground(true) }
    OnActivityEntersBackground { NotificationAccessService.capture.foreground(false) }
    OnDestroy { NotificationAccessService.capture.stop() }
    AsyncFunction("beginCapture") {
      val activity = appContext.currentActivity
      // Alert can still own window focus when its confirm callback runs. A resumed
      // Activity is the foreground boundary; pause/destroy callbacks still stop capture.
      val resumed = activity != null && !activity.isFinishing && !activity.isDestroyed &&
        (activity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.RESUMED
      NotificationAccessService.capture.begin(System.currentTimeMillis(), activityResumed = resumed)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("beginCaptureVerification") { epoch: Int ->
      NotificationAccessService.capture.beginVerification(epoch)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("renewCapture") { epoch: Int, ticket: Int ->
      NotificationAccessService.capture.renew(epoch, ticket)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopCapture") { NotificationAccessService.capture.stop() }.runOnQueue(Queues.MAIN)
    AsyncFunction("captureSnapshot") { NotificationAccessService.capture.snapshot().wire() }.runOnQueue(Queues.MAIN)
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
