package com.accountbook.notificationaccess

/**
 * 빌드 시 고정되는 알림 출처 정책. 합성 시험에서는 실제 금융 앱을 허용하지 않는다.
 * @param syntheticOnly 명시적으로 선택한 debug 빌드에서만 true. 실행 중 변경할 수 없다.
 */
class CaptureSourcePolicy(private val syntheticOnly: Boolean) {
  val packageName = if (syntheticOnly) "com.android.shell" else "com.kbstar.kbbank"

  /** OS가 준 출처와 태그만 검사하며, 알림 본문은 이 검사가 끝난 뒤 읽는다. */
  fun accepts(packageName: String, tag: String?): Boolean {
    if (packageName != this.packageName) return false
    if (!syntheticOnly) return true
    return tag != null && tag.startsWith(TEST_PREFIX) && tag.length > TEST_PREFIX.length
  }

  private companion object { const val TEST_PREFIX = "account-book-test-" }
}
