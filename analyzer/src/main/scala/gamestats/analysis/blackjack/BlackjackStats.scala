package gamestats.analysis.blackjack

import gamestats.analysis.Metrics.*
import gamestats.model.{BlackjackEvent, MatchAnalysis}
import gamestats.model.BlackjackEvent.*
import io.circe.Json

/** blackjack statistics B1 to B6. Every one is a named pure function over the typed events of one
  * match.
  */
object BlackjackStats:

  /** Chips each player starts with when MATCH_STARTED does not say. */
  val defaultChips = 1000L

  private def hands(events: List[BlackjackEvent]): List[HandResult] =
    events.collect { case h: HandResult => h }

  /** B1 for one player: a PUSH counts as a hand played, not as a win. */
  final case class Record(hands: Int, wins: Int):
    def winPct: Double = if hands == 0 then 0.0 else 100.0 * wins / hands

  /** B1. */
  def record(events: List[BlackjackEvent]): Map[String, Record] =
    hands(events)
      .groupBy(_.playerId)
      .view
      .mapValues(hs => Record(hs.size, hs.count(_.result == "WIN")))
      .toMap

  /** B2 for one player. */
  final case class Money(netGain: Long, bestHand: Long, worstHand: Long)

  /** B2: chips after the last hand minus the starting chips, and the best and worst payout. */
  def money(events: List[BlackjackEvent], startingChips: Long): Map[String, Money] =
    hands(events)
      .groupBy(_.playerId)
      .view
      .mapValues { hs =>
        val payouts = hs.map(_.payout)
        Money(hs.maxBy(_.meta.seq).chips - startingChips, payouts.max, payouts.min)
      }
      .toMap

  /** B3: busts and blackjacks, as (busts, blackjacks). */
  def bustsAndBlackjacks(events: List[BlackjackEvent]): Map[String, (Int, Int)] =
    events.foldLeft(Map.empty[String, (Int, Int)]) {
      case (acc, b: Bust) =>
        val (busts, bjs) = acc.getOrElse(b.playerId, (0, 0))
        acc.updated(b.playerId, (busts + 1, bjs))
      case (acc, b: Blackjack) =>
        val (busts, bjs) = acc.getOrElse(b.playerId, (0, 0))
        acc.updated(b.playerId, (busts, bjs + 1))
      case (acc, _) => acc
    }

  /** Chips after each hand, as (round, chips) in round order, for the board's chart. */
  def chipsByRound(events: List[BlackjackEvent]): Map[String, List[(Int, Long)]] =
    hands(events)
      .groupBy(_.playerId)
      .view
      .mapValues(_.sortBy(_.round).map(h => h.round -> h.chips))
      .toMap

  /** B4 for one player: hands doubled, how many were won and their net gain. */
  final case class Doubles(count: Int, won: Int, net: Long):
    def winPct: Double = if count == 0 then 0.0 else 100.0 * won / count

  /** B4 (combines DECISION and HAND_RESULT): each DECISION with action DOUBLE is joined with the
    * HAND_RESULT of the same (playerId, round).
    */
  def doubles(events: List[BlackjackEvent]): Map[String, Doubles] =
    val result = hands(events).map(h => (h.playerId, h.round) -> h).toMap
    events
      .collect { case d: Decision if d.action == "DOUBLE" => d }
      .flatMap(d => result.get((d.playerId, d.round)))
      .groupBy(_.playerId)
      .view
      .mapValues(hs => Doubles(hs.size, hs.count(_.result == "WIN"), hs.map(_.payout).sum))
      .toMap

  /** B5: what the house won (payouts with the sign changed), rounds where the dealer went over 21
    * (its last DEALER_CARD of the round has dealerValue > 21) and the highest bet (on a tie, the
    * first).
    */
  def matchSummary(events: List[BlackjackEvent]): Map[String, Json] =
    val dealerBusts = events
      .collect { case d: DealerCard => d }
      .groupBy(_.round)
      .values
      .count(cards => cards.maxBy(_.meta.seq).dealerValue > 21)
    val highest = events
      .collect { case b: BetPlaced => b }
      .minByOption(b => (-b.amount, b.meta.seq))
    Map(
      "houseGain" -> int(-hands(events).map(_.payout).sum),
      "dealerBusts" -> int(dealerBusts.toLong),
      "hands" -> int(hands(events).size.toLong)
    ) ++ highest.map(b =>
      "highestBet" -> Json.obj(
        "playerId" -> str(b.playerId),
        "round" -> int(b.round.toLong),
        "amount" -> int(b.amount)
      )
    )

  /** B6 for one table with CPU players (`bots` of MATCH_STARTED) or decisions of the AI.
    * tableWinner is HUMAN when a human is in first place and CPU otherwise; a PARTIAL or LIVE match
    * has no placements, so it has no winner yet. aiFallbacks counts the AI_DECISION events where
    * the AI gave its fallback answer. Empty for a table of humans only.
    */
  def cpuTable(
      events: List[BlackjackEvent],
      bots: List[String],
      placements: Map[String, Int]
  ): Map[String, Json] =
    val ai = events.collect { case d: AiDecision => d }
    val first = placements.collect { case (p, 1) => p }.toList
    val winner = Option.when(bots.nonEmpty && first.nonEmpty)(
      if first.exists(p => !bots.contains(p)) then "HUMAN" else "CPU"
    )
    if bots.isEmpty && ai.isEmpty then Map.empty
    else
      Map(
        "bots" -> Json.arr(bots.distinct.sorted.map(str)*),
        "aiDecisions" -> int(ai.size.toLong),
        "aiFallbacks" -> int(ai.count(_.fallback).toLong)
      ) ++ winner.map("tableWinner" -> str(_))

  /** B6 for the game, from the cpuTable metrics of every match: tables with CPU players that have a
    * winner, % won by humans and by the CPU, and the AI decisions with their fallbacks. Empty if no
    * match had CPU players.
    */
  def cpuSummary(matches: List[MatchAnalysis]): Map[String, Json] =
    def count(m: MatchAnalysis, key: String): Long =
      m.matchMetrics.get(key).flatMap(_.asNumber).flatMap(_.toLong).getOrElse(0L)
    val withCpu = matches.filter(_.matchMetrics.contains("aiDecisions"))
    val winners = withCpu.flatMap(_.matchMetrics.get("tableWinner").flatMap(_.asString))
    def pct(side: String): Double =
      if winners.isEmpty then 0.0 else 100.0 * winners.count(_ == side) / winners.size
    if withCpu.isEmpty then Map.empty
    else
      Map(
        "cpuTables" -> int(winners.size.toLong),
        "humanTableWinPct" -> num(pct("HUMAN")),
        "cpuTableWinPct" -> num(pct("CPU")),
        "aiDecisions" -> int(withCpu.map(count(_, "aiDecisions")).sum),
        "aiFallbacks" -> int(withCpu.map(count(_, "aiFallbacks")).sum)
      )
