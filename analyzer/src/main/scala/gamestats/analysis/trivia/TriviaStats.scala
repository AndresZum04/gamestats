package gamestats.analysis.trivia

import gamestats.analysis.Metrics
import gamestats.analysis.Metrics.*
import gamestats.model.{MatchAnalysis, TriviaEvent}
import gamestats.model.TriviaEvent.*
import io.circe.Json

/** trivia statistics T1 to T5. Every one is a named pure function over the typed events of one
  * match (T5 over the stored analyses of every match).
  */
object TriviaStats:

  /** Questions per match when MATCH_STARTED does not say. */
  val defaultQuestions = 10

  /** T1 for one player. */
  final case class Answers(correct: Int, wrong: Int, timeouts: Int):
    def correctPct(questions: Int): Double =
      if questions <= 0 then 0.0 else 100.0 * correct / questions

  object Answers:
    val empty: Answers = Answers(0, 0, 0)

  /** Right and wrong answers out of a total; used by T3, T4 and T5. */
  final case class Tally(correct: Int, total: Int):
    def +(o: Tally): Tally = Tally(correct + o.correct, total + o.total)
    def pct: Double = if total == 0 then 0.0 else 100.0 * correct / total

  /** T1: right answers, wrong answers and timeouts, in one foldLeft. */
  def answers(events: List[TriviaEvent]): Map[String, Answers] =
    events.foldLeft(Map.empty[String, Answers]) {
      case (acc, a: AnswerSubmitted) =>
        val r = acc.getOrElse(a.playerId, Answers.empty)
        acc.updated(
          a.playerId,
          if a.correct then r.copy(correct = r.correct + 1) else r.copy(wrong = r.wrong + 1)
        )
      case (acc, t: AnswerTimeout) =>
        val r = acc.getOrElse(t.playerId, Answers.empty)
        acc.updated(t.playerId, r.copy(timeouts = r.timeouts + 1))
      case (acc, _) => acc
    }

  private def submitted(events: List[TriviaEvent]): List[AnswerSubmitted] =
    events.collect { case a: AnswerSubmitted => a }

  /** T2 for one player: average responseMs of every answer and the fastest right one. */
  final case class Speed(avgResponseMs: Double, fastestCorrectMs: Option[Long])

  /** T2. Timeouts have no response time, so they are left out. */
  def speed(events: List[TriviaEvent]): Map[String, Speed] =
    submitted(events)
      .groupBy(_.playerId)
      .view
      .mapValues(as =>
        Speed(
          as.map(_.responseMs.toDouble).sum / as.size,
          as.filter(_.correct).map(_.responseMs).minOption
        )
      )
      .toMap

  /** Every attempt at a question as (player, questionId, right); a timeout is not right. */
  private def attempts(events: List[TriviaEvent]): List[(String, String, Boolean)] =
    events.collect {
      case a: AnswerSubmitted => (a.playerId, a.questionId, a.correct)
      case t: AnswerTimeout   => (t.playerId, t.questionId, false)
    }

  /** T3 (combines ANSWER_SUBMITTED, ANSWER_TIMEOUT and QUESTION_SHOWN): each attempt is joined with
    * its question by questionId to get the category, then counted per player and category.
    */
  def byCategory(events: List[TriviaEvent]): Map[String, Map[String, Tally]] =
    val category = events.collect { case q: QuestionShown => q.questionId -> q.category }.toMap
    attempts(events)
      .flatMap((p, q, ok) => category.get(q).map(c => (p, c, Tally(if ok then 1 else 0, 1))))
      .groupBy(_._1)
      .view
      .mapValues(_.groupMapReduce(_._2)(_._3)(_ + _))
      .toMap

  /** T4: hardest question (fewest right answers; on a tie, the later one), fastest player (lowest
    * average responseMs of right answers) and % of right attempts in the match. categoryTotals is
    * kept for T5.
    */
  def matchSummary(events: List[TriviaEvent]): Map[String, Json] =
    val number = events.collect { case q: QuestionShown => q.questionId -> q.number }.toMap
    val hardest = events
      .collect { case c: QuestionClosed => c }
      .minByOption(c => (c.correctCount, -number.getOrElse(c.questionId, 0)))
    val fastest = submitted(events)
      .filter(_.correct)
      .groupBy(_.playerId)
      .toList
      .map((p, as) => p -> as.map(_.responseMs.toDouble).sum / as.size)
      .minByOption((p, avg) => (avg, p))
    val all = attempts(events).map((_, _, ok) => Tally(if ok then 1 else 0, 1))
    val totals = byCategory(events).values.flatMap(_.toList).groupMapReduce(_._1)(_._2)(_ + _)
    hardest.toList
      .map(h =>
        "hardestQuestion" -> Json.obj(
          "questionId" -> str(h.questionId),
          "number" -> int(number.getOrElse(h.questionId, 0).toLong),
          "correctCount" -> int(h.correctCount.toLong)
        )
      )
      .toMap ++ fastest.toList.map((p, avg) =>
      "fastestPlayer" -> Json.obj("playerId" -> str(p), "avgCorrectMs" -> num(avg))
    ) ++ Map(
      "matchCorrectPct" -> num(all.foldLeft(Tally(0, 0))(_ + _).pct),
      "categoryTotals" -> tallies(totals)
    )

  def tallies(t: Map[String, Tally]): Json =
    Json.fromFields(t.toList.sortBy(_._1).map { (c, x) =>
      c -> Json.obj("correct" -> int(x.correct.toLong), "total" -> int(x.total.toLong))
    })

  private def readTallies(json: Json): Map[String, Tally] =
    json.asObject.toList
      .flatMap(_.toList)
      .flatMap { (c, v) =>
        for
          correct <- v.hcursor.get[Int]("correct").toOption
          total <- v.hcursor.get[Int]("total").toOption
        yield c -> Tally(correct, total)
      }
      .toMap

  /** T5: the category with the lowest % of right attempts over every match of the game (ties go
    * alphabetical), plus the % of every category.
    */
  def gameSummary(matches: List[MatchAnalysis]): Map[String, Json] =
    val totals = matches
      .flatMap(_.matchMetrics.get("categoryTotals").toList.flatMap(readTallies(_).toList))
      .groupMapReduce(_._1)(_._2)(_ + _)
    totals.toList
      .minByOption((c, t) => (t.pct, c))
      .toList
      .map((c, t) =>
        "hardestCategory" -> Json.obj("category" -> str(c), "correctPct" -> num(t.pct))
      )
      .toMap ++ Option
      .when(totals.nonEmpty)(
        "correctPctByCategory" -> Json.fromFields(
          totals.toList.sortBy(_._1).map((c, t) => c -> Metrics.num(t.pct))
        )
      )
      .toMap
