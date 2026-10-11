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

  def pct(v: Double): (String, Json) = "correctPct" -> Json.fromDoubleOrNull(v)
  def gain(v: Long): (String, Json) = "netGain" -> Json.fromLong(v)
  val left: (String, Json) = "left" -> Json.True

  /** categoryTotals of a trivia match, as TriviaStats writes it. */
  def categories(cs: (String, Int, Int)*): Map[String, Json] =
    Map(
      "categoryTotals" -> Json.fromFields(
        cs.map((c, ok, total) =>
          c -> Json.obj("correct" -> Json.fromInt(ok), "total" -> Json.fromInt(total))
        )
      )
    )

  val all: List[MatchAnalysis] = List(
    analysis(
      "tv-1",
      "trivia",
      100,
      List(
        stats("p-ana", Some(1), pct(90)),
        stats("p-luis", Some(2), pct(80)),
        stats("p-sofi", Some(3), pct(70))
      ),
      matchMetrics = categories(("CIENCIA", 3, 4), ("HISTORIA", 1, 4)),
      patterns = List("P2"),
      durationMs = 900000
    ),
    analysis(
      "tv-2",
      "trivia",
      200,
      List(
        stats("p-ana", Some(3), pct(50)),
        stats("p-luis", Some(2), pct(90)),
        stats("p-sofi", Some(1), pct(60), left)
      ),
      matchMetrics = categories(("HISTORIA", 3, 4)),
      patterns = List("P1", "P2"),
      durationMs = 960000
    ),
    analysis(
      "tv-3",
      "trivia",
      300,
      List(stats("p-ana", None, pct(40), left), stats("p-luis", None)),
      partial = true,
      durationMs = 300000
    ),
    analysis(
      "bj-1",
      "blackjack",
      150,
      List(stats("p-kev", Some(1), gain(500)), stats("p-dani", Some(2), gain(-200), left)),
      patterns = List("P5")
    ),
    analysis(
      "bj-2",
      "blackjack",
      250,
      List(stats("p-kev", Some(2), gain(-100)), stats("p-dani", Some(1), gain(300)))
    )
  )

  test("recent matches: newest first, filtered by game and limited") {
    assertEquals(
      Aggregates.recentMatches(all, None, 3).map(_.matchId),
      List("tv-3", "bj-2", "tv-2")
    )
    assertEquals(
      Aggregates.recentMatches(all, Some("blackjack"), 20).map(_.matchId),
      List("bj-2", "bj-1")
    )
    assertEquals(
      Aggregates.recentMatches(all, None, 20).find(_.matchId == "tv-2").map(_.patterns),
      Some(2)
    )
  }

  test("a win is first place, in every game") {
    assert(Aggregates.isWin(Some(1)))
    assert(!Aggregates.isWin(Some(2)))
    assert(!Aggregates.isWin(None))
  }

  test("player profile per game: matches, wins and average of the tiebreak metric") {
    val ana = Aggregates.player(all, "p-ana").get
    // p-ana: 3 matches (1st, 3rd, partial), 1 win; % of right answers (90 + 50 + 40) / 3 = 60
    assertEquals(ana.games, List(PlayerGameStats("trivia", 3, 1, Some("correctPct"), Some(60.0))))
    // p-kev: 1 win; net gain (500 - 100) / 2 = 200
    assertEquals(
      Aggregates.player(all, "p-kev").get.games.map(g => (g.gameId, g.wins, g.avgMetric)),
      List(("blackjack", 1, Some(200.0)))
    )
    assertEquals(Aggregates.player(all, "nobody"), None)
  }

  test("leaderboard: wins first, then the metric, then the id") {
    // trivia wins: p-sofi 1 (avg 65), p-ana 1 (avg 60), p-luis 0 (avg 85)
    val board = Aggregates.leaderboard(all, "trivia", 20)
    assertEquals(board.metric, Some("correctPct"))
    assertEquals(
      board.entries.map(e => (e.rank, e.playerId, e.wins)),
      List((1, "p-sofi", 1), (2, "p-ana", 1), (3, "p-luis", 0))
    )
    // luis has no metric in the partial match: avg over the two that have it
    assertEquals(board.entries.find(_.playerId == "p-luis").flatMap(_.avgMetric), Some(85.0))
    assertEquals(Aggregates.leaderboard(all, "trivia", 1).entries.size, 1)
    assertEquals(Aggregates.leaderboard(all, "blackjack", 20).metric, Some("netGain"))
    assertEquals(Aggregates.leaderboard(all, "card-duel", 20).entries, Nil)
  }

  test("game summary: G4 abandonment rate, average duration and the game's own metrics") {
    val trivia = Aggregates.gameSummary(all, "trivia").get
    // 8 player entries, 2 with left = true
    assertEquals((trivia.playerEntries, trivia.playersLeft, trivia.abandonmentRate), (8, 2, 0.25))
    assertEquals(trivia.avgDurationMs, 720000.0) // (900000 + 960000 + 300000) / 3
    assertEquals(trivia.partialMatches, 1)
    assertEquals(trivia.patterns, Map("P1" -> 1, "P2" -> 2))
    // T5 through the trivia analyzer: CIENCIA 3/4 = 75 %, HISTORIA (1 + 3) / 8 = 50 %
    assertEquals(
      trivia.gameMetrics.get("hardestCategory"),
      Some(
        Json.obj(
          "category" -> Json.fromString("HISTORIA"),
          "correctPct" -> Json.fromBigDecimal(BigDecimal("50.0"))
        )
      )
    )
    assertEquals(Aggregates.gameSummary(all, "blackjack").map(_.gameMetrics), Some(Map.empty))
    assertEquals(Aggregates.gameSummary(all, "card-duel"), None)
  }

  test("patterns filtered by game and id, newest match first") {
    assertEquals(
      Aggregates.patterns(all, None, None, 100).map(p => (p.matchId, p.patternId)),
      List(("tv-2", "P1"), ("tv-2", "P2"), ("bj-1", "P5"), ("tv-1", "P2"))
    )
    assertEquals(
      Aggregates.patterns(all, Some("trivia"), Some("P2"), 100).map(_.matchId),
      List("tv-2", "tv-1")
    )
    assertEquals(Aggregates.patterns(all, None, None, 1).size, 1)
  }
