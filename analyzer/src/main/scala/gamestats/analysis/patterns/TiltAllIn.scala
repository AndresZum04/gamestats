package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.BlackjackEvent
import gamestats.model.BlackjackEvent.*

/** P6, All-in por frustración (blackjack): a BET_PLACED with amount == chipsBefore right after 3
  * HAND_RESULT LOSE in a row of the same player.
  *
  * Each bet is compared with the player's 3 previous hands, taken from the events before it.
  */
object TiltAllIn:
  val id = "P6"
  val name = "All-in por frustración"
  val losses = 3

  val detect: PatternDetector[BlackjackEvent] = ctx =>
    val hands = ctx.events.collect { case h: HandResult => h }
    ctx.events
      .collect {
        case b: BetPlaced if b.amount == b.chipsBefore => b
      }
      .flatMap { bet =>
        val previous = hands.filter(h => h.playerId == bet.playerId && h.meta.seq < bet.meta.seq)
        val last = previous.takeRight(losses)
        Option
          .when(last.size == losses && last.forall(_.result == "LOSE"))(
            Patterns.make(
              ctx,
              id,
              name,
              Some(bet.playerId),
              None,
              bet.meta.atMs,
              s"${bet.playerId} perdió $losses manos seguidas y apostó todas sus fichas " +
                s"(${bet.amount}) en la ronda ${bet.round}",
              last.map(_.meta.eventId) :+ bet.meta.eventId
            )
          )
          .toList
      }
