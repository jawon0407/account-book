package com.accountbook.notificationaccess

/** 연도/시간대가 없는 은행 시각은 UTC로 추정하지 않는다. 원문은 결과에 넣지 않는다. */
data class CashPreview(val direction: String, val amount: Long, val counterparty: String,
  val accountHint: String, val localTime: String, val receivedAt: Long) {
  fun wire(): Map<String, Any> = mapOf("direction" to direction, "amount" to amount,
    "counterparty" to counterparty, "accountHint" to accountHint, "localTime" to localTime,
    "receivedAt" to receivedAt, "timeNeedsReview" to true)
}

/** KB의 검증된 마스킹 계좌 입출금 형식만 지원한다. null은 미지원/확인 필요다. */
object CashNotificationParser {
  // 연도가 없으므로 2월 29일은 보류 가능한 날짜로 허용한다. API 24에서도 사용 가능하다.
  private val maxDays = intArrayOf(31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
  private const val MONEY = "(?:[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})"
  private val titlePattern = Regex("^(입금|출금) ($MONEY)원$")
  private val bodyPattern = Regex("^[^\\s]{1,20} ([0-9]{2})/([0-9]{2}) ([0-9]{2}):([0-9]{2}) ([0-9*]{2,8}-[0-9*]{2,8}-[0-9*]{2,8}) ([^\\r\\n]{1,80})\\n(체크카드출금|오픈뱅킹출금|전자금융출금|전자금융입금) ($MONEY) 잔액(?:0|$MONEY)$")
  /** @param title 제목 @param body 확장 본문 우선의 한 본문 @param receivedAt 수신 시각. 원문은 보관하지 않는다. */
  fun parse(title: String, body: String, receivedAt: Long): CashPreview? {
    if (title.length > 100 || body.length > 2048 || receivedAt <= 0) return null
    if (Regex("인증번호|일회용|OTP|광고|승인|취소|예정", RegexOption.IGNORE_CASE).containsMatchIn("$title $body")) return null
    val head = titlePattern.matchEntire(title) ?: return null
    val row = bodyPattern.matchEntire(body.replace("\r\n", "\n")) ?: return null
    val (month, day, hour, minute) = row.groupValues.drop(1).take(4).map { it.toInt() }
    if (month !in 1..12 || day !in 1..maxDays[month - 1]) return null
    if (hour !in 0..23 || minute !in 0..59) return null
    val hint = row.groupValues[5]
    val counterparty = row.groupValues[6].trim()
    if (!hint.contains('*') || !hint.any { it.isDigit() } || counterparty.isEmpty() || counterparty.any { it.isISOControl() }) return null
    val income = head.groupValues[1] == "입금"
    if (income != row.groupValues[7].endsWith("입금")) return null
    val amount = head.groupValues[2].replace(",", "").toLongOrNull() ?: return null
    if (amount !in 1..999999999999L || row.groupValues[8].replace(",", "").toLongOrNull() != amount) return null
    return CashPreview(if (income) "income" else "expense", amount, counterparty, hint,
      "${row.groupValues[1]}/${row.groupValues[2]} ${row.groupValues[3]}:${row.groupValues[4]}", receivedAt)
  }
}
