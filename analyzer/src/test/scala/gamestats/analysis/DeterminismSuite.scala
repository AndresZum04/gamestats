package gamestats.analysis

import gamestats.fixtures.Samples

/** Pure analysis: the same batch always gives exactly the same result, for every analyzer, and
  * analyzing has no hidden state between calls.
  */
class DeterminismSuite extends munit.FunSuite:

  val scenarios = List(
    "tv-scn-streak",
    "tv-scn-comeback",
    "sn-scn-frenzy",
    "sn-scn-greedy",
    "bj-scn-hot",
    "bj-scn-allin"
  )

  for id <- scenarios do
    test(s"$id: analyzing twice gives equal results") {
      val batch = Samples.scenario(id)
      val analyzer = AnalyzerRegistry.forGame(batch.gameId)
      assertEquals(analyzer.analyze(batch), analyzer.analyze(batch))
    }

  test("analyzing other matches in between does not change a result") {
    val table = Samples.scenario("bj-scn-hot")
    val before = AnalyzerRegistry.forGame(table.gameId).analyze(table)
    scenarios.map(Samples.scenario).foreach(b => AnalyzerRegistry.forGame(b.gameId).analyze(b))
    assertEquals(AnalyzerRegistry.forGame(table.gameId).analyze(table), before)
  }

  test("the generic analyzer is deterministic on a real trivia match too") {
    val quiz = Samples.scenario("tv-scn-comeback")
    assertEquals(GenericAnalyzer("trivia").analyze(quiz), GenericAnalyzer("trivia").analyze(quiz))
  }
