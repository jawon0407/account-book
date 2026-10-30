package com.accountbook.notificationaccess

/** 합성 자료만 사용한다. kotlin compiler로 실행 가능한 순수 JVM 회귀 시험. */
fun main() {
  // A native confirmation dialog takes window focus without pausing the Activity.
  // Start uses the current Activity lifecycle, not the stale/module-created focus flag.
  val resumed = CaptureEngine { 100L }
  resumed.connection(true)
  val resumedEpoch = resumed.begin(wallTime = 1000L, activityResumed = true)
  check(resumed.renew(resumedEpoch, resumed.beginVerification(resumedEpoch))) {
    "An explicitly confirmed start in a resumed Activity must be allowed"
  }
  val pausedEpoch = resumed.begin(wallTime = 1001L, activityResumed = false)
  check(resumed.beginVerification(pausedEpoch) == -1 && !resumed.snapshot().running) {
    "A paused/missing Activity must reject start and clear the earlier permit"
  }
  resumed.connection(false)
  val disconnectedEpoch = resumed.begin(wallTime = 1002L, activityResumed = true)
  check(resumed.beginVerification(disconnectedEpoch) == -1)
  resumed.connection(true)
  check(resumed.beginVerification(disconnectedEpoch) == -1) // No auto-start on rebind.
  val explicitEpoch = resumed.begin(wallTime = 1003L, activityResumed = true)
  check(resumed.renew(explicitEpoch, resumed.beginVerification(explicitEpoch)))
  resumed.foreground(false)
  resumed.foreground(true)
  check(!resumed.snapshot().running && resumed.beginVerification(explicitEpoch) == -1)

  // Test-only OS notifications must never broaden the normal bank-source policy.
  val normal = CaptureSourcePolicy(syntheticOnly = false)
  val synthetic = CaptureSourcePolicy(syntheticOnly = true)
  check(normal.packageName == "com.kbstar.kbbank")
  check(normal.accepts("com.kbstar.kbbank", null))
  check(!normal.accepts("com.android.shell", "account-book-test-expense"))
  check(synthetic.packageName == "com.android.shell")
  check(synthetic.accepts("com.android.shell", "account-book-test-expense"))
  listOf(null, "", "other-tag", "account-book-test-").forEach {
    check(!synthetic.accepts("com.android.shell", it))
  }
  check(!synthetic.accepts("com.kbstar.kbbank", "account-book-test-expense"))
  check(!synthetic.accepts("chat.app", "account-book-test-expense"))
  val syntheticEngine = CaptureEngine(synthetic.packageName) { 100L }
  syntheticEngine.foreground(true); syntheticEngine.connection(true)
  val syntheticEpoch = syntheticEngine.begin()
  check(syntheticEngine.renew(syntheticEpoch, syntheticEngine.beginVerification(syntheticEpoch)))
  var syntheticReads = 0
  val fakeBody = "가*나 10/29 15:53 123456-**-***789 가상상점\n체크카드출금 19,800 잔액230,121"
  fun deliver(source: String, tag: String?) {
    if (!synthetic.accepts(source, tag)) return
    syntheticEngine.receive("synthetic", source, false, 1000L) {
      syntheticReads++; "출금 19,800원" to fakeBody
    }
  }
  deliver(normal.packageName, "account-book-test-expense")
  deliver(synthetic.packageName, null)
  check(syntheticReads == 0)
  // Engine itself keeps the configured source, without relabeling shell as a bank.
  syntheticEngine.receive("bank", normal.packageName, false, 1000L) {
    syntheticReads++; "출금 19,800원" to fakeBody
  }
  check(syntheticReads == 0)
  deliver(synthetic.packageName, "account-book-test-expense")
  check(syntheticReads == 1 && syntheticEngine.snapshot().parsed == 1)
  syntheticEngine.stop()
  deliver(synthetic.packageName, "account-book-test-after-stop")
  check(syntheticReads == 1 && syntheticEngine.snapshot().last == null)

  var now = 100L
  val engine = CaptureEngine { now }
  var reads = 0
  val body = "가*나 10/29 15:53 123456-**-***789 가상상점\n체크카드출금 19,800 잔액230,121"
  fun receive(key: String = "event-1", source: String = "com.kbstar.kbbank", summary: Boolean = false) {
    engine.receive(key, source, summary, 1000L) { reads++; "출금 19,800원" to body }
  }
  receive(); check(reads == 0)
  engine.foreground(true); engine.connection(true)
  val epoch = engine.begin()
  check(engine.renew(epoch, engine.beginVerification(epoch)))
  receive(source = "chat.app"); receive(summary = true)
  check(reads == 0)
  receive(); receive()
  check(reads == 1 && engine.snapshot().parsed == 1)
  check(engine.snapshot().last?.counterparty == "가상상점")
  engine.stop()
  check(engine.snapshot().last == null && !engine.renew(epoch, 5000))
  receive("event-2"); check(reads == 1)
  val second = engine.begin(); check(engine.renew(second, engine.beginVerification(second)))
  now += 5000
  receive("event-3"); check(reads == 1 && !engine.renew(second, 5000))
  val third = engine.begin(); check(engine.renew(third, engine.beginVerification(third)))
  engine.foreground(false); receive("event-4"); check(reads == 1)
  engine.foreground(true); check(!engine.renew(third, 5000))
  val fourth = engine.begin(); check(engine.renew(fourth, engine.beginVerification(fourth)))
  engine.connection(false); receive("event-5"); check(reads == 1)
  engine.connection(true); check(!engine.renew(fourth, 5000))
  val fifth = engine.begin(); check(!engine.renew(fifth, 5001))
  check(!engine.snapshot().running)
  val sixth = engine.begin(); check(engine.renew(sixth, engine.beginVerification(sixth)))
  repeat(257) { receive("capacity-$it") }
  check(!engine.snapshot().running && engine.snapshot().last == null)

  val parsed = CashNotificationParser.parse("출금 19,800원", body, 1000L)!!
  check(parsed.direction == "expense" && parsed.amount == 19800L)
  check(parsed.accountHint == "123456-**-***789")
  check(parsed.localTime == "10/29 15:53" && parsed.receivedAt == 1000L)
  check(CashNotificationParser.parse("출금 19,800원", body.replace("10/29", "02/29"), 1000L) != null)
  check(CashNotificationParser.parse("입금 20,000원", "가*나 10/29 15:53 123456-**-***789 가상입금자\n전자금융입금 20,000 잔액250,121", 1000L)?.direction == "income")
  val invalid = listOf(
    "결제 19,800원" to body,
    "승인 19,800원" to body,
    "입금 19,800원" to body,
    "출금 0원" to body,
    "출금 19,801원" to body,
    "출금 1,98,00원" to body,
    "출금 19,800원" to "내용이 숨겨졌어요",
    "출금 19,800원" to body.replace("10/29", "02/31"),
    "출금 19,800원" to body.replace("10/29", "00/10"),
    "출금 19,800원" to body.replace("10/29", "13/10"),
    "출금 19,800원" to body.replace("10/29", "04/31"),
    "출금 19,800원" to body.replace("10/29", "01/00"),
    "출금 19,800원" to body.replace("15:53", "25:53"),
    "출금 19,800원" to body.replace("123456-**-***789", "123456789012"),
    "출금 19,800원" to body.replace("가상상점", ""),
    "출금 19,800원" to body.replace("가상상점", "인증번호 123456"),
    "출금 19,800원" to body.replace("가상상점", "가".repeat(2049)),
    "출금 19,800원" to "$body\n입금 50,000원"
  )
  invalid.forEach { (title, text) -> check(CashNotificationParser.parse(title, text, 1000L) == null) }

  // Regression: native bridge scheduling must not extend the five-second verification window.
  var boundaryTime = 100L
  val boundary = CaptureEngine { boundaryTime }
  boundary.foreground(true); boundary.connection(true)
  val boundaryEpoch = boundary.begin()
  val ticket = boundary.beginVerification(boundaryEpoch)
  boundaryTime += 2000 // Server response and main-queue delivery were delayed.
  check(boundary.renew(boundaryEpoch, ticket))
  check(!boundary.renew(boundaryEpoch, ticket)) // A response cannot replay its permit.
  boundaryTime = 5100
  check(!boundary.snapshot().running) { "Delayed bridge renewal extended the verification deadline" }
  val nextEpoch = boundary.begin()
  val stale = boundary.beginVerification(nextEpoch)
  val current = boundary.beginVerification(nextEpoch)
  check(!boundary.renew(nextEpoch, stale))
  boundaryTime += 5000
  check(!boundary.renew(nextEpoch, current)) // An expired response cannot revive capture.

  // Regression: API 24/25 do not provide java.time; this loader models that missing API.
  // This exercises the compiled parser, not an Android device or desugaring toolchain.
  val location = CashNotificationParser::class.java.protectionDomain.codeSource.location
  val loader = object : java.net.URLClassLoader(arrayOf(location), CashNotificationParser::class.java.classLoader) {
    override fun loadClass(name: String, resolve: Boolean): Class<*> {
      if (name.startsWith("java.time.")) throw ClassNotFoundException("API 24/25 lacks java.time")
      if (name.startsWith("com.accountbook.notificationaccess.")) {
        val type = findLoadedClass(name) ?: findClass(name)
        if (resolve) resolveClass(type)
        return type
      }
      return super.loadClass(name, resolve)
    }
  }
  loader.use {
    val parser = it.loadClass("com.accountbook.notificationaccess.CashNotificationParser")
    val parse = parser.getMethod("parse", String::class.java, String::class.java, java.lang.Long.TYPE)
    check(parse.invoke(parser.getField("INSTANCE").get(null), "출금 19,800원", body, 1000L) != null)
  }
  println("PASS: native gate and parser behavioral checks")
}
