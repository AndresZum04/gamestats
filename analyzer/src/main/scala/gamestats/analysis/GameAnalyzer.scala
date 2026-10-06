package gamestats.analysis

import gamestats.model.*

/** Turns a match batch into its analysis. Implementations are pure: the same batch always gives the
  * same result. analyzedAt is set to the batch's sentAt; the HTTP layer replaces it with the real
  * clock.
  */
trait GameAnalyzer:
  def gameId: String
  def analyze(batch: MatchBatch): MatchAnalysis

object AnalyzerRegistry:
  /** Games with their own analyzer. RacingAnalyzer and ArenaAnalyzer are added in T13 and T14.
    */
  val all: Map[String, GameAnalyzer] = Map.empty

  /** A game without its own analyzer is not an error: it gets the generic statistics.
    */
  def forGame(gameId: String): GameAnalyzer =
    all.getOrElse(gameId, GenericAnalyzer(gameId))

/** Statistics shared by every game (G1, G2). Used for chess-lite and for any game registered only
  * through its config.
  */
final case class GenericAnalyzer(gameId: String) extends GameAnalyzer:
  def analyze(batch: MatchBatch): MatchAnalysis =
    MatchAnalysis(
      matchId = batch.matchId,
      gameId = batch.gameId,
      partial = batch.partial,
      analyzedAt = batch.sentAt,
      durationMs = GenericStats.durationMs(batch.events),
      eventsByType = GenericStats.eventsByType(batch.events),
      matchMetrics = Map.empty,
      players = batch.players.map(PlayerMatchStats(_, None, None, Map.empty)),
      patterns = Nil
    )
