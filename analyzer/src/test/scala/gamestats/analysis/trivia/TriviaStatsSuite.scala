package gamestats.analysis.trivia

import gamestats.fixtures.Fixtures.*
import gamestats.model.*
import io.circe.Json

/** T1 to T5 on a hand-written match of 4 questions between p-ana and p-luis:
  *
  * {{{
  * question  category  p-ana               p-luis              right answers
  * q1 (1)    CIENCIA   right, 2000 ms      wrong, 4000 ms      1
  * q2 (2)    HISTORIA  right, 1000 ms      right, 3000 ms      2
  * q3 (3)    CIENCIA   wrong, 6000 ms      timeout             0
  * q4 (4)    HISTORIA  timeout             right, 2000 ms      1
  * }}}
  */
class TriviaStatsSuite extends munit.FunSuite:

  def shown(at: Double, q: String, number: Int, category: String): Spec =
    sys(
      at,
      "QUESTION_SHOWN",
      "questionId" -> s(q),
      "number" -> n(number),
      "category" -> s(category),
      "difficulty" -> s("EASY"),
      "timeLimitMs" -> n(10000)
    )

  def answer(at: Double, p: String, q: String, correct: Boolean, ms: Int): Spec =
    e(
      at,
      "ANSWER_SUBMITTED",
      p,
      "questionId" -> s(q),
      "option" -> s(if correct then "A" else "B"),
      "correct" -> b(correct),
      "responseMs" -> n(ms)
    )

  def timeout(at: Double, p: String, q: String): Spec =
    e(at, "ANSWER_TIMEOUT", p, "questionId" -> s(q))

  def closed(at: Double, q: String, count: Int): Spec =
    sys(
      at,
      "QUESTION_CLOSED",
      "questionId" -> s(q),
      "correctOption" -> s("A"),
      "correctCount" -> n(count)
    )

  val specs: List[Spec] = List(
    sys(
      0,
      "MATCH_STARTED",
      "players" -> arr("p-ana", "p-luis"),
      "mode" -> s("CLASSIC"),
      "questions" -> n(4)
    ),
    shown(1, "q1", 1, "CIENCIA"),
    answer(3, "p-ana", "q1", true, 2000),
    answer(5, "p-luis", "q1", false, 4000),
    closed(11, "q1", 1),
    shown(12, "q2", 2, "HISTORIA"),
    answer(13, "p-ana", "q2", true, 1000),
    answer(15, "p-luis", "q2", true, 3000),
    closed(22, "q2", 2),
    shown(23, "q3", 3, "CIENCIA"),
    answer(29, "p-ana", "q3", false, 6000),
    timeout(33, "p-luis", "q3"),
    closed(34, "q3", 0),
    shown(35, "q4", 4, "HISTORIA"),
    answer(37, "p-luis", "q4", true, 2000),
    timeout(45, "p-ana", "q4"),
    closed(46, "q4", 1),
    sys(
      47,
      "MATCH_FINISHED",
      "durationMs" -> n(47000),
      "results" -> results("p-ana" -> 1, "p-luis" -> 2)
    )
  )

  val quiz: MatchBatch = batch("trivia", specs)
  val result: MatchAnalysis = TriviaAnalyzer.analyze(quiz)

  def metrics(a: MatchAnalysis, p: String): Map[String, Json] =
    a.players.find(_.playerId == p).map(_.metrics).getOrElse(fail(s"no player $p"))

  def dbl(j: Json): Double = j.asNumber.map(_.toDouble).getOrElse(fail(s"$j is not a number"))

  def field(j: Json, key: String): Double = dbl(j.hcursor.downField(key).focus.get)

  test("T1: right answers, wrong answers, timeouts and % over the questions of the match") {
    val ana = metrics(result, "p-ana")
    assertEquals(List("correct", "wrong", "timeouts").map(k => dbl(ana(k))), List(2.0, 1.0, 1.0))
    assertEquals(dbl(ana("correctPct")), 50.0) // 2 / 4
    assertEquals(dbl(metrics(result, "p-luis")("correctPct")), 50.0) // q2 and q4

    // Without `questions` in MATCH_STARTED the default of 10 is used: 2 / 10 = 20 %.
    val noKey = quiz.copy(events =
      quiz.events.map(ev =>
        if ev.eventType == "MATCH_STARTED" then ev.copy(data = ev.data.remove("questions")) else ev
      )
    )
    assertEquals(dbl(metrics(TriviaAnalyzer.analyze(noKey), "p-ana")("correctPct")), 20.0)
  }

  test("T2: average response of every answer and fastest right answer") {
    val ana = metrics(result, "p-ana")
    assertEquals(dbl(ana("avgResponseMs")), 3000.0) // (2000 + 1000 + 6000) / 3
    assertEquals(dbl(ana("fastestCorrectMs")), 1000.0)
    val luis = metrics(result, "p-luis")
    assertEquals(dbl(luis("avgResponseMs")), 3000.0) // (4000 + 3000 + 2000) / 3, timeout left out
    assertEquals(dbl(luis("fastestCorrectMs")), 2000.0)
  }

  test("T2: a player without right answers has no fastest right answer") {
    val wrongOnly = batch("trivia", specs.take(5).filterNot(_.player.contains("p-ana")))
    assertEquals(metrics(TriviaAnalyzer.analyze(wrongOnly), "p-luis").get("fastestCorrectMs"), None)
  }

  test("T3: % of right answers per category, joining answers with QUESTION_SHOWN") {
    val ana = metrics(result, "p-ana")("correctPctByCategory")
    assertEquals((field(ana, "CIENCIA"), field(ana, "HISTORIA")), (50.0, 50.0))
    // p-luis: CIENCIA wrong + timeout = 0 %, HISTORIA 2 of 2 = 100 %
    val luis = metrics(result, "p-luis")("correctPctByCategory")
    assertEquals((field(luis, "CIENCIA"), field(luis, "HISTORIA")), (0.0, 100.0))
  }

  test("T4: hardest question, fastest player and % of the match") {
    val m = result.matchMetrics
    assertEquals(m("hardestQuestion").hcursor.get[String]("questionId"), Right("q3"))
    assertEquals(field(m("hardestQuestion"), "correctCount"), 0.0)
    // average of right answers: p-ana (2000 + 1000) / 2 = 1500, p-luis (3000 + 2000) / 2 = 2500
    assertEquals(m("fastestPlayer").hcursor.get[String]("playerId"), Right("p-ana"))
    assertEquals(field(m("fastestPlayer"), "avgCorrectMs"), 1500.0)
    assertEquals(dbl(m("matchCorrectPct")), 50.0) // 4 right of 8 attempts
  }

  test("T4: on a tie of right answers the later question is the hardest") {
    // Without q3, q1 and q4 both have 1 right answer: q4 (number 4) wins the tie.
    val tie = batch(
      "trivia",
      specs.filterNot(sp =>
        sp.eventType == "QUESTION_CLOSED" && sp.data.contains("questionId" -> s("q3"))
      )
    )
    assertEquals(
      TriviaAnalyzer.analyze(tie).matchMetrics("hardestQuestion").hcursor.get[String]("questionId"),
      Right("q4")
    )
  }

  test("T5: hardest category over every match of the game") {
    // This match: CIENCIA 1 of 4, HISTORIA 3 of 4. Another one: CIENCIA 3 of 4.
    val other = result.copy(
      matchId = "m-2",
      matchMetrics = Map(
        "categoryTotals" -> Json.obj(
          "CIENCIA" -> Json.obj("correct" -> Json.fromInt(3), "total" -> Json.fromInt(4))
        )
      )
    )
    val game = TriviaAnalyzer.gameMetrics(List(result, other))
    // CIENCIA (1 + 3) / 8 = 50 % < HISTORIA 3 / 4 = 75 %
    assertEquals(game("hardestCategory").hcursor.get[String]("category"), Right("CIENCIA"))
    assertEquals(field(game("hardestCategory"), "correctPct"), 50.0)
    assertEquals(field(game("correctPctByCategory"), "HISTORIA"), 75.0)
    assertEquals(TriviaAnalyzer.gameMetrics(Nil), Map.empty)
  }
