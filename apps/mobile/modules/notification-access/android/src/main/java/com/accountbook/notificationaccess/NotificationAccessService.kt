package com.accountbook.notificationaccess

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.app.Notification
import android.os.SystemClock

/** 새 알림만 판독한다. 과거 조회·원문 로그·영속 저장·서버 전송은 없다. */
class NotificationAccessService : NotificationListenerService() {
  companion object {
    @Volatile var connected = false; private set
    val capture = CaptureEngine { SystemClock.elapsedRealtime() }
  }
  override fun onListenerConnected() { super.onListenerConnected(); connected = true; capture.connection(true) }
  override fun onListenerDisconnected() { connected = false; capture.connection(false); super.onListenerDisconnected() }
  override fun onDestroy() { connected = false; capture.connection(false); super.onDestroy() }
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null || sbn.packageName == packageName) return
    val notification = sbn.notification ?: return
    capture.receive(sbn.key, sbn.packageName,
      notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
      System.currentTimeMillis(), sbn.postTime) {
      // toString 전에 길이를 제한하며 bigText와 text를 합쳐 이중 판독하지 않는다.
      val extras = notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)
      val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      val body = if (!big.isNullOrEmpty()) big else extras.getCharSequence(Notification.EXTRA_TEXT)
      if (title == null || body == null || title.length > 100 || body.length > 2048) "" to ""
      else title.toString() to body.toString()
    }
  }
}
