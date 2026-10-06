package gamestats.model

import io.circe.JsonObject

/** What every typed event carries: its id, its order in the match and the milliseconds since the
  * match started.
  */
final case class Meta(eventId: String, seq: Int, atMs: Long)

/** Final position of a player in MATCH_FINISHED. */
final case class Placement(playerId: String, placement: Int, teamId: Option[String])

/** Events shared by every game. Player events carry the player as a plain String: an event without
  * the player it needs is never built.
  */
enum CommonEvent:
  case MatchStarted(
      meta: Meta,
      players: List[String],
      mode: String,
      teams: Map[String, List[String]],
      venue: Option[String] // track or map
  )
  case MatchFinished(
      meta: Meta,
      durationMs: Long,
      results: List[Placement],
      winnerTeam: Option[String],
      score: Map[String, Int]
  )
  case PlayerJoined(meta: Meta, playerId: String, teamId: Option[String])
  case PlayerLeft(meta: Meta, playerId: String, reason: String)
  case PlayerDisconnected(meta: Meta, playerId: String)
  case PlayerReconnected(meta: Meta, playerId: String, awayMs: Long)
  case ScoreChanged(
      meta: Meta,
      playerId: String,
      delta: Double,
      total: Double,
      teamId: Option[String],
      reason: Option[String]
  )
  case TurnStarted(meta: Meta, playerId: String, turn: Int)
  case TurnEnded(meta: Meta, playerId: String, turn: Int, durationMs: Long)
  case PlayerAction(meta: Meta, playerId: String, action: Option[String], data: JsonObject)

  def meta: Meta

/** racing-pro events. */
enum RacingEvent:
  case LapCompleted(
      meta: Meta,
      playerId: String,
      lap: Int,
      lapTimeMs: Long,
      position: Int,
      topSpeedKmh: Double
  )
  case PositionChanged(
      meta: Meta,
      playerId: String,
      action: String, // OVERTAKE, OVERTAKEN, PIT or CRASH
      lap: Int,
      from: Int,
      to: Int,
      otherPlayerId: Option[String]
  )
  case PitStop(meta: Meta, playerId: String, lap: Int, durationMs: Long, tire: String)
  case Penalty(meta: Meta, playerId: String, lap: Int, seconds: Double, reason: String)
  case Crash(
      meta: Meta,
      playerId: String,
      lap: Int,
      severity: String,
      otherPlayerId: Option[String]
  )

  def meta: Meta
  def playerId: String

/** arena-clash events. playerId is the one who acts: attacker, eliminator, collector.
  */
enum ArenaEvent:
  case DamageDealt(
      meta: Meta,
      playerId: String,
      targetId: String,
      weapon: String,
      amount: Double,
      distanceM: Double,
      headshot: Boolean
  )
  case PlayerEliminated(
      meta: Meta,
      playerId: String,
      victimId: String,
      weapon: String,
      distanceM: Double,
      assistIds: List[String]
  )
  case ItemPicked(meta: Meta, playerId: String, itemId: String, itemType: String)
  case ObjectiveCaptured(meta: Meta, playerId: String, objectiveId: String, teamId: String)
  case PlayerRespawned(meta: Meta, playerId: String)

  def meta: Meta
  def playerId: String
