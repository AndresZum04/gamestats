package gamestats.analysis.racing

import gamestats.analysis.Metrics
import gamestats.model.RacingEvent
import gamestats.model.RacingEvent.*
import io.circe.Json

/** racing-pro statistics R1 to R7. Every one is a named pure function over the typed events of one
  * race.
  */
object RacingStats:

  /** R1 for one driver. stdDev is the population standard deviation. */
  final case class LapStats(bestMs: Long, avgMs: Double, stdDevMs: Double)

  /** Each driver's laps, ordered by lap number. */
  val lapsByPlayer: List[RacingEvent] => Map[String, List[LapCompleted]] =
    events =>
      events
        .collect { case l: LapCompleted => l }
        .groupBy(_.playerId)
        .view
        .mapValues(_.sortBy(_.lap))
        .toMap

  /** R1: best, average and standard deviation of a list of lap times. The sum and the sum of
    * squares come from a single foldLeft.
    */
  val lapStats: List[Long] => Option[LapStats] = times =>
    Option.when(times.nonEmpty) {
      val (sum, sumSq) = times.foldLeft((0.0, 0.0)) { case ((s, sq), t) =>
        (s + t, sq + t.toDouble * t)
      }
      val avg = sum / times.size
      LapStats(times.min, avg, math.sqrt(math.max(sumSq / times.size - avg * avg, 0.0)))
    }

  /** R2 from R1: 1 - stdDev / avg, rounded to 3 decimals. */
  val consistency: LapStats => Double = s =>
    BigDecimal(1 - s.stdDevMs / s.avgMs).setScale(3, BigDecimal.RoundingMode.HALF_UP).toDouble

  /** R2 as a composition of R1: lap times -> LapStats -> index. */
  val consistencyOf: List[Long] => Option[Double] = lapStats andThen (_.map(consistency))

  /** R3: position after lap 1 minus final placement (positive = gained). Needs the final
    * placements, so a PARTIAL race gets nothing.
    */
  def positionsGained(events: List[RacingEvent], placements: Map[String, Int]): Map[String, Int] =
    lapsByPlayer(events).flatMap { (p, laps) =>
      for
        first <- laps.collectFirst { case l if l.lap == 1 => l.position }
        last <- placements.get(p)
      yield p -> (first - last)
    }

  /** R4: POSITION_CHANGED with action OVERTAKE, per driver. */
  def overtakes(events: List[RacingEvent]): Map[String, Int] =
    events
      .collect { case c: PositionChanged if c.action == "OVERTAKE" => c.playerId }
      .groupBy(identity)
      .view
      .mapValues(_.size)
      .toMap

  /** R5: race summary. */
  def raceSummary(events: List[RacingEvent]): Map[String, Json] =
    val fastest = events.collect { case l: LapCompleted => l }.minByOption(_.lapTimeMs)
    val (crashes, penaltySeconds) = events.foldLeft((0, 0.0)) {
      case ((c, s), _: Crash)   => (c + 1, s)
      case ((c, s), p: Penalty) => (c, s + p.seconds)
      case (acc, _)             => acc
    }
    fastest.toList
      .flatMap(f =>
        List(
          "fastestLapMs" -> Json.fromLong(f.lapTimeMs),
          "fastestLapPlayer" -> Json.fromString(f.playerId)
        )
      )
      .toMap ++ Map(
      "overtakes" -> Json.fromInt(overtakes(events).values.sum),
      "crashes" -> Json.fromInt(crashes),
      "penaltySeconds" -> Metrics.num(penaltySeconds)
    )

  /** Laps of a driver touched by a crash, a penalty or a pit stop. */
  private def dirtyLaps(events: List[RacingEvent]): Map[String, Set[Int]] =
    events
      .collect {
        case c: Crash   => c.playerId -> c.lap
        case p: Penalty => p.playerId -> p.lap
        case p: PitStop => p.playerId -> p.lap
      }
      .groupBy(_._1)
      .view
      .mapValues(_.map(_._2).toSet)
      .toMap

  /** R6 (combines LAP_COMPLETED, CRASH and PENALTY): for each lap with an incident, its time minus
    * the average of the driver's clean laps (once per lap), plus the penalty seconds. Summed per
    * driver, in ms. Drivers without incidents get 0.
    */
  def incidentImpact(events: List[RacingEvent]): Map[String, Long] =
    val laps = lapsByPlayer(events)
    val dirty = dirtyLaps(events)
    val incidents = events.collect {
      case c: Crash   => (c.playerId, c.lap, 0L)
      case p: Penalty => (p.playerId, p.lap, math.round(p.seconds * 1000))
    }
    val impact = incidents.groupBy(_._1).map { (p, items) =>
      val times = laps.getOrElse(p, Nil).map(l => l.lap -> l.lapTimeMs).toMap
      val clean = Metrics.average(times.collect {
        case (lap, t) if !dirty.getOrElse(p, Set.empty)(lap) => t.toDouble
      }.toList)
      val lapPart =
        items.map(_._2).distinct.flatMap(lap => times.get(lap).map(t => clean.fold(0.0)(t - _))).sum
      p -> math.round(lapPart + items.map(_._3).sum)
    }
    laps.keys.map(p => p -> impact.getOrElse(p, 0L)).toMap

  /** R7 (combines PIT_STOP and LAP_COMPLETED): average of the 3 laps after each stop minus the
    * average of the 3 before it; negative means the driver got faster. The pit lap itself is left
    * out. Averaged over the driver's stops; drivers without a usable stop get nothing.
    */
  def pitEffect(events: List[RacingEvent]): Map[String, Double] =
    val laps = lapsByPlayer(events)
    events
      .collect { case p: PitStop => p }
      .flatMap { pit =>
        val (before, rest) = laps.getOrElse(pit.playerId, Nil).span(_.lap < pit.lap)
        val after = rest.dropWhile(_.lap == pit.lap).take(3)
        for
          b <- Metrics.average(before.takeRight(3).map(_.lapTimeMs.toDouble))
          a <- Metrics.average(after.map(_.lapTimeMs.toDouble))
        yield pit.playerId -> (a - b)
      }
      .groupBy(_._1)
      .flatMap((p, effects) => Metrics.average(effects.map(_._2)).map(p -> _))
