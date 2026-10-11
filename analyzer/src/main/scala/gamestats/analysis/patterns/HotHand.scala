package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.BlackjackEvent
import gamestats.model.BlackjackEvent.HandResult

/** P5, Mano caliente (blackjack): 4 or more HAND_RESULT WIN in a row by the same player, ordered by
  * round. A PUSH or a LOSE ends the run; each run is reported once.
  */
object HotHand:
  val id = "P5"
  val name = "Mano caliente"
  val minWins = 4

  val detect: PatternDetector[BlackjackEvent] = ctx =>
    ctx.events
      .collect { case h: HandResult => h }
      .groupBy(_.playerId)
      .toList
      .sortBy(_._1)
      .flatMap { (player, hands) =>
        Patterns
          .runs(hands.sortBy(_.round))(_.result == "WIN")
          .filter(_.size >= minWins)
          .map(run =>
            Patterns.make(
              ctx,
              id,
              name,
              Some(player),
              None,
              run.last.meta.atMs,
              s"$player ganó ${run.size} manos seguidas " +
                s"(rondas ${run.head.round} a ${run.last.round})",
              run.map(_.meta.eventId)
            )
          )
      }
