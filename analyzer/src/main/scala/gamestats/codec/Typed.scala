package gamestats.codec

import gamestats.model.*
import io.circe.{Decoder, JsonObject}

import java.time.{Duration, Instant}

/** Pure conversions from the generic [[Event]] to typed events. Each one returns None when the
  * event is of another kind or its data does not decode, so a batch is converted with
  * `events.flatMap(...)` and anything unknown is simply left out: no exceptions, no nulls.
  */
object Typed:

  /** Milliseconds between the start of the match and the event. */
  def atMs(e: Event, start: Instant): Long = Duration.between(start, e.timestamp).toMillis

  private def meta(e: Event, start: Instant): Meta = Meta(e.eventId, e.seq, atMs(e, start))

  /** Reads a key of `data`; None if it is missing or has another type. */
  private def field[A: Decoder](data: JsonObject, key: String): Option[A] =
    data(key).flatMap(_.as[A].toOption)

  /** Like field, for optional keys: missing is Some(None), wrong type None. */
  private def optional[A: Decoder](data: JsonObject, key: String): Option[Option[A]] =
    data(key).filterNot(_.isNull) match
      case None       => Some(None)
      case Some(json) => json.as[A].toOption.map(Some(_))

  private given Decoder[Placement] =
    Decoder.forProduct3("playerId", "placement", "teamId")(Placement.apply)

  def toCommon(e: Event, start: Instant): Option[CommonEvent] =
    import CommonEvent.*
    val d = e.data
    val m = meta(e, start)
    e.eventType match
      case "MATCH_STARTED" =>
        for
          players <- field[List[String]](d, "players")
          mode <- field[String](d, "mode")
          teams <- optional[Map[String, List[String]]](d, "teams")
          track <- optional[String](d, "track")
          map <- optional[String](d, "map")
        yield MatchStarted(m, players, mode, teams.getOrElse(Map.empty), track.orElse(map))
      case "MATCH_FINISHED" =>
        for
          duration <- field[Long](d, "durationMs")
          results <- field[List[Placement]](d, "results")
          winner <- optional[String](d, "winnerTeam")
          score <- optional[Map[String, Int]](d, "score")
        yield MatchFinished(m, duration, results, winner, score.getOrElse(Map.empty))
      case "PLAYER_JOINED" =>
        for
          p <- e.playerId
          team <- optional[String](d, "teamId")
        yield PlayerJoined(m, p, team)
      case "PLAYER_LEFT" =>
        for
          p <- e.playerId
          reason <- field[String](d, "reason")
        yield PlayerLeft(m, p, reason)
      case "PLAYER_DISCONNECTED" => e.playerId.map(PlayerDisconnected(m, _))
      case "PLAYER_RECONNECTED" =>
        for
          p <- e.playerId
          away <- field[Long](d, "awayMs")
        yield PlayerReconnected(m, p, away)
      case "SCORE_CHANGED" =>
        for
          p <- e.playerId
          delta <- field[Double](d, "delta")
          total <- field[Double](d, "total")
          team <- optional[String](d, "teamId")
          reason <- optional[String](d, "reason")
        yield ScoreChanged(m, p, delta, total, team, reason)
      case "TURN_STARTED" =>
        for
          p <- e.playerId
          turn <- field[Int](d, "turn")
        yield TurnStarted(m, p, turn)
      case "TURN_ENDED" =>
        for
          p <- e.playerId
          turn <- field[Int](d, "turn")
          duration <- field[Long](d, "durationMs")
        yield TurnEnded(m, p, turn, duration)
      case "PLAYER_ACTION" => e.playerId.map(PlayerAction(m, _, e.action, d))
      case _               => None

  def toRacing(e: Event, start: Instant): Option[RacingEvent] =
    import RacingEvent.*
    val d = e.data
    val m = meta(e, start)
    e.playerId.flatMap { p =>
      e.eventType match
        case "LAP_COMPLETED" =>
          for
            lap <- field[Int](d, "lap")
            time <- field[Long](d, "lapTimeMs")
            position <- field[Int](d, "position")
            speed <- field[Double](d, "topSpeedKmh")
          yield LapCompleted(m, p, lap, time, position, speed)
        case "POSITION_CHANGED" =>
          for
            lap <- field[Int](d, "lap")
            from <- field[Int](d, "from")
            to <- field[Int](d, "to")
            other <- optional[String](d, "otherPlayerId")
          yield PositionChanged(m, p, e.action.getOrElse(""), lap, from, to, other)
        case "PIT_STOP" =>
          for
            lap <- field[Int](d, "lap")
            duration <- field[Long](d, "durationMs")
            tire <- field[String](d, "tire")
          yield PitStop(m, p, lap, duration, tire)
        case "PENALTY" =>
          for
            lap <- field[Int](d, "lap")
            seconds <- field[Double](d, "seconds")
            reason <- field[String](d, "reason")
          yield Penalty(m, p, lap, seconds, reason)
        case "CRASH" =>
          for
            lap <- field[Int](d, "lap")
            severity <- field[String](d, "severity")
            other <- optional[String](d, "otherPlayerId")
          yield Crash(m, p, lap, severity, other)
        case _ => None
    }

  def toArena(e: Event, start: Instant): Option[ArenaEvent] =
    import ArenaEvent.*
    val d = e.data
    val m = meta(e, start)
    e.playerId.flatMap { p =>
      e.eventType match
        case "DAMAGE_DEALT" =>
          for
            target <- field[String](d, "targetId")
            weapon <- field[String](d, "weapon")
            amount <- field[Double](d, "amount")
            distance <- field[Double](d, "distanceM")
            headshot <- field[Boolean](d, "headshot")
          yield DamageDealt(m, p, target, weapon, amount, distance, headshot)
        case "PLAYER_ELIMINATED" =>
          for
            victim <- field[String](d, "victimId")
            weapon <- field[String](d, "weapon")
            distance <- field[Double](d, "distanceM")
            assists <- field[List[String]](d, "assistIds")
          yield PlayerEliminated(m, p, victim, weapon, distance, assists)
        case "ITEM_PICKED" =>
          for
            item <- field[String](d, "itemId")
            itemType <- field[String](d, "itemType")
          yield ItemPicked(m, p, item, itemType)
        case "OBJECTIVE_CAPTURED" =>
          for
            objective <- field[String](d, "objectiveId")
            team <- field[String](d, "teamId")
          yield ObjectiveCaptured(m, p, objective, team)
        case "PLAYER_RESPAWNED" => Some(PlayerRespawned(m, p))
        case _                  => None
    }
