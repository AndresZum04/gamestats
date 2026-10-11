package gamestats.codec

import gamestats.model.*
import io.circe.*
import io.circe.generic.semiauto.*

import java.time.format.DateTimeFormatter
import java.time.{Instant, ZoneOffset}

/** JSON encoders and decoders. Import with `import gamestats.codec.Codecs.given`.
  */
object Codecs:

  private val timeFormat =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

  /** Instants are written like the ingestor writes them: 2026-09-10T14:03:22.120Z, always with
    * milliseconds.
    */
  given Encoder[Instant] = Encoder.encodeString.contramap(timeFormat.format)
  given Decoder[Instant] = Decoder.decodeInstant

  given Decoder[BatchStatus] = Decoder.decodeString.emap { s =>
    BatchStatus.values.find(_.toString == s).toRight(s"unknown status $s")
  }
  given Encoder[BatchStatus] = Encoder.encodeString.contramap(_.toString)

  /** The JSON field `type` becomes `eventType` (type is a Scala keyword). */
  given Decoder[Event] = Decoder.instance { c =>
    for
      eventId <- c.get[String]("eventId")
      timestamp <- c.get[Instant]("timestamp")
      gameId <- c.get[String]("gameId")
      gameVersion <- c.get[String]("gameVersion")
      matchId <- c.get[String]("matchId")
      seq <- c.get[Int]("seq")
      playerId <- c.get[Option[String]]("playerId")
      eventType <- c.get[String]("type")
      action <- c.get[Option[String]]("action")
      data <- c.getOrElse[JsonObject]("data")(JsonObject.empty)
    yield Event(
      eventId,
      timestamp,
      gameId,
      gameVersion,
      matchId,
      seq,
      playerId,
      eventType,
      action,
      data
    )
  }

  given Encoder[Event] = Encoder.instance { e =>
    Json
      .obj(
        "eventId" -> Json.fromString(e.eventId),
        "timestamp" -> Encoder[Instant].apply(e.timestamp),
        "gameId" -> Json.fromString(e.gameId),
        "gameVersion" -> Json.fromString(e.gameVersion),
        "matchId" -> Json.fromString(e.matchId),
        "seq" -> Json.fromInt(e.seq),
        "playerId" -> Encoder[Option[String]].apply(e.playerId),
        "type" -> Json.fromString(e.eventType),
        "action" -> Encoder[Option[String]].apply(e.action),
        "data" -> Json.fromJsonObject(e.data)
      )
      .dropNullValues
  }

  given Codec.AsObject[MatchBatch] = deriveCodec
  given Codec.AsObject[PatternMatch] = deriveCodec
  given Codec.AsObject[PlayerMatchStats] = deriveCodec
  given Codec.AsObject[MatchAnalysis] = deriveCodec
  given Codec.AsObject[MatchSummary] = deriveCodec
  given Codec.AsObject[PlayerGameStats] = deriveCodec
  given Codec.AsObject[PlayerProfile] = deriveCodec
  given Codec.AsObject[LeaderboardEntry] = deriveCodec
  given Codec.AsObject[Leaderboard] = deriveCodec
  given Codec.AsObject[GameSummary] = deriveCodec
