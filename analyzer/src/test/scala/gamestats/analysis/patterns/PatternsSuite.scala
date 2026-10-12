package gamestats.analysis.patterns

import gamestats.analysis.blackjack.BlackjackAnalyzer
import gamestats.analysis.snake.SnakeAnalyzer
import gamestats.analysis.trivia.TriviaAnalyzer
import gamestats.fixtures.Fixtures.*
import gamestats.model.*

/** Each pattern with a hand-written match that shows it and one that almost does (the "near miss"),
  * which must give nothing.
  */
class PatternsSuite extends munit.FunSuite:

  def ids(a: MatchAnalysis): List[(String, Option[String])] =
    a.patterns.map(p => (p.patternId, p.playerId))

  test("runs splits a list into the runs that satisfy the condition") {
    assertEquals(Patterns.runs(List(1, 2, -1, 3, 4, 5, -2))(_ > 0), List(List(1, 2), List(3, 4, 5)))
    assertEquals(Patterns.runs(List(-1, -2))(_ > 0), Nil)
    assertEquals(Patterns.runs(List.empty[Int])(_ > 0), Nil)
  }

  // --- trivia ------------------------------------------------------------------------------

  /** One player answering questions 1..n: C right, W wrong, T timeout. */
  def answers(row: String): MatchBatch =
    val specs = row.toList.zipWithIndex.flatMap { (c, i) =>
      val q = s"q$i"
      val t = i * 20.0
      val shown = sys(
        t,
        "QUESTION_SHOWN",
        "questionId" -> s(q),
        "number" -> n(i + 1),
        "category" -> s("CIENCIA"),
        "difficulty" -> s("EASY"),
        "timeLimitMs" -> n(10000)
      )
      val act =
        if c == 'T' then e(t + 10, "ANSWER_TIMEOUT", "p-ana", "questionId" -> s(q))
        else
          e(
            t + 2,
            "ANSWER_SUBMITTED",
            "p-ana",
            "questionId" -> s(q),
            "option" -> s("A"),
            "correct" -> b(c == 'C'),
            "responseMs" -> n(2000)
          )
      List(shown, act)
    }
    batch(
      "trivia",
      sys(0, "MATCH_STARTED", "players" -> arr("p-ana"), "mode" -> s("CLASSIC")) :: specs
    )

  test("P1: 5 right answers in a row, reported once with the 5 answers as evidence") {
    val a = TriviaAnalyzer.analyze(answers("WCCCCCW"))
    assertEquals(ids(a), List(("P1", Some("p-ana"))))
    assertEquals(a.patterns.head.evidence.size, 5)
    // Two streaks of 5 are two matches.
    assertEquals(TriviaAnalyzer.analyze(answers("CCCCCWCCCCC")).patterns.size, 2)
  }

  test("P1 near miss: 4 right, a timeout, then 1 right is not a streak") {
    assertEquals(TriviaAnalyzer.analyze(answers("CCCCTC")).patterns, Nil)
    assertEquals(TriviaAnalyzer.analyze(answers("CCCCWC")).patterns, Nil)
  }

  /** Three players; deltas(p)(q) is what player p scores in question q. Placements are given. */
  def scores(deltas: Map[String, List[Int]], placements: (String, Int)*): List[Spec] =
    val players = deltas.keys.toList.sorted
    val questions = deltas.values.head.size
    val start = sys(0, "MATCH_STARTED", "players" -> arr(players*), "mode" -> s("CLASSIC"))
    val body = (0 until questions).toList.flatMap { q =>
      val t = q * 20.0
      val shown = sys(
        t + 1,
        "QUESTION_SHOWN",
        "questionId" -> s(s"q$q"),
        "number" -> n(q + 1),
        "category" -> s("HISTORIA"),
        "difficulty" -> s("EASY"),
        "timeLimitMs" -> n(10000)
      )
      val changes = players.map { p =>
        val d = deltas(p)
        e(t + 5, "SCORE_CHANGED", p, "delta" -> n(d(q)), "total" -> n(d.take(q + 1).sum))
      }
      val closed = sys(
        t + 12,
        "QUESTION_CLOSED",
        "questionId" -> s(s"q$q"),
        "correctOption" -> s("A"),
        "correctCount" -> n(1)
      )
      (shown :: changes) :+ closed
    }
    val end = sys(
      questions * 20.0,
      "MATCH_FINISHED",
      "durationMs" -> n(questions * 20000),
      "results" -> results(placements*)
    )
    (start :: body) :+ end

  test("P2: alone in last place after question 2, then first") {
    // totals after Q2: p-ana 200, p-sofi 100, p-luis 0; final p-luis 400, the others 200
    val specs = scores(
      Map(
        "p-ana" -> List(100, 100, 0, 0),
        "p-sofi" -> List(0, 100, 100, 0),
        "p-luis" -> List(0, 0, 200, 200)
      ),
      "p-luis" -> 1,
      "p-ana" -> 2,
      "p-sofi" -> 2
    )
    val a = TriviaAnalyzer.analyze(batch("trivia", specs))
    assertEquals(ids(a), List(("P2", Some("p-luis"))))
    // A PARTIAL match has no final placement: nothing to report.
    assertEquals(
      TriviaAnalyzer.analyze(batch("trivia", specs, status = BatchStatus.PARTIAL)).patterns,
      Nil
    )
  }

  test("P2 near miss: alone in last place only after question 1, or alone last and not first") {
    // after Q1 p-luis is alone last (not counted); from Q2 on he is always tied
    val onlyFirst = scores(
      Map(
        "p-ana" -> List(100, 0, 100, 0),
        "p-sofi" -> List(100, 100, 0, 0),
        "p-luis" -> List(0, 100, 100, 300)
      ),
      "p-luis" -> 1,
      "p-ana" -> 2,
      "p-sofi" -> 2
    )
    assertEquals(TriviaAnalyzer.analyze(batch("trivia", onlyFirst)).patterns, Nil)
    // p-luis alone last after Q2 but finishes 2nd
    val notFirst = scores(
      Map(
        "p-ana" -> List(100, 100, 0, 0),
        "p-sofi" -> List(0, 100, 100, 100),
        "p-luis" -> List(0, 0, 200, 0)
      ),
      "p-sofi" -> 1,
      "p-luis" -> 2,
      "p-ana" -> 2
    )
    assertEquals(TriviaAnalyzer.analyze(batch("trivia", notFirst)).patterns, Nil)
  }

  // --- snake -------------------------------------------------------------------------------

  def food(at: Double): Spec =
    e(at, "FOOD_EATEN", "p-kev", "foodType" -> s("APPLE"), "length" -> n(4), "points" -> n(10))

  def died(at: Double): Spec =
    e(at, "SNAKE_DIED", "p-kev", "cause" -> s("WALL"), "length" -> n(8), "livesLeft" -> n(2))

  def snake(specs: Spec*): MatchAnalysis =
    SnakeAnalyzer.analyze(
      batch(
        "snake",
        sys(0, "MATCH_STARTED", "players" -> arr("p-kev"), "mode" -> s("CLASSIC")) :: specs.toList
      )
    )

  test("P3: 5 fruits within 15 s, once per life") {
    val a = snake(food(10), food(13), food(16), food(19), food(25), food(28)) // 10 to 25: 15 s
    assertEquals(ids(a), List(("P3", Some("p-kev"))))
    assertEquals(a.patterns.head.evidence.size, 5)
    // a second burst in a new life counts again
    val twoLives = snake(
      food(10),
      food(11),
      food(12),
      food(13),
      food(14),
      died(16),
      food(20),
      food(21),
      food(22),
      food(23),
      food(24)
    )
    assertEquals(twoLives.patterns.map(_.patternId), List("P3", "P3"))
  }

  test("P3 near miss: 15.001 s, or 5 fast fruits split by a death") {
    assertEquals(snake(food(10), food(13), food(16), food(19), food(25.001)).patterns, Nil)
    assertEquals(
      snake(food(10), food(11), food(12), died(15), food(17), food(18)).patterns.map(_.patternId),
      Nil
    )
  }

  test("P4: death less than 2 s after a fruit") {
    val a = snake(food(10), died(11.999))
    assertEquals(ids(a), List(("P4", Some("p-kev"))))
    assertEquals(a.patterns.head.evidence.size, 2)
  }

  test("P4 near miss: death exactly 2 s after the fruit") {
    assertEquals(snake(food(10), died(12)).patterns, Nil)
  }

  // --- blackjack ---------------------------------------------------------------------------

  /** p-mari plays one hand per round: W win, L lose, P push. bets(round) overrides the bet of 100;
    * chips follow the results from 1000.
    */
  def table(row: String, bets: Map[Int, Int] = Map.empty): MatchAnalysis =
    val (specs, _) = row.toList.zipWithIndex.foldLeft((List.empty[Spec], 1000)) {
      case ((acc, chips), (c, i)) =>
        val round = i + 1
        val amount = bets.getOrElse(round, 100)
        val payout = c match
          case 'W' => amount
          case 'L' => -amount
          case _   => 0
        val result = Map('W' -> "WIN", 'L' -> "LOSE", 'P' -> "PUSH")(c)
        val t = round * 10.0
        val hand = List(
          e(
            t,
            "BET_PLACED",
            "p-mari",
            "round" -> n(round),
            "amount" -> n(amount),
            "chipsBefore" -> n(chips)
          ),
          e(
            t + 5,
            "HAND_RESULT",
            "p-mari",
            "round" -> n(round),
            "result" -> s(result),
            "payout" -> n(payout),
            "chips" -> n(chips + payout)
          )
        )
        (acc ++ hand, chips + payout)
    }
    BlackjackAnalyzer.analyze(
      batch(
        "blackjack",
        sys(0, "MATCH_STARTED", "players" -> arr("p-mari"), "mode" -> s("TABLE")) :: specs
      )
    )

  test("P5: 4 wins in a row, reported once per run") {
    val a = table("LWWWWWL")
    assertEquals(ids(a), List(("P5", Some("p-mari"))))
    assertEquals(a.patterns.head.evidence.size, 5)
  }

  test("P5 near miss: a PUSH ends the run") {
    assertEquals(table("WWWPW").patterns, Nil)
  }

  test("P6: all in right after 3 losses in a row") {
    // chips 1000 -> 900 -> 800 -> 700, then a bet of 700
    val a = table("LLLW", bets = Map(4 -> 700))
    assertEquals(ids(a), List(("P6", Some("p-mari"))))
    assertEquals(a.patterns.head.evidence.size, 4) // 3 losses + the bet
  }

  test("P6 near miss: a PUSH among the losses, or a bet below the chips") {
    // L L P L: the three hands before the bet are L, P, L
    assertEquals(table("LLPLW", bets = Map(5 -> 800)).patterns, Nil)
    assertEquals(table("LLLW", bets = Map(4 -> 600)).patterns, Nil)
  }
