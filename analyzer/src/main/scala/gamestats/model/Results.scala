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
