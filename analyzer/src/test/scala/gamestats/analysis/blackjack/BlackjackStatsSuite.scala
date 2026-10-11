package gamestats.analysis.blackjack

import gamestats.fixtures.Fixtures.*
import gamestats.model.*
import io.circe.Json

/** B1 to B5 on a hand-written match of 3 rounds with 500 starting chips:
  *
  * {{{
  * round  p-mari                                p-gabo                          dealer
  * 1      bets 100, doubles on 11, WIN +200     bets 50, busts (24), LOSE -50   6, 16, 26: busts
  * 2      bets 100, doubles on 10, LOSE -200    bets 450 (all in), BLACKJACK,   10, 20
  *                                              WIN +675
  * 3      bets 100, PUSH 0                      bets 100, LOSE -100             10, 18
  * chips  500 -> 700 -> 500 -> 500              500 -> 450 -> 1125 -> 1025
  * }}}
  */
class BlackjackStatsSuite extends munit.FunSuite:

  def bet(at: Double, p: String, round: Int, amount: Int, before: Int): Spec =
    e(at, "BET_PLACED", p, "round" -> n(round), "amount" -> n(amount), "chipsBefore" -> n(before))

  def dealer(at: Double, round: Int, card: String, value: Int): Spec =
    sys(
      at,
      "DEALER_CARD",
      "round" -> n(round),
      "card" -> s(card),
      "hidden" -> b(false),
      "dealerValue" -> n(value)
    )

  def hand(at: Double, p: String, round: Int, result: String, payout: Int, chips: Int): Spec =
    e(
      at,
      "HAND_RESULT",
      p,
      "round" -> n(round),
      "result" -> s(result),
      "payout" -> n(payout),
      "chips" -> n(chips)
    )

  def decision(at: Double, p: String, round: Int, value: Int): Spec =
    e(at, "DECISION", p, "round" -> n(round), "handValue" -> n(value))

  /** Each spec with the action of its envelope, for DECISION. */
  val specs: List[(Spec, Option[String])] = List(
    sys(
      0,
      "MATCH_STARTED",
      "players" -> arr("p-mari", "p-gabo"),
      "mode" -> s("TABLE"),
      "startingChips" -> n(500)
    ) -> None,
    sys(1, "ROUND_STARTED", "round" -> n(1)) -> None,
    bet(2, "p-mari", 1, 100, 500) -> None,
    bet(3, "p-gabo", 1, 50, 500) -> None,
    dealer(4, 1, "6S", 6) -> None,
    decision(5, "p-mari", 1, 11) -> Some("DOUBLE"),
    e(6, "BUST", "p-gabo", "round" -> n(1), "handValue" -> n(24)) -> None,
    dealer(7, 1, "KH", 16) -> None,
    dealer(8, 1, "QD", 26) -> None,
    hand(9, "p-mari", 1, "WIN", 200, 700) -> None,
    hand(10, "p-gabo", 1, "LOSE", -50, 450) -> None,
    sys(11, "ROUND_STARTED", "round" -> n(2)) -> None,
    bet(12, "p-mari", 2, 100, 700) -> None,
    bet(13, "p-gabo", 2, 450, 450) -> None,
    dealer(14, 2, "10C", 10) -> None,
    decision(15, "p-mari", 2, 10) -> Some("DOUBLE"),
    e(16, "BLACKJACK", "p-gabo", "round" -> n(2)) -> None,
    dealer(17, 2, "JS", 20) -> None,
    hand(18, "p-mari", 2, "LOSE", -200, 500) -> None,
    hand(19, "p-gabo", 2, "WIN", 675, 1125) -> None,
    sys(20, "ROUND_STARTED", "round" -> n(3)) -> None,
    bet(21, "p-mari", 3, 100, 500) -> None,
    bet(22, "p-gabo", 3, 100, 1125) -> None,
    decision(23, "p-mari", 3, 18) -> Some("STAND"),
    dealer(24, 3, "10D", 10) -> None,
    dealer(25, 3, "8H", 18) -> None,
    hand(26, "p-mari", 3, "PUSH", 0, 500) -> None,
    hand(27, "p-gabo", 3, "LOSE", -100, 1025) -> None,
    sys(
      28,
      "MATCH_FINISHED",
      "durationMs" -> n(28000),
      "results" -> results("p-gabo" -> 1, "p-mari" -> 2)
    ) -> None
  )

  val table: MatchBatch = batch(
    "blackjack",
    specs.map(_._1),
    action = specs.zipWithIndex.collect { case ((_, Some(a)), i) => (i + 1) -> a }.toMap
  )
  val result: MatchAnalysis = BlackjackAnalyzer.analyze(table)

  def metrics(p: String): Map[String, Json] =
    result.players.find(_.playerId == p).map(_.metrics).getOrElse(fail(s"no player $p"))

  def dbl(j: Json): Double = j.asNumber.map(_.toDouble).getOrElse(fail(s"$j is not a number"))

  test("B1: % of wins over hands played; a PUSH is a hand but not a win") {
    val mari = metrics("p-mari")
    assertEquals((dbl(mari("hands")), dbl(mari("wins"))), (3.0, 1.0)) // WIN, LOSE, PUSH
    assertEquals(dbl(mari("winPct")), 33.3)
  }

  test("B2: net gain against the starting chips of MATCH_STARTED, best and worst hand") {
    val gabo = metrics("p-gabo")
    assertEquals(dbl(gabo("netGain")), 525.0) // 1025 - 500
    assertEquals((dbl(gabo("bestHand")), dbl(gabo("worstHand"))), (675.0, -100.0))
    assertEquals(dbl(metrics("p-mari")("netGain")), 0.0) // back to 500
  }

  test("B3: busts and blackjacks") {
    val gabo = metrics("p-gabo")
    assertEquals((dbl(gabo("busts")), dbl(gabo("blackjacks"))), (1.0, 1.0))
    assertEquals(metrics("p-mari").get("busts"), None) // neither: no B3 metrics
  }

  test("B4: doubles joined with the result of the same (player, round)") {
    val mari = metrics("p-mari")
    // round 1 doubled and won (+200), round 2 doubled and lost (-200); STAND in round 3 is not a double
    assertEquals(dbl(mari("doubles")), 2.0)
    assertEquals(dbl(mari("doubleWinPct")), 50.0)
    assertEquals(dbl(mari("doubleNet")), 0.0)
    assertEquals(metrics("p-gabo").get("doubles"), None)
  }

  test("B5: what the house won, dealer busts and the highest bet") {
    val m = result.matchMetrics
    // payouts 200 - 50 - 200 + 675 + 0 - 100 = 525, so the house lost 525
    assertEquals(dbl(m("houseGain")), -525.0)
    assertEquals(dbl(m("dealerBusts")), 1.0) // only round 1 ends above 21
    assertEquals(
      m("highestBet"),
      Json.obj(
        "playerId" -> Json.fromString("p-gabo"),
        "round" -> Json.fromLong(2),
        "amount" -> Json.fromLong(450)
      )
    )
    assertEquals(dbl(m("hands")), 6.0)
  }

  test("chips by round for the board") {
    def rounds(p: String): List[(Int, Long)] =
      metrics(p)("chipsByRound").asArray.get.toList.map(r =>
        (r.hcursor.get[Int]("round").toOption.get, r.hcursor.get[Long]("chips").toOption.get)
      )
    assertEquals(rounds("p-gabo"), List(1 -> 450L, 2 -> 1125L, 3 -> 1025L))
    assertEquals(rounds("p-mari"), List(1 -> 700L, 2 -> 500L, 3 -> 500L))
  }

  test("a game win is first place: p-gabo") {
    assertEquals(
      result.players.map(p => (p.playerId, p.placement)),
      List(("p-gabo", Some(1)), ("p-mari", Some(2)))
    )
  }
