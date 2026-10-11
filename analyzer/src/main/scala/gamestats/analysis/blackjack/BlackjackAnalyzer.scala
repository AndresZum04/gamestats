package gamestats.analysis.blackjack

import gamestats.analysis.*
import gamestats.analysis.Metrics.*
import gamestats.codec.Typed
import gamestats.model.*
import io.circe.Json

import java.time.Instant

/** blackjack: B1 to B4 per player and B5 for the match. The starting chips come from MATCH_STARTED
  * (1000 if missing).
  */
object BlackjackAnalyzer extends ComposedAnalyzer[BlackjackEvent]:
  val gameId = "blackjack"

  protected def toTyped(e: Event, start: Instant): Option[BlackjackEvent] =
    Typed.toBlackjack(e, start)

  override protected def playerMetrics(ctx: MatchContext[BlackjackEvent]): PlayerMetrics =
    import BlackjackStats.*
    val events = ctx.events
    val chips = ctx.startNumber("startingChips").fold(defaultChips)(_.toLong)
    val b1: PlayerMetrics = record(events).view
      .mapValues(r =>
        Map("hands" -> int(r.hands.toLong), "wins" -> int(r.wins.toLong), "winPct" -> num(r.winPct))
      )
      .toMap
    val b2: PlayerMetrics = money(events, chips).view
      .mapValues(m =>
        Map(
          "netGain" -> int(m.netGain),
          "bestHand" -> int(m.bestHand),
          "worstHand" -> int(m.worstHand)
        )
      )
      .toMap
    val b3: PlayerMetrics = bustsAndBlackjacks(events).view
      .mapValues((busts, bjs) => Map("busts" -> int(busts.toLong), "blackjacks" -> int(bjs.toLong)))
      .toMap
    val b4: PlayerMetrics = doubles(events).view
      .mapValues(d =>
        Map(
          "doubles" -> int(d.count.toLong),
          "doubleWinPct" -> num(d.winPct),
          "doubleNet" -> int(d.net)
        )
      )
      .toMap
    Metrics.merge(b1, b2, b3, b4)

  override protected def matchMetrics(ctx: MatchContext[BlackjackEvent]): Map[String, Json] =
    BlackjackStats.matchSummary(ctx.events)
