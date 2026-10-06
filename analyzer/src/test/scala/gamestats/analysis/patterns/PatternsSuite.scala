package gamestats.analysis.patterns

import gamestats.analysis.{AnalyzerRegistry, MatchContext}
import gamestats.codec.Typed
import gamestats.fixtures.Fixtures.*
import gamestats.fixtures.Samples
import gamestats.model.*
import io.circe.Json

/** One positive and one "almost" case per pattern, then the simulator's scenarios, each of which
  * must produce exactly its own pattern.
  */
class PatternsSuite extends munit.FunSuite:

  // ---------- racing helpers ----------

  /** laps: player -> list of (lapTimeMs, position) for laps 1, 2, ... */
  def race(
      laps: Map[String, List[(Long, Int)]],
      placements: (String, Int)*
  ): MatchContext[RacingEvent] =
    val lapSpecs = laps.toList
      .flatMap((p, ls) => ls.zipWithIndex.map { case ((t, pos), i) => (i + 1, pos, p, t) })
      .sorted
      .map((lap, pos, p, t) =>
        e(
          lap * 100.0 + pos,
          "LAP_COMPLETED",
          p,
          "lap" -> n(lap),
          "lapTimeMs" -> n(t.toDouble),
          "position" -> n(pos),
          "topSpeedKmh" -> n(300)
        )
      )
    val specs =
      List(
        sys(0, "MATCH_STARTED", "players" -> arr(laps.keys.toList.sorted*), "mode" -> s("GP"))
      ) ++
        lapSpecs ++
        List(
          sys(5000, "MATCH_FINISHED", "durationMs" -> n(5000000), "results" -> results(placements*))
        )
    MatchContext.build(batch("racing-pro", specs), Typed.toRacing)

  val sixDrivers = List("p-a" -> 2, "p-b" -> 4, "p-c" -> 1, "p-d" -> 3, "p-e" -> 5, "p-f" -> 6)

  def steadyLaps(positions: Int*): List[(Long, Int)] =
    positions.toList.zipWithIndex.map((pos, i) => ((if i % 2 == 0 then 90000L else 93000L), pos))

  test("P1 positive: in the last three from lap 2 on, then on the podium") {
    val ctx = race(
      Map(
        "p-a" -> steadyLaps(1, 6, 4),
        "p-b" -> steadyLaps(2, 2, 4),
        "p-c" -> steadyLaps(3, 1, 1),
        "p-d" -> steadyLaps(4, 3, 3),
        "p-e" -> steadyLaps(5, 4, 5),
        "p-f" -> steadyLaps(6, 5, 6)
      ),
      sixDrivers*
    )
    val found = Comeback.detect(ctx)
    assertEquals(found.map(_.playerId), List(Some("p-a")))
    assert(found.head.description.contains("posición 6 en la vuelta 2"))
  }

  test("P1 almost: last three only in lap 1, or last three but finished 4th") {
    val ctx = race(
      Map(
        "p-a" -> steadyLaps(6, 3, 2),
        "p-b" -> steadyLaps(2, 5, 4),
        "p-c" -> steadyLaps(3, 1, 1),
        "p-d" -> steadyLaps(4, 3, 3),
        "p-e" -> steadyLaps(5, 4, 5),
        "p-f" -> steadyLaps(1, 6, 6)
      ),
      sixDrivers*
    )
    assertEquals(
      Comeback.detect(ctx),
      Nil
    ) // p-a: 6th only in lap 1; p-b: 5th in lap 2 but finished 4th
  }

  test("P1 needs the final result: nothing for a PARTIAL race") {
    val ctx = race(Map("p-a" -> steadyLaps(1, 6, 4)), sixDrivers*)
    val partial =
      ctx.copy(batch = ctx.batch.copy(status = BatchStatus.PARTIAL), placements = Map.empty)
    assertEquals(Comeback.detect(partial), Nil)
  }

  def timed(times: Long*): List[(Long, Int)] = times.toList.map(_ -> 1)

  test("P2 positive: overlapping steady windows are one streak") {
    // windows 1-3 and 2-4 are within 1 %; window 3-5 is not
    val ctx = race(Map("p-a" -> timed(90000, 90100, 90200, 90300, 99000)), "p-a" -> 1)
    val found = ConsistentStreak.detect(ctx)
    assertEquals(found.size, 1)
    assert(found.head.description.contains("vueltas 1 a 4"), found.head.description)
    assertEquals(found.head.evidence.size, 4)
  }

  test("P2 almost: three laps 1.1 % away from their average") {
    // avg 91000; 90000 and 92000 are 1000 ms = 1.099 % away
    val ctx = race(Map("p-a" -> timed(90000, 91000, 92000)), "p-a" -> 1)
    assertEquals(ConsistentStreak.detect(ctx), Nil)
  }

  // ---------- arena helpers ----------

  val teams: Json = Json.obj("RED" -> arr("p-a", "p-b", "p-c"), "BLUE" -> arr("p-x", "p-y", "p-z"))

  /** kills: (seconds, killer, victim); leaves: (seconds, player). */
  def fight(
      kills: List[(Double, String, String)],
      winner: String = "RED",
      leaves: List[(Double, String)] = Nil
  ): MatchContext[ArenaEvent] =
    val killSpecs = kills.map((t, k, v) =>
      e(
        t,
        "PLAYER_ELIMINATED",
        k,
        "victimId" -> s(v),
        "weapon" -> s("RIFLE"),
        "distanceM" -> n(20),
        "assistIds" -> arr()
      )
    )
    val leaveSpecs = leaves.map((t, p) => e(t, "PLAYER_LEFT", p, "reason" -> s("QUIT")))
    val started = sys(
      0,
      "MATCH_STARTED",
      "players" -> arr("p-a", "p-b", "p-c", "p-x", "p-y", "p-z"),
      "mode" -> s("TDM"),
      "teams" -> teams
    )
    val finished = sys(
      900,
      "MATCH_FINISHED",
      "durationMs" -> n(900000),
      "results" -> results(),
      "winnerTeam" -> s(winner)
    )
    val specs = List(started) ++ (killSpecs ++ leaveSpecs).sortBy(_.at) ++ List(finished)
    MatchContext.build(batch("arena-clash", specs), Typed.toArena)

  test("P3 positive: 3 kills in 10 s; 4 kills in 8 s is one streak") {
    assertEquals(
      KillStreak.detect(fight(List((0, "p-a", "p-x"), (4, "p-a", "p-y"), (10, "p-a", "p-z")))).size,
      1
    )
    val four = KillStreak.detect(
      fight(
        List((100, "p-a", "p-x"), (102, "p-a", "p-y"), (105, "p-a", "p-z"), (108, "p-a", "p-x"))
      )
    )
    assertEquals(four.map(_.evidence.size), List(4))
    assert(four.head.description.contains("4 rivales en 8 s"), four.head.description)
  }

  test("P3 almost: third kill at 10.5 s, or a death in between") {
    assertEquals(
      KillStreak.detect(fight(List((0, "p-a", "p-x"), (4, "p-a", "p-y"), (10.5, "p-a", "p-z")))),
      Nil
    )
    assertEquals(
      KillStreak.detect(
        fight(List((0, "p-a", "p-x"), (4, "p-a", "p-y"), (6, "p-x", "p-a"), (8, "p-a", "p-z")))
      ),
      Nil
    )
  }

  test("P4 positive: B eliminates A 60 s after A eliminated B") {
    val found = Revenge.detect(fight(List((10, "p-a", "p-x"), (70, "p-x", "p-a"))))
    assertEquals(found.map(f => (f.playerId, f.evidence.size)), List((Some("p-x"), 2)))
  }

  test("P4 almost: 61 s later, or B eliminates someone else") {
    assertEquals(Revenge.detect(fight(List((10, "p-a", "p-x"), (71, "p-x", "p-a")))), Nil)
    assertEquals(Revenge.detect(fight(List((10, "p-a", "p-x"), (20, "p-x", "p-b")))), Nil)
  }

  def series(
      start: Double,
      killer: String,
      victim: String,
      count: Int
  ): List[(Double, String, String)] =
    (0 until count).toList.map(i => (start + i * 20.0, killer, victim))

  test("P5 positive: BLUE was 5 behind and won") {
    val ctx = fight(series(0, "p-a", "p-x", 5) ++ series(200, "p-x", "p-a", 6), winner = "BLUE")
    val found = TeamComeback.detect(ctx)
    assertEquals(found.map(_.teamId), List(Some("BLUE")))
    assert(
      found.head.description.contains("5 eliminaciones abajo (0 a 5) y ganó 6 a 5"),
      found.head.description
    )
  }

  test("P5 almost: only 4 behind") {
    assertEquals(
      TeamComeback.detect(
        fight(series(0, "p-a", "p-x", 4) ++ series(200, "p-x", "p-a", 5), winner = "BLUE")
      ),
      Nil
    )
  }

  test("P6 positive: 3 deaths in 60 s and leaving 29 s later") {
    val ctx = fight(
      List((0, "p-a", "p-x"), (30, "p-b", "p-x"), (60, "p-c", "p-x")),
      leaves = List((89, "p-x"))
    )
    assertEquals(
      RageQuit.detect(ctx).map(f => (f.playerId, f.evidence.size)),
      List((Some("p-x"), 4))
    )
  }

  test("P6 almost: leaving 30 s later, or the deaths spread over 61 s") {
    val late = fight(
      List((0, "p-a", "p-x"), (30, "p-b", "p-x"), (60, "p-c", "p-x")),
      leaves = List((90, "p-x"))
    )
    assertEquals(RageQuit.detect(late), Nil)
    val spread = fight(
      List((0, "p-a", "p-x"), (30, "p-b", "p-x"), (61, "p-c", "p-x")),
      leaves = List((70, "p-x"))
    )
    assertEquals(RageQuit.detect(spread), Nil)
  }

  // ---------- simulator scenarios ----------

  val expected = List(
    "rp-scn-comeback" -> ("P1", Some("p-ana"), None),
    "rp-scn-steady" -> ("P2", Some("p-kev"), None),
    "ac-scn-spree" -> ("P3", Some("p-ana"), Some("RED")),
    "ac-scn-revenge" -> ("P4", Some("p-tomi"), Some("BLUE")),
    "ac-scn-teamback" -> ("P5", None, Some("BLUE")),
    "ac-scn-ragequit" -> ("P6", Some("p-gabo"), Some("BLUE"))
  )

  for (matchId, (patternId, player, team)) <- expected do
    test(s"$matchId produces exactly $patternId") {
      val batch = Samples.scenario(matchId)
      val found = AnalyzerRegistry.forGame(batch.gameId).analyze(batch).patterns
      assertEquals(
        found.map(p => (p.patternId, p.playerId, p.teamId)),
        List((patternId, player, team))
      )
      val ids = batch.events.map(_.eventId).toSet
      assert(
        found.head.evidence.nonEmpty && found.head.evidence.forall(ids),
        "evidence must point to events of the batch"
      )
    }
