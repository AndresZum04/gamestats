package gamestats.analysis

import gamestats.model.*
import io.circe.Json

import java.time.Instant

class AggregatesSuite extends munit.FunSuite:

  def stats(p: String, placement: Option[Int], metrics: (String, Json)*): PlayerMatchStats =
    PlayerMatchStats(p, placement, None, metrics.toMap)

  def analysis(
      id: String,
      game: String,
      at: Long,
      players: List[PlayerMatchStats],
      partial: Boolean = false,
      matchMetrics: Map[String, Json] = Map.empty,
      patterns: List[String] = Nil,
      durationMs: Long = 1000
  ): MatchAnalysis =
    MatchAnalysis(
      id,
      game,
      partial,
      Instant.ofEpochSecond(at),
      durationMs,
      Map("X" -> 1),
      matchMetrics,
      players,
      patterns.map(pid => PatternMatch(pid, pid, game, id, None, None, 0, "", Nil))
    )

  def c(v: Double): (String, Json) = "consistency" -> Json.fromDoubleOrNull(v)
  def kd(v: Double): (String, Json) = "kd" -> Json.fromDoubleOrNull(v)
  val left: (String, Json) = "left" -> Json.True
  def weapons(ws: (String, Int)*): Map[String, Json] =
    Map("killsByWeapon" -> Json.fromFields(ws.map((w, n) => w -> Json.fromInt(n))))

  val all: List[MatchAnalysis] = List(
    // racing: a podium is a win
    analysis(
      "rp-1",
      "racing-pro",
      100,
      List(
        stats("p-ana", Some(1), c(0.99)),
        stats("p-luis", Some(4), c(0.98)),
        stats("p-sofi", Some(3), c(0.97))
      ),
      patterns = List("P2"),
      durationMs = 900000
    ),
    analysis(
      "rp-2",
      "racing-pro",
      200,
      List(
        stats("p-ana", Some(5), c(0.95)),
        stats("p-luis", Some(2), c(0.99)),
        stats("p-sofi", Some(1), c(0.96), left)
      ),
      patterns = List("P1", "P2"),
      durationMs = 960000
    ),
    analysis(
      "rp-3",
      "racing-pro",
      300,
      List(stats("p-ana", None, c(0.90), left), stats("p-luis", None)),
      partial = true,
      durationMs = 300000
    ),
    // combat: first place (winning team) is a win
    analysis(
      "ac-1",
      "arena-clash",
      150,
      List(stats("p-kev", Some(1), kd(2.0)), stats("p-dani", Some(2), kd(0.5), left)),
      matchMetrics = weapons("RIFLE" -> 10, "SMG" -> 4),
      patterns = List("P4")
    ),
    analysis(
      "ac-2",
      "arena-clash",
      250,
      List(stats("p-kev", Some(2), kd(1.0)), stats("p-dani", Some(1), kd(1.5))),
      matchMetrics = weapons("SMG" -> 9, "SNIPER" -> 2)
    )
  )

  test("recent matches: newest first, filtered by game and limited") {
    assertEquals(
      Aggregates.recentMatches(all, None, 3).map(_.matchId),
      List("rp-3", "ac-2", "rp-2")
    )
    assertEquals(
      Aggregates.recentMatches(all, Some("arena-clash"), 20).map(_.matchId),
      List("ac-2", "ac-1")
    )
    assertEquals(
      Aggregates.recentMatches(all, None, 20).find(_.matchId == "rp-2").map(_.patterns),
      Some(2)
    )
  }

  test("a win is a podium in racing and first place elsewhere") {
    assert(Aggregates.isWin("racing-pro", Some(3)))
    assert(!Aggregates.isWin("racing-pro", Some(4)))
    assert(!Aggregates.isWin("arena-clash", Some(2)))
    assert(!Aggregates.isWin("chess-lite", None))
  }

  test("player profile per game: matches, wins and average of the tiebreak metric") {
    val ana = Aggregates.player(all, "p-ana").get
    // p-ana: 3 races (1st, 5th, partial), 1 win; consistency (0.99 + 0.95 + 0.90) / 3 = 0.947
    assertEquals(
      ana.games,
      List(PlayerGameStats("racing-pro", 3, 1, Some("consistency"), Some(0.947)))
    )
    assertEquals(
      Aggregates.player(all, "p-kev").get.games.map(g => (g.gameId, g.wins, g.avgMetric)),
      List(("arena-clash", 1, Some(1.5)))
    )
    assertEquals(Aggregates.player(all, "nobody"), None)
  }

  test("leaderboard: wins first, then the metric, then the id") {
    // racing wins: p-sofi 2 (3rd, 1st), p-ana 1, p-luis 1 (2nd); ana avg 0.947 < luis avg 0.985
    val board = Aggregates.leaderboard(all, "racing-pro", 20)
    assertEquals(board.metric, Some("consistency"))
    assertEquals(
      board.entries.map(e => (e.rank, e.playerId, e.wins)),
      List((1, "p-sofi", 2), (2, "p-luis", 1), (3, "p-ana", 1))
    )
    // luis has no metric in the partial race: avg over the two that have it
    assertEquals(board.entries.find(_.playerId == "p-luis").flatMap(_.avgMetric), Some(0.985))
    assertEquals(Aggregates.leaderboard(all, "racing-pro", 1).entries.size, 1)
    assertEquals(Aggregates.leaderboard(all, "chess-lite", 20).entries, Nil)
  }

  test("game summary: G4 abandonment rate, A6 weapon, average duration") {
    val racing = Aggregates.gameSummary(all, "racing-pro").get
    // 8 player entries, 2 with left = true
    assertEquals((racing.playerEntries, racing.playersLeft, racing.abandonmentRate), (8, 2, 0.25))
    assertEquals(racing.avgDurationMs, 720000.0) // (900000 + 960000 + 300000) / 3
    assertEquals(racing.partialMatches, 1)
    assertEquals(racing.patterns, Map("P1" -> 1, "P2" -> 2))

    val arena = Aggregates.gameSummary(all, "arena-clash").get
    // SMG 4 + 9 = 13 beats RIFLE 10
    assertEquals(arena.mostEffectiveWeapon, Some(WeaponStat("SMG", 13)))
    assertEquals(arena.weapons.map(_.weapon), List("SMG", "RIFLE", "SNIPER"))
    assertEquals(Aggregates.gameSummary(all, "chess-lite"), None)
  }

  test("patterns filtered by game and id, newest match first") {
    assertEquals(
      Aggregates.patterns(all, None, None, 100).map(p => (p.matchId, p.patternId)),
      List(("rp-2", "P1"), ("rp-2", "P2"), ("ac-1", "P4"), ("rp-1", "P2"))
    )
    assertEquals(
      Aggregates.patterns(all, Some("racing-pro"), Some("P2"), 100).map(_.matchId),
      List("rp-2", "rp-1")
    )
    assertEquals(Aggregates.patterns(all, None, None, 1).size, 1)
  }
