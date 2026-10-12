package gamestats.analysis

import gamestats.codec.Typed
import gamestats.model.*
import gamestats.model.CommonEvent.*
import io.circe.Json

import java.time.Instant

/** Turns a match batch into its analysis. Implementations are pure: the same batch always gives the
  * same result. analyzedAt is set to the batch's sentAt; the HTTP layer replaces it with the real
  * clock.
  */
trait GameAnalyzer:
  def gameId: String
  def analyze(batch: MatchBatch): MatchAnalysis

  /** Statistics of the whole game, over every stored match of it (T5, S5). Read by the game
    * summary; empty by default.
    */
  def gameMetrics(matches: List[MatchAnalysis]): Map[String, Json] = Map.empty

/** A pattern detector reads the context of a match and returns what it found (possibly nothing).
  */
type PatternDetector[E] = MatchContext[E] => List[PatternMatch]

/** Everything an analyzer needs about one match, computed once.
  *
  * @param events
  *   the game's typed events (E), in seq order
  * @param teams
  *   player -> team, from MATCH_STARTED, PLAYER_JOINED and results
  * @param placements
  *   player -> final placement; empty for PARTIAL matches, whose final result is unknown
  */
final case class MatchContext[E](
    batch: MatchBatch,
    start: Instant,
    common: List[CommonEvent],
    events: List[E],
    players: List[String],
    teams: Map[String, String],
    placements: Map[String, Int]
):
  /** A number from MATCH_STARTED (questions, lives, startingChips...); None if it is missing. The
    * ingestor does not check these keys, so each game falls back to its default.
    */
  def startNumber(key: String): Option[Double] =
    common
      .collectFirst { case s: MatchStarted => s.settings(key) }
      .flatten
      .flatMap(_.asNumber)
      .map(_.toDouble)

  /** Match duration in minutes (G2). */
  def minutes: Double = GenericStats.durationMs(batch.events) / 60000.0

object MatchContext:
  def build[E](batch: MatchBatch, toTyped: (Event, Instant) => Option[E]): MatchContext[E] =
    val start = batch.startedAt
    val common = batch.events.flatMap(Typed.toCommon(_, start))
    val started = common.collectFirst { case s: MatchStarted => s }
    val finished =
      if batch.partial then None else common.collectFirst { case f: MatchFinished => f }

    val teams =
      started.toList.flatMap(_.teams.toList).flatMap((team, ps) => ps.map(_ -> team)).toMap ++
        common.collect { case PlayerJoined(_, p, Some(team)) => p -> team } ++
        finished.toList.flatMap(_.results).collect { case Placement(p, _, Some(team)) => p -> team }
    val players =
      (batch.players ++ started.toList.flatMap(_.players) ++ batch.events.flatMap(
        _.playerId
      )).distinct.sorted

    MatchContext(
      batch = batch,
      start = start,
      common = common,
      events = batch.events.flatMap(toTyped(_, start)),
      players = players,
      teams = teams,
      placements = finished.toList.flatMap(_.results).map(r => r.playerId -> r.placement).toMap
    )

/** Builds every analyzer from three steps composed as functions: `buildContext andThen computeStats
  * andThen attachPatterns`. A game only says how to read its events, which metrics it adds and
  * which patterns it looks for; the generic statistics come for free.
  */
abstract class ComposedAnalyzer[E] extends GameAnalyzer:
  protected def toTyped(e: Event, start: Instant): Option[E]
  protected def playerMetrics(ctx: MatchContext[E]): PlayerMetrics = Map.empty
  protected def matchMetrics(ctx: MatchContext[E]): Map[String, Json] = Map.empty
  protected def detectors: List[PatternDetector[E]] = Nil

  private def buildContext: MatchBatch => MatchContext[E] =
    batch => MatchContext.build(batch, toTyped)

  private def computeStats: MatchContext[E] => (MatchContext[E], MatchAnalysis) =
    ctx => (ctx, stats(ctx))

  private def attachPatterns: ((MatchContext[E], MatchAnalysis)) => MatchAnalysis =
    (ctx, analysis) => analysis.copy(patterns = detectors.flatMap(detect => detect(ctx)))

  final def analyze(batch: MatchBatch): MatchAnalysis =
    (buildContext andThen computeStats andThen attachPatterns)(batch)

  private def stats(ctx: MatchContext[E]): MatchAnalysis =
    val metrics = Metrics.merge(
      GenericStats.presence(ctx.players, ctx.common),
      GenericStats.scores(ctx.common),
      GenericStats.turnTimes(ctx.common),
      playerMetrics(ctx)
    )
    val players = metrics.toList
      .map((p, m) => PlayerMatchStats(p, ctx.placements.get(p), ctx.teams.get(p), m))
      .sortBy(s => (s.placement.getOrElse(Int.MaxValue), s.playerId))
    MatchAnalysis(
      matchId = ctx.batch.matchId,
      gameId = ctx.batch.gameId,
      partial = ctx.batch.partial,
      analyzedAt = ctx.batch.sentAt,
      durationMs = GenericStats.durationMs(ctx.batch.events),
      eventsByType = GenericStats.eventsByType(ctx.batch.events),
      matchMetrics = GenericStats.matchSummary(ctx.players, ctx.common) ++ matchMetrics(ctx),
      players = players,
      patterns = Nil
    )

/** Statistics shared by every game (G1 to G6), with no game specific metrics. Used for any game
  * registered only by its config.
  */
final case class GenericAnalyzer(gameId: String) extends ComposedAnalyzer[Event]:
  protected def toTyped(e: Event, start: Instant): Option[Event] = Some(e)

object AnalyzerRegistry:
  def from(analyzers: List[GameAnalyzer]): Map[String, GameAnalyzer] =
    analyzers.map(a => a.gameId -> a).toMap

  /** Games with their own analyzer. Adding a game = one object extending ComposedAnalyzer plus one
    * entry here.
    */
  val all: Map[String, GameAnalyzer] =
    from(List(trivia.TriviaAnalyzer, snake.SnakeAnalyzer, blackjack.BlackjackAnalyzer))

  /** A game without its own analyzer is not an error: it gets the generic statistics.
    */
  def forGame(gameId: String, registry: Map[String, GameAnalyzer] = all): GameAnalyzer =
    registry.getOrElse(gameId, GenericAnalyzer(gameId))
