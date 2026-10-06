package gamestats.analysis.arena

import gamestats.analysis.Metrics
import gamestats.fixtures.Fixtures.*
import gamestats.fixtures.Samples
import gamestats.model.*
import io.circe.Json

/** A 2 vs 2 match with every expected value worked out by hand.
  *
  * t (s) event 5 p-r1 picks a WEAPON 10-12 p-r1 hits p-b1 for 30 (headshot) and 40 19 p-r2 hits
  * p-b1 for 20 20 p-r1 eliminates p-b1 (RIFLE, 25 m), assist p-r2 <- first blood 30 p-b2 hits p-r1
  * for 50 (headshot) 31 p-b2 eliminates p-r1 (SNIPER, 60.5 m) 40 p-b2 picks a WEAPON (no kill after
  * it) 50 p-r2 hits p-b2 for 25 52 p-r2 eliminates p-b2 (SMG, 8 m) 55 p-r1 picks HEALTH (not a
  * weapon) 60 p-r1 picks a WEAPON (no kill after it) 70 RED wins 2 to 1
  */
class ArenaStatsSuite extends munit.FunSuite:

  def hit(
      t: Double,
      p: String,
      target: String,
      amount: Double,
      headshot: Boolean,
      dist: Double = 20
  ): Spec =
    e(
      t,
      "DAMAGE_DEALT",
      p,
      "targetId" -> s(target),
      "weapon" -> s("RIFLE"),
      "amount" -> n(amount),
      "distanceM" -> n(dist),
      "headshot" -> b(headshot)
    )

  def kill(
      t: Double,
      p: String,
      victim: String,
      weapon: String,
      dist: Double,
      assists: String*
  ): Spec =
    e(
      t,
      "PLAYER_ELIMINATED",
      p,
      "victimId" -> s(victim),
      "weapon" -> s(weapon),
      "distanceM" -> n(dist),
      "assistIds" -> arr(assists*)
    )

  def pick(t: Double, p: String, itemType: String): Spec =
    e(t, "ITEM_PICKED", p, "itemId" -> s(s"it-$t"), "itemType" -> s(itemType))

  val fight: MatchBatch = batch(
    "arena-clash",
    List(
      sys(
        0,
        "MATCH_STARTED",
        "players" -> arr("p-r1", "p-r2", "p-b1", "p-b2"),
        "mode" -> s("TDM"),
        "teams" -> Json.obj("RED" -> arr("p-r1", "p-r2"), "BLUE" -> arr("p-b1", "p-b2"))
      ),
      pick(5, "p-r1", "WEAPON"),
      hit(10, "p-r1", "p-b1", 30, headshot = true),
      hit(12, "p-r1", "p-b1", 40, headshot = false),
      hit(19, "p-r2", "p-b1", 20, headshot = false),
      kill(20, "p-r1", "p-b1", "RIFLE", 25, "p-r2"),
      hit(30, "p-b2", "p-r1", 50, headshot = true, dist = 60),
      kill(31, "p-b2", "p-r1", "SNIPER", 60.5),
      pick(40, "p-b2", "WEAPON"),
      hit(50, "p-r2", "p-b2", 25, headshot = false),
      kill(52, "p-r2", "p-b2", "SMG", 8),
      pick(55, "p-r1", "HEALTH"),
      pick(60, "p-r1", "WEAPON"),
      sys(
        70,
        "MATCH_FINISHED",
        "durationMs" -> n(70000),
        "results" -> results("p-r1" -> 1, "p-r2" -> 1, "p-b1" -> 2, "p-b2" -> 2),
        "winnerTeam" -> s("RED"),
        "score" -> Json.obj("RED" -> n(2), "BLUE" -> n(1))
      )
    )
  )

  val analysis: MatchAnalysis = ArenaAnalyzer.analyze(fight)

  def player(p: String): PlayerMatchStats = analysis.players.find(_.playerId == p).get
  def metric(p: String, name: String): Option[Json] = player(p).metrics.get(name)

  test("A1: eliminations, deaths, assists and K/D") {
    assertEquals(metric("p-r1", "kills"), Some(Json.fromLong(1)))
    assertEquals(metric("p-r1", "deaths"), Some(Json.fromLong(1)))
    assertEquals(metric("p-r2", "assists"), Some(Json.fromLong(1)))
    assertEquals(metric("p-b1", "kd"), Some(Metrics.num(0, 2)))
    // p-r2 never died: K/D = 1 / max(0, 1) = 1, no exception
    assertEquals(metric("p-r2", "deaths"), Some(Json.fromLong(0)))
    assertEquals(metric("p-r2", "kd"), Some(Metrics.num(1, 2)))
  }

  test("A2: damage, average per hit, headshot share and longest elimination") {
    // p-r1: 30 + 40 = 70 in 2 hits, 1 headshot
    assertEquals(metric("p-r1", "damageDealt"), Some(Metrics.num(70)))
    assertEquals(metric("p-r1", "avgDamagePerHit"), Some(Metrics.num(35)))
    assertEquals(metric("p-r1", "headshotPct"), Some(Metrics.num(50)))
    assertEquals(metric("p-b2", "longestKillM"), Some(Metrics.num(60.5)))
    // p-b1 never hit anyone: no average and no headshot share
    assertEquals(metric("p-b1", "damageDealt"), Some(Metrics.num(0)))
    assertEquals(metric("p-b1", "avgDamagePerHit"), None)
  }

  test("A3: score, winner, first blood, damage by team and MVP") {
    val m = analysis.matchMetrics
    assertEquals(m("score"), Json.obj("RED" -> Json.fromInt(2), "BLUE" -> Json.fromInt(1)))
    assertEquals(m("winnerTeam"), Json.fromString("RED"))
    assertEquals(m("firstBlood").hcursor.get[String]("playerId"), Right("p-r1"))
    assertEquals(m("firstBlood").hcursor.get[Long]("atMs"), Right(20000L))
    // RED: 70 + 45 = 115; BLUE: 50
    assertEquals(m("damageByTeam"), Json.obj("RED" -> Metrics.num(115), "BLUE" -> Metrics.num(50)))
    // MVP = 2 kills + assists + damage/100: p-r1 2.7, p-r2 2 + 1 + 0.45 = 3.45, p-b2 2.5
    assertEquals(
      m("mvp"),
      Json.obj("playerId" -> Json.fromString("p-r2"), "score" -> Metrics.num(3.45, 2))
    )
    assertEquals(
      m("killsByWeapon"),
      Json.obj("RIFLE" -> Json.fromInt(1), "SMG" -> Json.fromInt(1), "SNIPER" -> Json.fromInt(1))
    )
  }

  test("A4: damage per elimination, only for players who eliminated") {
    assertEquals(metric("p-r1", "damagePerKill"), Some(Metrics.num(70)))
    assertEquals(metric("p-r2", "damagePerKill"), Some(Metrics.num(45)))
    assertEquals(metric("p-b1", "damagePerKill"), None)
  }

  test("A5: weapon pickups followed by an elimination within 30 s") {
    // p-r1: pickup at 5 s -> kill at 20 s (yes); pickup at 60 s -> nothing. HEALTH does not count.
    assertEquals(metric("p-r1", "weaponConversionPct"), Some(Metrics.num(50)))
    assertEquals(metric("p-b2", "weaponConversionPct"), Some(Metrics.num(0)))
    assertEquals(metric("p-r2", "weaponConversionPct"), None)
  }

  test("teamId comes from MATCH_STARTED.teams") {
    assertEquals(player("p-r2").teamId, Some("RED"))
    assertEquals(player("p-b1").teamId, Some("BLUE"))
  }

  test("a PARTIAL match keeps the score but has no winner") {
    val partial = ArenaAnalyzer.analyze(fight.copy(status = BatchStatus.PARTIAL))
    assert(!partial.matchMetrics.contains("winnerTeam"))
    assertEquals(partial.matchMetrics("score"), analysis.matchMetrics("score"))
  }

  for id <- List("ac-scn-spree", "ac-scn-revenge", "ac-scn-teamback", "ac-scn-ragequit") do
    test(s"$id: the players' eliminations add up to the PLAYER_ELIMINATED events") {
      val batch = Samples.scenario(id)
      val result = ArenaAnalyzer.analyze(batch)
      val sum =
        result.players.flatMap(_.metrics.get("kills").flatMap(_.asNumber).flatMap(_.toLong)).sum
      assertEquals(sum, batch.events.count(_.eventType == "PLAYER_ELIMINATED").toLong)
    }

  test("ac-scn-teamback: BLUE wins 30 to 27") {
    val m = ArenaAnalyzer.analyze(Samples.scenario("ac-scn-teamback")).matchMetrics
    assertEquals(m("winnerTeam"), Json.fromString("BLUE"))
    assertEquals(m("score"), Json.obj("RED" -> Json.fromInt(27), "BLUE" -> Json.fromInt(30)))
  }
