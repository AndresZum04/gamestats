package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.TriviaEvent
import gamestats.model.TriviaEvent.*

/** P1, Racha de aciertos (trivia): 5 or more right answers in a row by the same player, ordered by
  * question number. A wrong answer or a timeout ends the streak; each streak is reported once.
  */
object AnswerStreak:
  val id = "P1"
  val name = "Racha de aciertos"
  val minAnswers = 5

  /** One attempt of a player: the question number, whether it was right and its event. */
  final case class Attempt(number: Int, correct: Boolean, eventId: String, atMs: Long)

  val detect: PatternDetector[TriviaEvent] = ctx =>
    val number = ctx.events.collect { case q: QuestionShown => q.questionId -> q.number }.toMap
    val attempts = ctx.events.collect {
      case a: AnswerSubmitted =>
        a.playerId -> Attempt(
          number.getOrElse(a.questionId, 0),
          a.correct,
          a.meta.eventId,
          a.meta.atMs
        )
      case t: AnswerTimeout =>
        t.playerId -> Attempt(number.getOrElse(t.questionId, 0), false, t.meta.eventId, t.meta.atMs)
    }
    attempts
      .groupMap(_._1)(_._2)
      .toList
      .sortBy(_._1)
      .flatMap { (player, list) =>
        Patterns
          .runs(list.sortBy(_.number))(_.correct)
          .filter(_.size >= minAnswers)
          .map(streak =>
            Patterns.make(
              ctx,
              id,
              name,
              Some(player),
              None,
              streak.last.atMs,
              s"$player acertó ${streak.size} preguntas seguidas " +
                s"(de la ${streak.head.number} a la ${streak.last.number})",
              streak.map(_.eventId)
            )
          )
      }
