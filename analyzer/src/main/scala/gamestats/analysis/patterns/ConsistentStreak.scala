package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.RacingEvent
import gamestats.model.RacingEvent.LapCompleted

/** P2, Racha consistente (racing-pro): 3 laps in a row whose times are all within 1 % of the
  * average of those 3. Overlapping windows that qualify are one streak (laps 4 to 7 is one pattern,
  * not two).
  */
object ConsistentStreak:
  val id = "P2"
  val name = "Racha consistente"
  val tolerance = 0.01

  def steady(window: List[LapCompleted]): Boolean =
    val avg = window.map(_.lapTimeMs.toDouble).sum / window.size
    window.forall(l => math.abs(l.lapTimeMs - avg) <= avg * tolerance)

  /** Groups qualifying window starts that touch each other: 3, 4, 7 -> (3, 4), (7). */
  private def runs(starts: List[Int]): List[List[Int]] =
    starts
      .foldLeft(List.empty[List[Int]]) {
        case (current :: done, s) if current.head == s - 1 => (s :: current) :: done
        case (acc, s)                                      => List(s) :: acc
      }
      .map(_.reverse)
      .reverse

  val detect: PatternDetector[RacingEvent] = ctx =>
    ctx.events
      .collect { case l: LapCompleted => l }
      .groupBy(_.playerId)
      .toList
      .sortBy(_._1)
      .flatMap { (player, unsorted) =>
        val laps = unsorted.sortBy(_.lap).toVector
        val starts = laps.toList
          .sliding(3)
          .zipWithIndex
          .collect { case (w, i) if w.size == 3 && steady(w) => i }
          .toList
        runs(starts).map { run =>
          val streak = laps.slice(run.head, run.last + 3).toList
          Patterns.make(
            ctx,
            id,
            name,
            Some(player),
            None,
            streak.last.meta.atMs,
            s"$player hizo las vueltas ${streak.head.lap} a ${streak.last.lap} con tiempos dentro del 1 % de su promedio",
            streak.map(_.meta.eventId)
          )
        }
      }
