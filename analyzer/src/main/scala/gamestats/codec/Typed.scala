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
        yield MatchStarted(m, players, mode, teams.getOrElse(Map.empty), d)
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

  def toTrivia(e: Event, start: Instant): Option[TriviaEvent] =
    import TriviaEvent.*
    val d = e.data
    val m = meta(e, start)
    e.eventType match
      case "QUESTION_SHOWN" =>
        for
          q <- field[String](d, "questionId")
          number <- field[Int](d, "number")
          category <- field[String](d, "category")
          difficulty <- field[String](d, "difficulty")
          limit <- field[Long](d, "timeLimitMs")
        yield QuestionShown(m, q, number, category, difficulty, limit)
      case "ANSWER_SUBMITTED" =>
        for
          p <- e.playerId
          q <- field[String](d, "questionId")
          option <- field[String](d, "option")
          correct <- field[Boolean](d, "correct")
          response <- field[Long](d, "responseMs")
        yield AnswerSubmitted(m, p, q, option, correct, response)
      case "ANSWER_TIMEOUT" =>
        for
          p <- e.playerId
          q <- field[String](d, "questionId")
        yield AnswerTimeout(m, p, q)
      case "QUESTION_CLOSED" =>
        for
          q <- field[String](d, "questionId")
          option <- field[String](d, "correctOption")
          count <- field[Int](d, "correctCount")
        yield QuestionClosed(m, q, option, count)
      case _ => None

  def toSnake(e: Event, start: Instant): Option[SnakeEvent] =
    import SnakeEvent.*
    val d = e.data
    val m = meta(e, start)
    e.playerId.flatMap { p =>
      e.eventType match
        case "FOOD_EATEN" =>
          for
            food <- field[String](d, "foodType")
            length <- field[Int](d, "length")
            points <- field[Int](d, "points")
          yield FoodEaten(m, p, food, length, points)
        case "POWERUP_PICKED" =>
          for
            powerup <- field[String](d, "powerup")
            duration <- field[Long](d, "durationMs")
          yield PowerupPicked(m, p, powerup, duration)
        case "LEVEL_UP" =>
          for
            level <- field[Int](d, "level")
            speed <- field[Double](d, "speed")
          yield LevelUp(m, p, level, speed)
        case "SNAKE_DIED" =>
          for
            cause <- field[String](d, "cause")
            length <- field[Int](d, "length")
            lives <- field[Int](d, "livesLeft")
          yield SnakeDied(m, p, cause, length, lives)
        case "PLAYER_RESPAWNED" => field[Int](d, "livesLeft").map(PlayerRespawned(m, p, _))
        case _                  => None
    }

  def toBlackjack(e: Event, start: Instant): Option[BlackjackEvent] =
    import BlackjackEvent.*
    val d = e.data
    val m = meta(e, start)
    // Events of the house have no player; the others need one.
    def player[A](f: String => Option[A]): Option[A] = e.playerId.flatMap(f)
    e.eventType match
      case "ROUND_STARTED" => field[Int](d, "round").map(RoundStarted(m, _))
      case "DEALER_CARD" =>
        for
          round <- field[Int](d, "round")
          card <- field[String](d, "card")
          hidden <- field[Boolean](d, "hidden")
          value <- field[Int](d, "dealerValue")
        yield DealerCard(m, round, card, hidden, value)
      case "BET_PLACED" =>
        player(p =>
          for
            round <- field[Int](d, "round")
            amount <- field[Long](d, "amount")
            before <- field[Long](d, "chipsBefore")
          yield BetPlaced(m, p, round, amount, before)
        )
      case "CARD_DEALT" =>
        player(p =>
          for
            round <- field[Int](d, "round")
            card <- field[String](d, "card")
            value <- field[Int](d, "handValue")
          yield CardDealt(m, p, round, card, value)
        )
      case "DECISION" =>
        player(p =>
          for
            action <- e.action
            round <- field[Int](d, "round")
            value <- field[Int](d, "handValue")
          yield Decision(m, p, action, round, value)
        )
      case "BUST" =>
        player(p =>
          for
            round <- field[Int](d, "round")
            value <- field[Int](d, "handValue")
          yield Bust(m, p, round, value)
        )
      case "BLACKJACK" => player(p => field[Int](d, "round").map(Blackjack(m, p, _)))
      case "HAND_RESULT" =>
        player(p =>
          for
            round <- field[Int](d, "round")
            result <- field[String](d, "result")
            payout <- field[Long](d, "payout")
            chips <- field[Long](d, "chips")
          yield HandResult(m, p, round, result, payout, chips)
        )
      case _ => None
