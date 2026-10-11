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
      settings: JsonObject // the whole data: each game reads its own keys (questions, lives...)
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

/** trivia events. Questions belong to the match, not to a player: QUESTION_SHOWN and
  * QUESTION_CLOSED have no playerId.
  */
enum TriviaEvent:
  case QuestionShown(
      meta: Meta,
      questionId: String,
      number: Int,
      category: String,
      difficulty: String,
      timeLimitMs: Long
  )
  case AnswerSubmitted(
      meta: Meta,
      playerId: String,
      questionId: String,
      option: String,
      correct: Boolean,
      responseMs: Long
  )
  case AnswerTimeout(meta: Meta, playerId: String, questionId: String)
  case QuestionClosed(meta: Meta, questionId: String, correctOption: String, correctCount: Int)

  def meta: Meta

/** snake events. Every one belongs to the player. */
enum SnakeEvent:
  case FoodEaten(meta: Meta, playerId: String, foodType: String, length: Int, points: Int)
  case PowerupPicked(meta: Meta, playerId: String, powerup: String, durationMs: Long)
  case LevelUp(meta: Meta, playerId: String, level: Int, speed: Double)
  case SnakeDied(meta: Meta, playerId: String, cause: String, length: Int, livesLeft: Int)
  case PlayerRespawned(meta: Meta, playerId: String, livesLeft: Int)

  def meta: Meta
  def playerId: String

/** blackjack events. The house is not a player: ROUND_STARTED and DEALER_CARD have no playerId.
  * DECISION takes its action (HIT, STAND or DOUBLE) from the envelope.
  */
enum BlackjackEvent:
  case RoundStarted(meta: Meta, round: Int)
  case BetPlaced(meta: Meta, playerId: String, round: Int, amount: Long, chipsBefore: Long)
  case CardDealt(meta: Meta, playerId: String, round: Int, card: String, handValue: Int)
  case DealerCard(meta: Meta, round: Int, card: String, hidden: Boolean, dealerValue: Int)
  case Decision(meta: Meta, playerId: String, action: String, round: Int, handValue: Int)
  case Bust(meta: Meta, playerId: String, round: Int, handValue: Int)
  case Blackjack(meta: Meta, playerId: String, round: Int)
  case HandResult(
      meta: Meta,
      playerId: String,
      round: Int,
      result: String, // WIN, LOSE or PUSH
      payout: Long, // net gain of the hand, negative when lost
      chips: Long
  )

  def meta: Meta
