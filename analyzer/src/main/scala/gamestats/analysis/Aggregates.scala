package gamestats.analysis

import gamestats.model.*
import io.circe.Json

/** Statistics across matches. Pure functions over the list of stored analyses: the routes read the
  * store once and call these.
  */
object Aggregates:

  /** The game's metric, declared by its analyzer (None for a game without one). */
  def gameMetric(gameId: String): Option[String] = AnalyzerRegistry.forGame(gameId).ranking.metric

  /** A win is first place, in every game. */
  def isWin(placement: Option[Int]): Boolean = placement.contains(1)

  private def number(json: Json): Option[Double] = json.asNumber.map(_.toDouble)

  private def metricOf(stats: PlayerMatchStats, name: String): Option[Double] =
    stats.metrics.get(name).flatMap(number)

  def summary(a: MatchAnalysis): MatchSummary =
    MatchSummary(
      a.matchId,
      a.gameId,
      a.partial,
      a.analyzedAt,
      a.durationMs,
      a.players.size,
      a.eventsByType.values.sum,
      a.patterns.size
    )

  /** GET /api/v1/matches: most recent first, optionally for one game. */
  def recentMatches(
      all: List[MatchAnalysis],
      gameId: Option[String],
      limit: Int
  ): List[MatchSummary] =
    all
      .filter(a => gameId.forall(_ == a.gameId))
      .sortBy(a => (a.analyzedAt, a.matchId))
      .reverse
      .take(limit)
      .map(summary)

  /** Immutable accumulator of a player's record in one game. */
  final case class Record(matches: Int, wins: Int, metricSum: Double, metricCount: Int):
    def add(win: Boolean, metric: Option[Double]): Record =
      Record(
        matches + 1,
        wins + (if win then 1 else 0),
        metricSum + metric.getOrElse(0.0),
        metricCount + metric.size
      )
    def winPct: Double =
      if matches == 0 then 0.0
      else BigDecimal(100.0 * wins / matches).setScale(1, BigDecimal.RoundingMode.HALF_UP).toDouble
    def avg: Option[Double] =
      Option.when(metricCount > 0)(
        BigDecimal(metricSum / metricCount).setScale(3, BigDecimal.RoundingMode.HALF_UP).toDouble
      )

  object Record:
    val empty: Record = Record(0, 0, 0.0, 0)

  /** Every (player, match) of one game, folded per player into a Record. */
  def records(all: List[MatchAnalysis], gameId: String): Map[String, Record] =
    val metric = gameMetric(gameId)
    all
      .filter(_.gameId == gameId)
      .flatMap(_.players)
      .groupBy(_.playerId)
      .view
      .mapValues(
        _.foldLeft(Record.empty)((r, s) =>
          r.add(isWin(s.placement), metric.flatMap(metricOf(s, _)))
        )
      )
      .toMap

  /** GET /api/v1/players/{playerId}: the player's record in each game. */
  def player(all: List[MatchAnalysis], playerId: String): Option[PlayerProfile] =
    val games = all.filter(_.players.exists(_.playerId == playerId)).map(_.gameId).distinct.sorted
    Option.when(games.nonEmpty)(
      PlayerProfile(
        playerId,
        games.flatMap { g =>
          records(all, g)
            .get(playerId)
            .map(r => PlayerGameStats(g, r.matches, r.wins, gameMetric(g), r.avg))
        }
      )
    )

  /** Leaderboard of a game, ordered as its analyzer's [[Ranking]] says.
    *
    * Total wins are never the first key: they grow with the matches played, so they would favor
    * whoever plays more. A game of several players is ranked by % of matches won; a single player
    * game, where every match is a win, by its metric. Then the metric (players without it go last),
    * then more matches played, then the id.
    */
  def leaderboard(all: List[MatchAnalysis], gameId: String, limit: Int): Leaderboard =
    val ranking = AnalyzerRegistry.forGame(gameId).ranking
    val entries = records(all, gameId).toList
      .sortBy((p, r) =>
        val winKey = if ranking.singlePlayer then 0.0 else -r.winPct
        (winKey, r.avg.isEmpty, -r.avg.getOrElse(0.0), -r.matches, p)
      )
      .take(limit)
      .zipWithIndex
      .map { case ((p, r), i) => LeaderboardEntry(i + 1, p, r.matches, r.wins, r.winPct, r.avg) }
    Leaderboard(gameId, ranking.metric, ranking.singlePlayer, entries)

  /** GET /api/v1/games/{gameId}/summary: G4, matches, average duration and the statistics of the
    * game's analyzer over every match. None if the game has no stored matches.
    */
  def gameSummary(all: List[MatchAnalysis], gameId: String): Option[GameSummary] =
    val matches = all.filter(_.gameId == gameId)
    Option.when(matches.nonEmpty) {
      val entries = matches.flatMap(_.players)
      val left = entries.count(_.metrics.get("left").flatMap(_.asBoolean).contains(true))
      GameSummary(
        gameId = gameId,
        matches = matches.size,
        partialMatches = matches.count(_.partial),
        avgDurationMs = BigDecimal(matches.map(_.durationMs).sum.toDouble / matches.size)
          .setScale(1, BigDecimal.RoundingMode.HALF_UP)
          .toDouble,
        playerEntries = entries.size,
        playersLeft = left,
        abandonmentRate =
          if entries.isEmpty then 0.0
          else
            BigDecimal(left.toDouble / entries.size)
              .setScale(3, BigDecimal.RoundingMode.HALF_UP)
              .toDouble
        ,
        gameMetrics = AnalyzerRegistry.forGame(gameId).gameMetrics(matches),
        patterns = matches.flatMap(_.patterns).groupBy(_.patternId).view.mapValues(_.size).toMap
      )
    }

  /** GET /api/v1/patterns: newest matches first, then in match order. */
  def patterns(
      all: List[MatchAnalysis],
      gameId: Option[String],
      patternId: Option[String],
      limit: Int
  ): List[PatternMatch] =
    all
      .filter(a => gameId.forall(_ == a.gameId))
      .sortBy(a => (a.analyzedAt, a.matchId))
      .reverse
      .flatMap(_.patterns.sortBy(_.atMs))
      .filter(p => patternId.forall(_ == p.patternId))
      .take(limit)
