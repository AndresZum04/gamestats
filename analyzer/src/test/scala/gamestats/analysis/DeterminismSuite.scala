package gamestats.analysis

import gamestats.fixtures.Samples

/** Pure analysis: the same batch always gives exactly the same result, for every analyzer, and
  * analyzing has no hidden state between calls.
  */
class DeterminismSuite extends munit.FunSuite:

  val scenarios = List(
    "rp-scn-comeback",
    "rp-scn-steady",
    "ac-scn-spree",
    "ac-scn-revenge",
    "ac-scn-teamback",
    "ac-scn-ragequit"
  )

  for id <- scenarios do
    test(s"$id: analyzing twice gives equal results") {
      val batch = Samples.scenario(id)
      val analyzer = AnalyzerRegistry.forGame(batch.gameId)
      assertEquals(analyzer.analyze(batch), analyzer.analyze(batch))
    }

  test("analyzing other matches in between does not change a result") {
    val race = Samples.scenario("rp-scn-steady")
    val before = AnalyzerRegistry.forGame(race.gameId).analyze(race)
    scenarios.map(Samples.scenario).foreach(b => AnalyzerRegistry.forGame(b.gameId).analyze(b))
    assertEquals(AnalyzerRegistry.forGame(race.gameId).analyze(race), before)
  }

  test("the generic analyzer is deterministic on a real racing match too") {
    val race = Samples.scenario("rp-scn-comeback")
    assertEquals(
      GenericAnalyzer("racing-pro").analyze(race),
      GenericAnalyzer("racing-pro").analyze(race)
    )
  }
