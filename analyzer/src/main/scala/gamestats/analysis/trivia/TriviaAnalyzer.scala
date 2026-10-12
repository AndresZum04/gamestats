package gamestats.analysis.trivia

import gamestats.analysis.*
import gamestats.analysis.Metrics.*
import gamestats.codec.Typed
import gamestats.model.*
import io.circe.Json

import java.time.Instant

/** trivia: T1 to T3 per player, T4 for the match, T5 for the game and patterns P1 and P2. The
  * number of questions comes from MATCH_STARTED (10 if missing).
  */
object TriviaAnalyzer extends ComposedAnalyzer[TriviaEvent]:
  val gameId = "trivia"

  protected def toTyped(e: Event, start: Instant): Option[TriviaEvent] = Typed.toTrivia(e, start)

  override protected def playerMetrics(ctx: MatchContext[TriviaEvent]): PlayerMetrics =
    import TriviaStats.*
    val questions = ctx.startNumber("questions").fold(defaultQuestions)(_.toInt)
    val counts = answers(ctx.events)
    val t1: PlayerMetrics = ctx.players.map { p =>
      val a = counts.getOrElse(p, Answers.empty)
      p -> Map(
        "correct" -> int(a.correct.toLong),
        "wrong" -> int(a.wrong.toLong),
        "timeouts" -> int(a.timeouts.toLong),
        "correctPct" -> num(a.correctPct(questions))
      )
    }.toMap
    val t2: PlayerMetrics = speed(ctx.events).view
      .mapValues(s =>
        Map("avgResponseMs" -> num(s.avgResponseMs)) ++
          s.fastestCorrectMs.map(ms => "fastestCorrectMs" -> int(ms))
      )
      .toMap
    val t3: PlayerMetrics = byCategory(ctx.events).view
      .mapValues(cats =>
        Map(
          "correctPctByCategory" -> Json.fromFields(
            cats.toList.sortBy(_._1).map((c, t) => c -> num(t.pct))
          )
        )
      )
      .toMap
    Metrics.merge(t1, t2, t3)

  override protected def matchMetrics(ctx: MatchContext[TriviaEvent]): Map[String, Json] =
    TriviaStats.matchSummary(ctx.events)

  override def gameMetrics(matches: List[MatchAnalysis]): Map[String, Json] =
    TriviaStats.gameSummary(matches)

  override protected def detectors: List[PatternDetector[TriviaEvent]] =
    List(patterns.AnswerStreak.detect, patterns.TriviaComeback.detect)
