package gamestats.analysis.patterns

import gamestats.analysis.AnalyzerRegistry
import gamestats.fixtures.Samples

/** The scenario matches of demo-small.jsonl, analyzed as the ingestor would send them: each one
  * shows exactly its own pattern, once, for the expected player, with its evidence.
  */
class ScenarioPatternsSuite extends munit.FunSuite:

  val expected = List(
    ("tv-scn-streak", "P1", "p-ana", 6), // right answers 2 to 7
    ("tv-scn-comeback", "P2", "p-luis", 2), // QUESTION_CLOSED + MATCH_FINISHED
    ("sn-scn-frenzy", "P3", "p-kev", 5), // the 5 fruits
    ("sn-scn-greedy", "P4", "p-dani", 2), // fruit + death
    ("bj-scn-hot", "P5", "p-mari", 5), // wins in rounds 2 to 6
    ("bj-scn-allin", "P6", "p-gabo", 4) // 3 losses + the bet
  )

  for (matchId, patternId, player, evidence) <- expected do
    test(s"$matchId shows only $patternId") {
      val batch = Samples.scenario(matchId)
      val found = AnalyzerRegistry.forGame(batch.gameId).analyze(batch).patterns
      assertEquals(found.map(p => (p.patternId, p.playerId)), List((patternId, Some(player))))
      val ids = batch.events.map(_.eventId).toSet
      assertEquals(found.head.evidence.size, evidence)
      assert(found.head.evidence.forall(ids), "evidence must point to events of the match")
      assertEquals(found.head.matchId, matchId)
    }
