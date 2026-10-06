package gamestats.analysis.racing

import gamestats.analysis.Metrics
import gamestats.fixtures.Fixtures.*
import gamestats.fixtures.Samples
import gamestats.model.*
import io.circe.Json

/** A race of 3 drivers and 3 laps, with every expected value worked out by hand in the comments.
  *
  * Lap times (ms): lap 1 lap 2 lap 3 total p-a 90000 91000 92000 273000 (+5 s penalty in lap 3 =
  * 278000) p-b 88500 93000 94500 276000 (pit stop in lap 2) p-c 89000 95000 88000 272000 (crash in
  * lap 2)
  *
  * Positions: after lap 1 B, C, A; after lap 2 A, B, C; after lap 3 C, A, B. Final classification
  * with the penalty: C 1st, B 2nd, A 3rd.
  */
class RacingStatsSuite extends munit.FunSuite:

  def lap(t: Double, p: String, lap: Int, ms: Long, pos: Int): Spec =
    e(
      t,
      "LAP_COMPLETED",
      p,
      "lap" -> n(lap),
      "lapTimeMs" -> n(ms.toDouble),
      "position" -> n(pos),
      "topSpeedKmh" -> n(310.5)
    )

  def moved(t: Double, p: String, lap: Int, from: Int, to: Int): Spec =
    e(t, "POSITION_CHANGED", p, "lap" -> n(lap), "from" -> n(from), "to" -> n(to))

  val race: MatchBatch = batch(
    "racing-pro",
    List(
      sys(0, "MATCH_STARTED", "players" -> arr("p-a", "p-b", "p-c"), "mode" -> s("GRAND_PRIX")),
      lap(88.5, "p-b", 1, 88500, 1),
      lap(89, "p-c", 1, 89000, 2),
      lap(90, "p-a", 1, 90000, 3),
      e(120, "CRASH", "p-c", "lap" -> n(2), "severity" -> s("HIGH")),
      e(130, "PIT_STOP", "p-b", "lap" -> n(2), "durationMs" -> n(4000), "tire" -> s("SOFT")),
      lap(181, "p-a", 2, 91000, 1),
      moved(181.001, "p-a", 2, 3, 1), // seq 8: OVERTAKE
      lap(181.5, "p-b", 2, 93000, 2),
      moved(181.501, "p-b", 2, 1, 2), // seq 10: PIT
      lap(184, "p-c", 2, 95000, 3),
      moved(184.001, "p-c", 2, 2, 3), // seq 12: CRASH
      e(250, "PENALTY", "p-a", "lap" -> n(3), "seconds" -> n(5), "reason" -> s("TRACK_LIMITS")),
      lap(272, "p-c", 3, 88000, 1),
      moved(272.001, "p-c", 3, 3, 1), // seq 15: OVERTAKE
      lap(273, "p-a", 3, 92000, 2),
      moved(273.001, "p-a", 3, 1, 2), // seq 17: OVERTAKEN
      lap(276, "p-b", 3, 94500, 3),
      moved(276.001, "p-b", 3, 2, 3), // seq 19: OVERTAKEN
      sys(
        277,
        "MATCH_FINISHED",
        "durationMs" -> n(277000),
        "results" -> results("p-c" -> 1, "p-b" -> 2, "p-a" -> 3)
      )
    ),
    action = Map(
      8 -> "OVERTAKE",
      10 -> "PIT",
      12 -> "CRASH",
      15 -> "OVERTAKE",
      17 -> "OVERTAKEN",
      19 -> "OVERTAKEN"
    )
  )

  val analysis: MatchAnalysis = RacingAnalyzer.analyze(race)

  def metric(p: String, name: String): Json =
    analysis.players
      .find(_.playerId == p)
      .flatMap(_.metrics.get(name))
      .getOrElse(fail(s"$p has no $name"))

  test("R1: best lap, average and population standard deviation") {
    // p-a: avg 91000; deviations -1000, 0, +1000 -> sqrt(2,000,000 / 3) = 816.5
    assertEquals(metric("p-a", "bestLapMs"), Json.fromLong(90000))
    assertEquals(metric("p-a", "avgLapMs"), Metrics.num(91000))
    assertEquals(metric("p-a", "lapStdDevMs"), Metrics.num(816.5))
    // p-c: avg 90666.7; deviations -1666.7, +4333.3, -2666.7 -> sqrt(28,666,667 / 3) = 3091.2
    assertEquals(metric("p-c", "avgLapMs"), Metrics.num(90666.7))
    assertEquals(metric("p-c", "lapStdDevMs"), Metrics.num(3091.2))
  }

  test("R2: consistency = 1 - stdDev / avg, 3 decimals, built from R1 with andThen") {
    // p-a: 1 - 816.5 / 91000 = 0.991; p-b: 1 - 2549.5 / 92000 = 0.972; p-c: 1 - 3091.2 / 90666.7 = 0.966
    assertEquals(metric("p-a", "consistency"), Json.fromDoubleOrNull(0.991))
    assertEquals(metric("p-b", "consistency"), Json.fromDoubleOrNull(0.972))
    assertEquals(metric("p-c", "consistency"), Json.fromDoubleOrNull(0.966))
    assertEquals(RacingStats.consistencyOf(List(92000L, 92000L, 92000L)), Some(1.0))
    assertEquals(RacingStats.consistencyOf(Nil), None)
  }

  test("R3: position after lap 1 minus final placement") {
    // p-a 3 -> 3 = 0; p-b 1 -> 2 = -1; p-c 2 -> 1 = +1
    assertEquals(metric("p-a", "positionsGained"), Json.fromLong(0))
    assertEquals(metric("p-b", "positionsGained"), Json.fromLong(-1))
    assertEquals(metric("p-c", "positionsGained"), Json.fromLong(1))
    assertEquals(analysis.players.map(_.playerId), List("p-c", "p-b", "p-a"))
  }

  test("R4: OVERTAKE changes per driver") {
    assertEquals(metric("p-a", "overtakes"), Json.fromLong(1))
    assertEquals(metric("p-b", "overtakes"), Json.fromLong(0))
    assertEquals(metric("p-c", "overtakes"), Json.fromLong(1))
  }

  test("R5: fastest lap, overtakes, crashes and penalty seconds of the race") {
    val m = analysis.matchMetrics
    assertEquals(m("fastestLapMs"), Json.fromLong(88000))
    assertEquals(m("fastestLapPlayer"), Json.fromString("p-c"))
    assertEquals(m("overtakes"), Json.fromInt(2))
    assertEquals(m("crashes"), Json.fromInt(1))
    assertEquals(m("penaltySeconds"), Metrics.num(5))
  }

  test("R6: incident lap minus average of clean laps, plus penalty seconds") {
    // p-a: clean laps 1-2 avg 90500; lap 3 = 92000 -> 1500 + 5000 = 6500
    // p-c: clean laps 1, 3 avg 88500; lap 2 = 95000 -> 6500
    assertEquals(metric("p-a", "incidentImpactMs"), Json.fromLong(6500))
    assertEquals(metric("p-c", "incidentImpactMs"), Json.fromLong(6500))
    assertEquals(metric("p-b", "incidentImpactMs"), Json.fromLong(0))
  }

  test("R7: average of the laps after the stop minus the laps before") {
    // p-b stops in lap 2: before = lap 1 (88500), after = lap 3 (94500) -> +6000
    assertEquals(metric("p-b", "pitEffectMs"), Metrics.num(6000))
    assert(analysis.players.find(_.playerId == "p-a").forall(!_.metrics.contains("pitEffectMs")))
  }

  test("a PARTIAL race has no placements and no R3") {
    val partial = RacingAnalyzer.analyze(race.copy(status = BatchStatus.PARTIAL))
    assert(
      partial.players.forall(p => p.placement.isEmpty && !p.metrics.contains("positionsGained"))
    )
    assert(partial.players.forall(_.metrics.contains("consistency")))
  }

  test("rp-scn-steady: the marked driver has the highest consistency") {
    val result = RacingAnalyzer.analyze(Samples.scenario("rp-scn-steady"))
    val byDriver =
      result.players.map(p => p.playerId -> p.metrics("consistency").asNumber.get.toDouble).toMap
    val best = byDriver.maxBy(_._2)
    assertEquals(best._1, "p-kev", s"consistency by driver: $byDriver")
    assert(byDriver.removed("p-kev").values.forall(_ < best._2))
  }

  test("rp-scn-comeback: the crash costs p-ana about 20 s") {
    val result = RacingAnalyzer.analyze(Samples.scenario("rp-scn-comeback"))
    val ana = result.players.find(_.playerId == "p-ana").get
    assertEquals(ana.placement, Some(2))
    assertEquals(
      ana.metrics("positionsGained"),
      Json.fromLong(-1)
    ) // 1st after lap 1, 2nd at the end
    assert(ana.metrics("incidentImpactMs").asNumber.flatMap(_.toLong).exists(_ > 19000))
  }
