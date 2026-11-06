package gamestats.model

import io.circe.JsonObject

import java.time.Instant

/** One event as the ingestor sends it, with the common envelope. The game specific part stays as
  * JSON in `data` until it is converted to a typed event (see [[gamestats.codec.Typed]]).
  */
final case class Event(
    eventId: String,
    timestamp: Instant,
    gameId: String,
    gameVersion: String,
    matchId: String,
    seq: Int,
    playerId: Option[String],
    eventType: String, // "type" in JSON
    action: Option[String],
    data: JsonObject
)

/** Whether the ingestor saw MATCH_FINISHED (COMPLETE), closed the match for inactivity (PARTIAL) or
  * sent a copy of a match still being played (LIVE).
  */
enum BatchStatus:
  case COMPLETE, PARTIAL, LIVE

/** A whole match, sent by the ingestor with POST /api/v1/matches. Events come sorted by seq.
  */
final case class MatchBatch(
    batchId: String,
    matchId: String,
    gameId: String,
    gameVersion: String,
    status: BatchStatus,
    startedAt: Instant,
    finishedAt: Option[Instant],
    players: List[String],
    eventCount: Int,
    sentAt: Instant,
    events: List[Event]
):
  /** A LIVE copy is analyzed like a PARTIAL batch: its final result is not known yet. */
  def partial: Boolean = status != BatchStatus.COMPLETE
  def live: Boolean = status == BatchStatus.LIVE
