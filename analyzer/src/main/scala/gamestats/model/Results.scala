package gamestats.model

import io.circe.Json

import java.time.Instant

/** A detected pattern. evidence lists the eventIds that prove it, so it can be checked against the
  * raw events.
  */
final case class PatternMatch(
    patternId: String,
    name: String,
    gameId: String,
    matchId: String,
    playerId: Option[String],
    teamId: Option[String],
    atMs: Long,
    description: String,
    evidence: List[String]
)

/** Statistics of one player in one match. Game specific metrics live in a map, so adding a game
  * never changes this structure.
  */
final case class PlayerMatchStats(
    playerId: String,
    placement: Option[Int],
    teamId: Option[String],
    metrics: Map[String, Json]
)

/** The result of analyzing one match: what is stored and served. */
final case class MatchAnalysis(
    matchId: String,
    gameId: String,
    partial: Boolean,
    analyzedAt: Instant,
    durationMs: Long,
    eventsByType: Map[String, Int],
    matchMetrics: Map[String, Json],
    players: List[PlayerMatchStats],
    patterns: List[PatternMatch]
)

/** One line of GET /api/v1/matches. */
final case class MatchSummary(
    matchId: String,
    gameId: String,
    partial: Boolean,
    analyzedAt: Instant,
    durationMs: Long,
    players: Int,
    events: Int,
    patterns: Int
)

/** A player's record in one game, over all stored matches. avgMetric is the game's tiebreak metric
  * (% of right answers in trivia, longest snake in snake, net gain in blackjack).
  */
final case class PlayerGameStats(
    gameId: String,
    matches: Int,
    wins: Int,
    metric: Option[String],
    avgMetric: Option[Double]
)

final case class PlayerProfile(playerId: String, games: List[PlayerGameStats])

final case class LeaderboardEntry(
    rank: Int,
    playerId: String,
    matches: Int,
    wins: Int,
    avgMetric: Option[Double]
)

final case class Leaderboard(
    gameId: String,
    metric: Option[String],
    entries: List[LeaderboardEntry]
)

/** GET /api/v1/games/{gameId}/summary: G4, matches, average duration and the game's own statistics
  * over every match (T5 in trivia, S5 in snake).
  */
final case class GameSummary(
    gameId: String,
    matches: Int,
    partialMatches: Int,
    avgDurationMs: Double,
    playerEntries: Int,
    playersLeft: Int,
    abandonmentRate: Double,
    gameMetrics: Map[String, Json],
    patterns: Map[String, Int]
)
