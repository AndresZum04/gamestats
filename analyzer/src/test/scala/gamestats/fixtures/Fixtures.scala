package gamestats.fixtures

import gamestats.model.*
import io.circe.{Json, JsonObject}

import java.time.Instant

/** Small hand-written matches. Times are given in seconds since the start so expected values can be
  * computed by hand in the tests.
  */
object Fixtures:
  val start: Instant = Instant.parse("2026-09-10T14:00:00.000Z")

  def at(seconds: Double): Instant = start.plusMillis(math.round(seconds * 1000))

  def n(v: Double): Json = Json.fromBigDecimal(BigDecimal(v))
  def s(v: String): Json = Json.fromString(v)
  def b(v: Boolean): Json = Json.fromBoolean(v)
  def arr(vs: String*): Json = Json.arr(vs.map(Json.fromString)*)

  /** Builds events from (seconds, type, player, data) and numbers them by position: seq = index +
    * 1, eventId = "<matchId>-<seq>".
    */
  final case class Spec(
      at: Double,
      eventType: String,
      player: Option[String],
      data: (String, Json)*
  )

  def e(at: Double, eventType: String, player: String, data: (String, Json)*): Spec =
    Spec(at, eventType, Some(player), data*)

  def sys(at: Double, eventType: String, data: (String, Json)*): Spec =
    Spec(at, eventType, None, data*)

  def batch(
      gameId: String,
      specs: List[Spec],
      status: BatchStatus = BatchStatus.COMPLETE,
      matchId: String = "m-1",
      action: Map[Int, String] = Map.empty
  ): MatchBatch =
    val events = specs.zipWithIndex.map { (sp, i) =>
      Event(
        eventId = s"$matchId-${i + 1}",
        timestamp = at(sp.at),
        gameId = gameId,
        gameVersion = "1.0",
        matchId = matchId,
        seq = i + 1,
        playerId = sp.player,
        eventType = sp.eventType,
        action = action.get(i + 1),
        data = JsonObject.fromIterable(sp.data)
      )
    }
    MatchBatch(
      batchId = s"b-$matchId",
      matchId = matchId,
      gameId = gameId,
      gameVersion = "1.0",
      status = status,
      startedAt = start,
      finishedAt =
        if status == BatchStatus.COMPLETE then events.lastOption.map(_.timestamp) else None,
      players = events.flatMap(_.playerId).distinct.sorted,
      eventCount = events.size,
      sentAt = at(9999),
      events = events
    )

  def results(placements: (String, Int)*): Json =
    Json.arr(placements.map((p, place) => Json.obj("playerId" -> s(p), "placement" -> n(place)))*)
