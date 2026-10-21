package com.accountbook.notificationaccess

import android.service.notification.NotificationListenerService

/** 연결 확인만 한다. 알림 본문 callback, 과거/현재 알림 조회, 저장/로그/전송은 구현하지 않는다. */
class NotificationAccessService : NotificationListenerService() {
  companion object { @Volatile var connected = false; private set }
  override fun onListenerConnected() { super.onListenerConnected(); connected = true }
  override fun onListenerDisconnected() { connected = false; super.onListenerDisconnected() }
  override fun onDestroy() { connected = false; super.onDestroy() }
}
