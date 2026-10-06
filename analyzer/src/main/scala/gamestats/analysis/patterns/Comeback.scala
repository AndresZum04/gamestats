package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.RacingEvent
import gamestats.model.RacingEvent.LapCompleted

/** P1, Remontada (racing-pro): from lap 2 on, the driver was in one of the last three positions and
  * finished 3rd or better.
  */
object Comeback:
  val id = "P1"
  val name = "Remontada"

  val detect: PatternDetector[RacingEvent] = ctx =>
    val field = ctx.placements.size
    Patterns.finished(ctx).toList.flatMap { end =>
      ctx.events
        .collect { case l: LapCompleted if l.lap >= 2 => l }
        .groupBy(_.playerId)
        .toList
        .sortBy(_._1)
        .flatMap { (player, laps) =>
          // foldLeft keeps the lap where the driver was furthest behind.
          val worst = laps.sortBy(_.lap).foldLeft(Option.empty[LapCompleted]) {
            case (Some(w), l) if w.position >= l.position => Some(w)
            case (_, l)                                   => Some(l)
          }
          for
            w <- worst
            placement <- ctx.placements.get(player)
            if field >= 4 && w.position > field - 3 && placement <= 3
          yield Patterns.make(
            ctx,
            id,
            name,
            Some(player),
            None,
            end.meta.atMs,
            s"$player estuvo en la posición ${w.position} en la vuelta ${w.lap} y terminó en el puesto $placement",
            List(w.meta.eventId, end.meta.eventId)
          )
        }
    }
