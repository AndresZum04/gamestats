package gamestats.analysis.snake

import gamestats.analysis.Metrics
import gamestats.analysis.Metrics.*
import gamestats.model.{MatchAnalysis, SnakeEvent}
import gamestats.model.SnakeEvent.*
import io.circe.Json

/** snake statistics S1 to S5. Every one is a named pure function over the typed events of one match
  * (S5 over the stored analyses of every match).
  */
object SnakeStats:

  private def byPlayer(events: List[SnakeEvent]): Map[String, List[SnakeEvent]] =
    events.groupBy(_.playerId)

  /** The fruits of each life, in order. Each SNAKE_DIED closes a life; the fruits after the last
    * death are one more life (the one in progress when a PARTIAL match was closed).
    */
  val lives: List[SnakeEvent] => List[List[FoodEaten]] = events =>
    val (closed, current) = events.foldLeft((List.empty[List[FoodEaten]], List.empty[FoodEaten])) {
      case ((done, cur), f: FoodEaten) => (done, f :: cur)
      case ((done, cur), _: SnakeDied) => (cur.reverse :: done, Nil)
      case (acc, _)                    => acc
    }
    (if current.nonEmpty || closed.isEmpty then current.reverse :: closed else closed).reverse

  /** S1 for one player. */
  final case class Growth(maxLength: Int, fruits: Int)

  /** S1: longest length seen in FOOD_EATEN or SNAKE_DIED, and fruits eaten. */
  def growth(events: List[SnakeEvent]): Map[String, Growth] =
    byPlayer(events).flatMap { (p, evs) =>
      val lengths = evs.collect {
        case f: FoodEaten => f.length
        case d: SnakeDied => d.length
      }
      lengths.maxOption.map(m => p -> Growth(m, evs.count(_.isInstanceOf[FoodEaten])))
    }

  /** S2: fruits per minute of the match. */
  def fruitsPerMinute(fruits: Int, minutes: Double): Option[Double] =
    Option.when(minutes > 0)(fruits / minutes)

  /** S2: average ms between consecutive fruits of the same life (pairs from sliding(2), never
    * across a death).
    */
  def avgMsBetweenFruits(events: List[SnakeEvent]): Map[String, Double] =
    byPlayer(events).flatMap { (p, evs) =>
      val gaps = lives(evs).flatMap(
        _.sliding(2).collect { case List(a, b) => (b.meta.atMs - a.meta.atMs).toDouble }
      )
      Metrics.average(gaps).map(p -> _)
    }

  /** S3: deaths per cause. */
  def deathsByCause(events: List[SnakeEvent]): Map[String, Map[String, Int]] =
    byPlayer(events).view
      .mapValues(_.collect { case d: SnakeDied => d.cause }.groupMapReduce(identity)(_ => 1)(_ + _))
      .toMap

  /** S4 (combines FOOD_EATEN and SNAKE_DIED): fruits in each life and their average. */
  def fruitsPerLife(events: List[SnakeEvent]): Map[String, List[Int]] =
    byPlayer(events).view.mapValues(evs => lives(evs).map(_.size)).toMap

  private def counts(m: Map[String, Int]): Json =
    Json.fromFields(m.toList.sortBy(_._1).map((k, v) => k -> int(v.toLong)))

  /** Match level figures kept for S5: the longest snake and the deaths per cause. */
  def matchSummary(events: List[SnakeEvent]): Map[String, Json] =
    val best = growth(events).toList.maxByOption((p, g) => (g.maxLength, p))
    val deaths = deathsByCause(events).values.flatMap(_.toList).groupMapReduce(_._1)(_._2)(_ + _)
    best.toList
      .flatMap((p, g) => List("maxLength" -> int(g.maxLength.toLong), "maxLengthPlayer" -> str(p)))
      .toMap ++ Map(
      "fruits" -> int(events.count(_.isInstanceOf[FoodEaten]).toLong),
      "deathsByCause" -> counts(deaths)
    )

  /** S5: length record of the game (player, match and length; ties keep the first matchId) and the
    * most common cause of death (ties go alphabetical).
    */
  def gameSummary(matches: List[MatchAnalysis]): Map[String, Json] =
    val records = matches.flatMap { a =>
      for
        length <- a.matchMetrics.get("maxLength").flatMap(_.asNumber).flatMap(_.toInt)
        player <- a.matchMetrics.get("maxLengthPlayer").flatMap(_.asString)
      yield (length, a.matchId, player)
    }
    val deaths = matches
      .flatMap(_.matchMetrics.get("deathsByCause").flatMap(_.asObject).toList.flatMap(_.toList))
      .flatMap((c, n) => n.asNumber.flatMap(_.toInt).map(c -> _))
      .groupMapReduce(_._1)(_._2)(_ + _)
    records
      .minByOption((length, matchId, _) => (-length, matchId))
      .toList
      .map((length, matchId, player) =>
        "lengthRecord" -> Json.obj(
          "playerId" -> str(player),
          "matchId" -> str(matchId),
          "length" -> int(length.toLong)
        )
      )
      .toMap ++ deaths.toList
      .minByOption((c, n) => (-n, c))
      .map((c, _) => "mostCommonDeathCause" -> str(c)) ++ Option
      .when(deaths.nonEmpty)("deathsByCause" -> counts(deaths))
