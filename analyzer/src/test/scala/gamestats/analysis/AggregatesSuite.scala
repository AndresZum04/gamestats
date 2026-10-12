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

  test("leaderboard of a game of several players: % of matches won, then the metric") {
    // trivia: p-sofi 1 of 2 = 50 %, p-ana 1 of 3 = 33.3 %, p-luis 0 of 3 = 0 %
    val board = Aggregates.leaderboard(all, "trivia", 20)
    assertEquals((board.metric, board.singlePlayer), (Some("correctPct"), false))
    assertEquals(
      board.entries.map(e => (e.rank, e.playerId, e.matches, e.wins, e.winPct)),
      List((1, "p-sofi", 2, 1, 50.0), (2, "p-ana", 3, 1, 33.3), (3, "p-luis", 3, 0, 0.0))
    )
    // luis has no metric in the partial match: avg over the two that have it
    assertEquals(board.entries.find(_.playerId == "p-luis").flatMap(_.avgMetric), Some(85.0))
    assertEquals(Aggregates.leaderboard(all, "trivia", 1).entries.size, 1)
    assertEquals(Aggregates.leaderboard(all, "card-duel", 20).entries, Nil)
  }

  test("more wins in total do not beat a better % of wins") {
    // p-kev wins 3 of 6 tables (50 %), p-dani 2 of 2 (100 %): p-dani is first with fewer wins
    val tables =
      (1 to 6).toList.map(i =>
        analysis(
          s"bj-k$i",
          "blackjack",
          i,
          List(stats("p-kev", Some(if i <= 3 then 1 else 2), gain(0)))
        )
      ) ++ (1 to 2).toList.map(i =>
        analysis(s"bj-d$i", "blackjack", 10 + i, List(stats("p-dani", Some(1), gain(0))))
      )
    val board = Aggregates.leaderboard(tables, "blackjack", 20)
    assertEquals((board.metric, board.singlePlayer), (Some("netGain"), false))
    assertEquals(
      board.entries.map(e => (e.playerId, e.wins, e.winPct)),
      List(("p-dani", 2, 100.0), ("p-kev", 3, 50.0))
    )
  }

  test("on the same % of wins, the metric decides, then more matches played") {
    // p-kev and p-dani both win 1 of 2 in all: p-kev has the higher net gain (200 against 50)
    assertEquals(
      Aggregates
        .leaderboard(all, "blackjack", 20)
        .entries
        .map(e => (e.playerId, e.winPct, e.avgMetric)),
      List(("p-kev", 50.0, Some(200.0)), ("p-dani", 50.0, Some(50.0)))
    )
  }

  /** A snake match: one player, always first. */
  def snake(id: String, player: String, length: Int): MatchAnalysis =
    analysis(id, "snake", 0, List(stats(player, Some(1), "maxLength" -> Json.fromInt(length))))

  test("leaderboard of a single player game: the metric, then more matches played") {
    val matches = List(
      snake("sn-1", "p-mari", 20),
      snake("sn-2", "p-mari", 18),
      snake("sn-3", "p-mari", 22),
      snake("sn-4", "p-rafa", 23), // one match, the best average: first
      snake("sn-5", "p-lu", 20), // average 20, 1 match
      snake("sn-6", "p-noe", 19),
      snake("sn-7", "p-noe", 21) // average 20, 2 matches: before p-lu
    )
    val board = Aggregates.leaderboard(matches, "snake", 20)
    assertEquals((board.metric, board.singlePlayer), (Some("maxLength"), true))
    // p-mari has the most wins (3) but an average of 20, like p-noe and p-lu; with 3 matches she
    // goes first of the three
    assertEquals(
      board.entries.map(e => (e.rank, e.playerId, e.matches, e.avgMetric)),
      List(
        (1, "p-rafa", 1, Some(23.0)),
        (2, "p-mari", 3, Some(20.0)),
        (3, "p-noe", 2, Some(20.0)),
        (4, "p-lu", 1, Some(20.0))
      )
    )
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
