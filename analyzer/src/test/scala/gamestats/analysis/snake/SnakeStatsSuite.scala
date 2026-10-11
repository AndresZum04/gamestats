package gamestats.analysis.snake

import gamestats.fixtures.Fixtures.*
import gamestats.model.*
import io.circe.Json

/** S1 to S5 on a hand-written match of one minute:
  *
  * {{{
  * life 1: fruits at 5, 9 and 15 s (length 4, 5, 6), dies against a WALL at 20 s
  * life 2: fruits at 30 and 34 s (length 4, 5), dies by SELF at 35 s
  * life 3: no fruits, dies against a WALL at 50 s
  * }}}
  */
class SnakeStatsSuite extends munit.FunSuite:

  def food(at: Double, length: Int): Spec =
    e(at, "FOOD_EATEN", "p-kev", "foodType" -> s("APPLE"), "length" -> n(length), "points" -> n(10))

  def died(at: Double, cause: String, length: Int, left: Int): Spec =
    e(at, "SNAKE_DIED", "p-kev", "cause" -> s(cause), "length" -> n(length), "livesLeft" -> n(left))

  def respawn(at: Double, left: Int): Spec =
    e(at, "PLAYER_RESPAWNED", "p-kev", "livesLeft" -> n(left))

  val specs: List[Spec] = List(
    sys(0, "MATCH_STARTED", "players" -> arr("p-kev"), "mode" -> s("CLASSIC"), "lives" -> n(3)),
    food(5, 4),
    food(9, 5),
    e(12, "POWERUP_PICKED", "p-kev", "powerup" -> s("SLOW"), "durationMs" -> n(5000)),
    food(15, 6),
    died(20, "WALL", 6, 2),
    respawn(23, 2),
    food(30, 4),
    food(34, 5),
    died(35, "SELF", 5, 1),
    respawn(38, 1),
    died(50, "WALL", 3, 0),
    sys(60, "MATCH_FINISHED", "durationMs" -> n(60000), "results" -> results("p-kev" -> 1))
  )

  val result: MatchAnalysis = SnakeAnalyzer.analyze(batch("snake", specs))
  val kev: Map[String, Json] = result.players.head.metrics

  def dbl(j: Json): Double = j.asNumber.map(_.toDouble).getOrElse(fail(s"$j is not a number"))

  test("S1: longest length (from fruits and deaths) and fruits eaten") {
    assertEquals((dbl(kev("maxLength")), dbl(kev("fruits"))), (6.0, 5.0))
    // A death can be longer than every fruit: the snake starts each life with length 3.
    val longDeath = batch("snake", specs.take(2) :+ died(7, "WALL", 9, 2))
    assertEquals(dbl(SnakeAnalyzer.analyze(longDeath).players.head.metrics("maxLength")), 9.0)
  }

  test("S2: fruits per minute and average time between fruits of the same life") {
    assertEquals(dbl(kev("fruitsPerMinute")), 5.0) // 5 fruits in 1 minute
    // life 1: 4000 and 6000 ms; life 2: 4000 ms. The 15 s from 15 to 30 cross a death.
    assertEquals(dbl(kev("avgMsBetweenFruits")), 4666.7) // 14000 / 3
  }

  test("S3: deaths per cause") {
    assertEquals(dbl(kev("deaths")), 3.0)
    assertEquals(
      kev("deathsByCause"),
      Json.obj("SELF" -> Json.fromLong(1), "WALL" -> Json.fromLong(2))
    )
  }

  test("S4: fruits in each life and their average") {
    assertEquals(
      kev("fruitsPerLife"),
      Json.arr(Json.fromLong(3), Json.fromLong(2), Json.fromLong(0))
    )
    assertEquals(dbl(kev("avgFruitsPerLife")), 1.7) // 5 / 3
  }

  test("S4: a PARTIAL match counts the life in progress") {
    val open =
      batch("snake", specs.take(9), status = BatchStatus.PARTIAL) // up to the fruit at 34 s
    assertEquals(
      SnakeAnalyzer.analyze(open).players.head.metrics("fruitsPerLife"),
      Json.arr(Json.fromLong(3), Json.fromLong(2))
    )
  }

  test("S5: length record of the game and most common cause of death") {
    val other = result.copy(
      matchId = "m-2",
      matchMetrics = Map(
        "maxLength" -> Json.fromInt(9),
        "maxLengthPlayer" -> Json.fromString("p-ana"),
        "deathsByCause" -> Json.obj("SELF" -> Json.fromInt(3))
      )
    )
    val game = SnakeAnalyzer.gameMetrics(List(result, other))
    assertEquals(
      game("lengthRecord"),
      Json.obj(
        "playerId" -> Json.fromString("p-ana"),
        "matchId" -> Json.fromString("m-2"),
        "length" -> Json.fromLong(9)
      )
    )
    // WALL 2, SELF 1 + 3 = 4
    assertEquals(game("mostCommonDeathCause"), Json.fromString("SELF"))
    // On a tie of length the first matchId keeps the record.
    val tie = other.copy(matchMetrics = other.matchMetrics.updated("maxLength", Json.fromInt(6)))
    assertEquals(
      SnakeAnalyzer.gameMetrics(List(tie, result))("lengthRecord").hcursor.get[String]("matchId"),
      Right("m-1")
    )
  }
