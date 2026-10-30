package com.accountbook.notificationaccess

import java.security.MessageDigest

data class CaptureSnapshot(val running: Boolean, val parsed: Int, val unrecognized: Int, val last: CashPreview?) {
  fun wire(): Map<String, Any?> = mapOf("running" to running, "parsed" to parsed,
    "unrecognized" to unrecognized, "last" to last?.wire())
}

/** 메모리 한정 수신 경계. monotonic 시계를 쓰며 늦은 갱신은 중지 이후 세대에 적용하지 않는다. */
class CaptureEngine(private val elapsed: () -> Long) {
  private var epoch = 0
  private var foreground = false
  private var connected = false
  private var pending = false
  private var deadline = 0L
  private var verification = 0
  private var verificationDeadline = 0L
  private var startedAt = 0L
  private var parsed = 0
  private var unrecognized = 0
  private var last: CashPreview? = null
  private val seen = HashSet<String>()

  @Synchronized fun foreground(value: Boolean) { foreground = value; if (!value) stop() }
  @Synchronized fun connection(value: Boolean) { connected = value; if (!value) stop() }
  /** 명시적 시작 의도만 만든다. 검증 전이므로 아직 본문을 읽지 않는다. */
  @Synchronized fun begin(wallTime: Long = 0): Int { stop(); pending = foreground && connected; startedAt = wallTime; return epoch }
  /** 서버 조회 전에 네이티브 시계로 만료를 고정한다. 브리지 지연은 허용 시간을 늘리지 않는다. */
  @Synchronized fun beginVerification(expected: Int): Int {
    if (expected != epoch || !foreground || !connected || (!pending && !allowed())) return -1
    verification = if (verification == Int.MAX_VALUE) 1 else verification + 1
    verificationDeadline = elapsed() + 5000
    return verification
  }
  /** @param expected 시작 세대 @param ticket 서버 조회 전에 발급한 일회용 검증 번호. */
  @Synchronized fun renew(expected: Int, ticket: Int): Boolean {
    if (expected != epoch || !foreground || !connected || ticket != verification || verificationDeadline == 0L) return false
    if (!pending && !allowed()) return false
    if (elapsed() >= verificationDeadline) { stop(); return false }
    pending = false
    deadline = verificationDeadline
    verificationDeadline = 0
    return true
  }
  @Synchronized fun stop() {
    epoch = if (epoch == Int.MAX_VALUE) 0 else epoch + 1
    pending = false; deadline = 0; verificationDeadline = 0; parsed = 0; unrecognized = 0; last = null; seen.clear()
  }
  @Synchronized fun snapshot(): CaptureSnapshot = CaptureSnapshot(allowed(), parsed, unrecognized, last)
  private fun allowed(): Boolean {
    if (!foreground || !connected || deadline == 0L) return false
    if (elapsed() >= deadline) { stop(); return false }
    return true
  }
  /** 허용/출처/요약/중복 검사 후에만 content를 호출한다. 원문이나 OS 객체는 대기열에 보관하지 않는다. */
  @Synchronized fun receive(key: String, source: String, summary: Boolean, receivedAt: Long,
    postedAt: Long = receivedAt, content: () -> Pair<String, String>) {
    if (!allowed() || summary || source != "com.kbstar.kbbank" || postedAt < startedAt) return
    val id = MessageDigest.getInstance("SHA-256").digest("$key:$postedAt".toByteArray()).joinToString("") { "%02x".format(it) }
    if (id in seen) return
    if (seen.size >= 256) { stop(); return }
    seen.add(id)
    val result = try { val (title, body) = content(); CashNotificationParser.parse(title, body, receivedAt) }
      catch (_: Exception) { null }
    if (result == null) unrecognized++ else { parsed++; last = result }
  }
}
