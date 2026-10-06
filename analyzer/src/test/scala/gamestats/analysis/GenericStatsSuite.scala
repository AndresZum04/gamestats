package gamestats.analysis

import gamestats.fixtures.Fixtures.*
import gamestats.model.*
import io.circe.Json

import java.time.Instant

class GenericStatsSuite extends munit.FunSuite:

  /** A chess-like match: two players, turns, captures, a disconnection. */
  val chess: MatchBatch = batch(
    "chess-lite",
    List(
      sys(0, "MATCH_STARTED", "players" -> arr("p-ana", "p-luis"), "mode" -> s("CLASSICAL")),
      e(2, "TURN_ENDED", "p-ana", "turn" -> n(1), "durationMs" -> n(4000)),
      e(3, "SCORE_CHANGED", "p-ana", "delta" -> n(3), "total" -> n(3)),
      e(8, "TURN_ENDED", "p-luis", "turn" -> n(2), "durationMs" -> n(6000)),
      e(9, "SCORE_CHANGED", "p-ana", "delta" -> n(1), "total" -> n(4)),
      e(10, "PLAYER_DISCONNECTED", "p-luis"),
      e(14, "PLAYER_RECONNECTED", "p-luis", "awayMs" -> n(4000)),
      e(15, "TURN_ENDED", "p-ana", "turn" -> n(3), "durationMs" -> n(10000)),
      e(16, "SCORE_CHANGED", "p-ana", "delta" -> n(-1), "total" -> n(3)),
      e(17, "SCORE_CHANGED", "p-ana", "delta" -> n(5), "total" -> n(8)),
      e(20, "PLAYER_DISCONNECTED", "p-luis"),
      e(23, "PLAYER_RECONNECTED", "p-luis", "awayMs" -> n(3000)),
      e(25, "PLAYER_LEFT", "p-luis", "reason" -> s("QUIT")),
      sys(
        30,
        "MATCH_FINISHED",
        "durationMs" -> n(30000),
        "results" -> results("p-ana" -> 1, "p-luis" -> 2)
      )
    )
  )

  val analysis: MatchAnalysis = GenericAnalyzer("chess-lite").analyze(chess)

  def metric(p: String, name: String): Option[Json] =
    analysis.players.find(_.playerId == p).flatMap(_.metrics.get(name))

  test("G1 counts events by type") {
    assertEquals(analysis.eventsByType("TURN_ENDED"), 3)
    assertEquals(analysis.eventsByType("SCORE_CHANGED"), 4)
    assertEquals(analysis.eventsByType.values.sum, 14)
  }

  test("G2 takes durationMs from MATCH_FINISHED, or first to last event when PARTIAL") {
    assertEquals(analysis.durationMs, 30000L)
    val partial = chess.copy(events = chess.events.dropRight(1), status = BatchStatus.PARTIAL)
    assertEquals(GenericAnalyzer("chess-lite").analyze(partial).durationMs, 25000L)
    assertEquals(GenericStats.durationMs(Nil), 0L)
  }

  test("G3 counts disconnections and adds the time away; G4 marks who left") {
    assertEquals(metric("p-luis", "disconnections"), Some(Json.fromLong(2)))
    assertEquals(metric("p-luis", "awayMs"), Some(Json.fromLong(7000)))
    assertEquals(metric("p-luis", "left"), Some(Json.True))
    assertEquals(metric("p-ana", "disconnections"), Some(Json.fromLong(0)))
    assertEquals(metric("p-ana", "left"), Some(Json.False))
    assertEquals(analysis.matchMetrics("playersLeft"), Json.fromLong(1))
  }

  test("G5 final score is the last total; streak counts positive deltas in a row") {
    // deltas +3, +1, -1, +5: the longest run of positives is 2
    assertEquals(metric("p-ana", "finalScore"), Some(Metrics.num(8)))
    assertEquals(metric("p-ana", "longestScoreStreak"), Some(Json.fromLong(2)))
    assertEquals(metric("p-luis", "finalScore"), None)
  }

  test("G6 averages and maximum of TURN_ENDED") {
    // p-ana: 4000 and 10000 ms
    assertEquals(metric("p-ana", "avgTurnMs"), Some(Metrics.num(7000)))
    assertEquals(metric("p-ana", "maxTurnMs"), Some(Json.fromLong(10000)))
    assertEquals(metric("p-luis", "turns"), Some(Json.fromLong(1)))
  }

  test("placements come from MATCH_FINISHED and players are sorted by them") {
    assertEquals(
      analysis.players.map(p => p.playerId -> p.placement),
      List("p-ana" -> Some(1), "p-luis" -> Some(2))
    )
  }

  test("a PARTIAL match has no placements, even if results came in") {
    val partial = GenericAnalyzer("chess-lite").analyze(chess.copy(status = BatchStatus.PARTIAL))
    assert(partial.partial)
    assert(partial.players.forall(_.placement.isEmpty))
  }

  test("the analysis is deterministic") {
    assertEquals(GenericAnalyzer("chess-lite").analyze(chess), analysis)
  }

  test("adding a game: an object extending ComposedAnalyzer plus one registry entry") {
    object CardDuelAnalyzer extends ComposedAnalyzer[Event]:
      val gameId = "card-duel"
      protected def toTyped(e: Event, start: Instant): Option[Event] =
        Option.when(e.eventType == "CARD_PLAYED")(e)
      override protected def matchMetrics(ctx: MatchContext[Event]): Map[String, Json] =
        Map("cardsPlayed" -> Json.fromInt(ctx.events.size))

    val registry = AnalyzerRegistry.from(List(CardDuelAnalyzer))
    val cards = batch(
      "card-duel",
      List(
        e(1, "CARD_PLAYED", "p-ana"),
        e(2, "CARD_PLAYED", "p-luis"),
        e(3, "SCORE_CHANGED", "p-ana", "delta" -> n(2), "total" -> n(2))
      )
    )
    val result = AnalyzerRegistry.forGame("card-duel", registry).analyze(cards)
    assertEquals(result.matchMetrics("cardsPlayed"), Json.fromInt(2))
    assert(
      result.players.exists(_.metrics.contains("finalScore")),
      "generic stats must still apply"
    )
    assertEquals(AnalyzerRegistry.forGame("unknown-game"), GenericAnalyzer("unknown-game"))
  }
