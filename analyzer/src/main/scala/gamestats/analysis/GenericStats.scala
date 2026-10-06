package gamestats.analysis

import gamestats.analysis.Metrics.*
import gamestats.model.*
import gamestats.model.CommonEvent.*
import io.circe.Json

import java.time.Duration

/** Statistics every game gets (G1 to G6), as pure functions. G1 and G2 read the raw events; G3, G5
  * and G6 read the typed common events. G4 is a game level figure: here each player only gets
  * `left`, and the rate is computed over all matches in Aggregates.
  */
object GenericStats:

  /** G1: how many events of each type the match has. */
  def eventsByType(events: List[Event]): Map[String, Int] =
    events.groupBy(_.eventType).view.mapValues(_.size).toMap

  /** G2: match duration. MATCH_FINISHED says it; a PARTIAL match uses the time between its first
    * and last event.
    */
  def durationMs(events: List[Event]): Long =
    events
      .collectFirst {
        case e if e.eventType == "MATCH_FINISHED" =>
          e.data("durationMs").flatMap(_.asNumber).flatMap(_.toLong)
      }
      .flatten
      .getOrElse(
        if events.isEmpty then 0L
        else
          Duration
            .between(events.minBy(_.timestamp).timestamp, events.maxBy(_.timestamp).timestamp)
            .toMillis
      )

  /** G3 (and the base of G4): disconnections, total time away and whether the player left. Every
    * player gets the three values, zero by default.
    */
  def presence(players: List[String], common: List[CommonEvent]): PlayerMetrics =
    val disconnections = common
      .collect { case PlayerDisconnected(_, p) => p }
      .groupBy(identity)
      .view
      .mapValues(_.size)
      .toMap
    val away = common
      .collect { case PlayerReconnected(_, p, ms) => p -> ms }
      .foldLeft(Map.empty[String, Long]) { case (acc, (p, ms)) =>
        acc.updated(p, acc.getOrElse(p, 0L) + ms)
      }
    val left = common.collect { case PlayerLeft(_, p, _) => p }.toSet
    (players.toSet ++ disconnections.keySet ++ away.keySet ++ left).toList.map { p =>
      p -> Map(
        "disconnections" -> int(disconnections.getOrElse(p, 0).toLong),
        "awayMs" -> int(away.getOrElse(p, 0L)),
        "left" -> bool(left(p))
      )
    }.toMap

  /** G5: final score (last total of SCORE_CHANGED) and the longest run of positive deltas in a row.
    * Players without score events get nothing.
    */
  def scores(common: List[CommonEvent]): PlayerMetrics =
    common
      .collect { case s: ScoreChanged => s }
      .groupBy(_.playerId)
      .view
      .mapValues { events =>
        val ordered = events.sortBy(_.meta.seq)
        val (_, longest) = ordered.foldLeft((0, 0)) { case ((current, best), s) =>
          if s.delta > 0 then (current + 1, math.max(best, current + 1)) else (0, best)
        }
        Map(
          "finalScore" -> num(ordered.lastOption.map(_.total).getOrElse(0.0)),
          "longestScoreStreak" -> int(longest.toLong)
        )
      }
      .toMap

  /** G6: average and longest turn, from TURN_ENDED. Omitted for players without turns.
    */
  def turnTimes(common: List[CommonEvent]): PlayerMetrics =
    common
      .collect { case TurnEnded(_, p, _, durationMs) => p -> durationMs }
      .groupBy(_._1)
      .view
      .mapValues { pairs =>
        val durations = pairs.map(_._2)
        Map(
          "turns" -> int(durations.size.toLong),
          "avgTurnMs" -> num(average(durations.map(_.toDouble)).getOrElse(0.0)),
          "maxTurnMs" -> int(durations.max)
        )
      }
      .toMap

  /** Match level counts shared by every game. */
  def matchSummary(players: List[String], common: List[CommonEvent]): Map[String, Json] =
    Map(
      "players" -> int(players.size.toLong),
      "playersLeft" -> int(common.collect { case PlayerLeft(_, p, _) => p }.distinct.size.toLong)
    )
