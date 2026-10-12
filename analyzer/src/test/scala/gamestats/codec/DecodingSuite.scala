package gamestats.codec

import gamestats.codec.Codecs.given
import gamestats.model.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.circe.{Json, JsonObject}

import java.nio.file.{Files, Paths}
import java.time.Instant
import scala.jdk.CollectionConverters.*

class DecodingSuite extends munit.FunSuite:

  val examples: List[String] =
    Files
      .readAllLines(Paths.get("../data/samples/examples.jsonl"))
      .asScala
      .toList
      .filter(_.trim.nonEmpty)

  val start: Instant = Instant.parse("2026-09-10T14:00:00.000Z")

  val commonTypes = Set(
    "MATCH_STARTED",
    "MATCH_FINISHED",
    "PLAYER_JOINED",
    "PLAYER_LEFT",
    "PLAYER_DISCONNECTED",
    "PLAYER_RECONNECTED",
    "SCORE_CHANGED",
    "TURN_STARTED",
    "TURN_ENDED",
    "PLAYER_ACTION"
  )

  /** The typed conversion of each game, by gameId. */
  val toGame: Map[String, (Event, Instant) => Option[Any]] = Map(
    "trivia" -> Typed.toTrivia,
    "snake" -> Typed.toSnake,
    "blackjack" -> Typed.toBlackjack
  )

  def find(eventType: String): Event =
    decode[Event](examples.find(_.contains(s"\"$eventType\"")).get).toOption.get

  test("every line of examples.jsonl decodes to Event and to its typed event") {
    assertEquals(examples.size, 29)
    examples.foreach { line =>
      val e = decode[Event](line).fold(err => fail(s"$line: $err"), identity)
      val typed =
        if commonTypes(e.eventType) then Typed.toCommon(e, start)
        else toGame(e.gameId)(e, start)
      assert(typed.isDefined, s"${e.eventType} did not decode to its typed event")
    }
  }

  test("a typed event keeps its fields and the time since the start") {
    val answer = find("ANSWER_SUBMITTED")
    assertEquals(
      Typed.toTrivia(answer, start),
      Some(
        TriviaEvent.AnswerSubmitted(
          Meta(answer.eventId, 6, 9320L),
          "p-ana",
          "q-017",
          "C",
          true,
          4320L
        )
      )
    )
    // The house has no player; DECISION takes its action from the envelope.
    Typed.toBlackjack(find("DEALER_CARD"), start) match
      case Some(BlackjackEvent.DealerCard(_, 1, "6S", false, 6)) => ()
      case other                                                 => fail(s"unexpected $other")
    Typed.toBlackjack(find("DECISION"), start) match
      case Some(BlackjackEvent.Decision(_, "p-mari", "DOUBLE", 1, 11)) => ()
      case other                                                       => fail(s"unexpected $other")
    Typed.toSnake(find("SNAKE_DIED"), start) match
      case Some(SnakeEvent.SnakeDied(_, "p-kev", "SELF", 11, 2)) => ()
      case other                                                 => fail(s"unexpected $other")
  }

  test("types of another game, missing players and broken data give None") {
    val food = find("FOOD_EATEN")
    assertEquals(Typed.toTrivia(food, start), None)
    assertEquals(Typed.toBlackjack(food, start), None)
    assertEquals(Typed.toCommon(food, start), None)
    assertEquals(Typed.toSnake(food.copy(playerId = None), start), None)
    assertEquals(
      Typed.toSnake(food.copy(data = food.data.add("length", Json.fromString("four"))), start),
      None
    )
    assertEquals(Typed.toSnake(food.copy(data = food.data.remove("points")), start), None)
    val decision = find("DECISION")
    assertEquals(Typed.toBlackjack(decision.copy(action = None), start), None)
  }

  test("optional keys may be missing but not of the wrong type") {
    val started = decode[Event](examples.head).toOption.get
    Typed.toCommon(started, start) match
      case Some(CommonEvent.MatchStarted(_, players, "CLASSIC", teams, settings)) =>
        assertEquals(players.size, 3)
        assertEquals(teams, Map.empty)
        assertEquals(settings("questions"), Some(Json.fromInt(10)))
      case other => fail(s"unexpected $other")
    val badTeams = started.copy(data = started.data.add("teams", Json.fromString("RED")))
    assertEquals(Typed.toCommon(badTeams, start), None)
  }

  test("a batch from the ingestor decodes and an analysis round-trips") {
    val events = examples.take(3).mkString(",")
    val raw =
      s"""{"batchId":"b-1","matchId":"tv-0007","gameId":"trivia","gameVersion":"1.0","status":"PARTIAL",
         |"startedAt":"2026-09-10T14:00:00.000Z","finishedAt":null,"players":["p-ana"],"eventCount":3,
         |"sentAt":"2026-09-10T14:20:00.000Z","events":[$events]}""".stripMargin
    val batch = decode[MatchBatch](raw).fold(err => fail(err.toString), identity)
    assert(batch.partial)
    assertEquals(batch.events.map(_.seq), List(1, 2, 5))
    assertEquals(batch.finishedAt, None)

    val analysis = MatchAnalysis(
      "tv-0007",
      "trivia",
      true,
      Instant.parse("2026-09-10T14:20:00Z"),
      1000L,
      Map("ANSWER_SUBMITTED" -> 1),
      Map("matchCorrectPct" -> Json.fromInt(50)),
      List(PlayerMatchStats("p-ana", None, None, Map.empty)),
      Nil
    )
    val json = analysis.asJson
    assertEquals(json.hcursor.get[String]("analyzedAt"), Right("2026-09-10T14:20:00.000Z"))
    assertEquals(json.as[MatchAnalysis], Right(analysis))
  }

  test("event encoding writes `type` back and keeps the data") {
    val e = decode[Event](examples(3)).toOption.get
    val json = e.asJson
    assertEquals(json.hcursor.get[String]("type"), Right("ANSWER_SUBMITTED"))
    assertEquals(json.as[Event], Right(e))
    assertEquals(e.data, JsonObject.fromIterable(e.data.toIterable))
  }
