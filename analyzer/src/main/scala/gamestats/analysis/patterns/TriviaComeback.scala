package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.CommonEvent.ScoreChanged
import gamestats.model.TriviaEvent
import gamestats.model.TriviaEvent.*

/** P2, Remontada (trivia): after some QUESTION_CLOSED from question 2 on, the player was alone in
  * last place by score, and finished with placement 1. Needs the final placements, so a PARTIAL
  * match gives nothing.
  *
  * The scores at each moment come from a scanLeft over the SCORE_CHANGED events: each step is the
  * table of totals after that event, starting with every player at 0.
  */
object TriviaComeback:
  val id = "P2"
  val name = "Remontada"
  val fromQuestion = 2

  /** Totals of every player after each SCORE_CHANGED, as (seq of the event, totals). */
  def tables(players: List[String], scores: List[ScoreChanged]): List[(Int, Map[String, Double])] =
    scores
      .sortBy(_.meta.seq)
      .scanLeft((0, players.map(_ -> 0.0).toMap)) { case ((_, totals), s) =>
        (s.meta.seq, totals.updated(s.playerId, s.total))
      }

  /** The player alone in last place, if there is exactly one. */
  def aloneLast(totals: Map[String, Double]): Option[String] =
    totals.toList.sortBy(_._2) match
      case (p, low) :: (_, next) :: _ if low < next => Some(p)
      case _                                        => None

  val detect: PatternDetector[TriviaEvent] = ctx =>
    val number = ctx.events.collect { case q: QuestionShown => q.questionId -> q.number }.toMap
    val history = tables(ctx.players, ctx.common.collect { case s: ScoreChanged => s })
    Patterns.finished(ctx).toList.flatMap { end =>
      ctx.events
        .collect {
          case c: QuestionClosed if number.getOrElse(c.questionId, 0) >= fromQuestion => c
        }
        .flatMap { close =>
          // The table as it was when the question closed.
          val totals = history.takeWhile(_._1 < close.meta.seq).last._2
          aloneLast(totals).map(_ -> close)
        }
        .groupBy(_._1)
        .toList
        .sortBy(_._1)
        .collect {
          case (player, closes) if ctx.placements.get(player).contains(1) =>
            val first = closes.map(_._2).minBy(_.meta.seq)
            Patterns.make(
              ctx,
              id,
              name,
              Some(player),
              None,
              end.meta.atMs,
              s"$player iba solo en el último lugar después de la pregunta " +
                s"${number.getOrElse(first.questionId, 0)} y ganó la partida",
              List(first.meta.eventId, end.meta.eventId)
            )
        }
    }
