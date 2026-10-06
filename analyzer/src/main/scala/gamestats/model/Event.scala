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

/** Whether the ingestor saw MATCH_FINISHED or closed the match for inactivity.
  */
enum BatchStatus:
  case COMPLETE, PARTIAL

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
  def partial: Boolean = status == BatchStatus.PARTIAL
