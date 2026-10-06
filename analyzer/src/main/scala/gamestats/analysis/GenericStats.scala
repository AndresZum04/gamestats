package gamestats.analysis

import gamestats.model.*

import java.time.Duration

/** Statistics every game gets, as pure functions over the generic events. G3 to G6 are added in
  * T12.
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
