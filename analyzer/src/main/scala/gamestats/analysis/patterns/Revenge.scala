package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.ArenaEvent
import gamestats.model.ArenaEvent.PlayerEliminated

/** P4, Venganza (arena-clash): A eliminates B and B eliminates A within the next 60 s. The pattern
  * belongs to B, the one who took revenge.
  */
object Revenge:
  val id = "P4"
  val name = "Venganza"
  val windowMs = 60000L

  val detect: PatternDetector[ArenaEvent] = ctx =>
    val kills = ctx.events.collect { case k: PlayerEliminated => k }.sortBy(_.meta.seq)
    kills
      .flatMap { first =>
        // find: the first later kill of the victim on its killer, in time.
        kills
          .find(back =>
            back.playerId == first.victimId && back.victimId == first.playerId &&
              back.meta.seq > first.meta.seq && back.meta.atMs - first.meta.atMs <= windowMs
          )
          .map(back => (first, back))
      }
      .distinctBy((_, back) => back.meta.eventId) // one revenge per kill back
      .map { (first, back) =>
        Patterns.make(
          ctx,
          id,
          name,
          Some(back.playerId),
          ctx.teams.get(back.playerId),
          back.meta.atMs,
          s"${first.playerId} eliminó a ${back.playerId} y ${back.playerId} se vengó " +
            s"${Patterns.seconds(back.meta.atMs - first.meta.atMs)} s después",
          List(first.meta.eventId, back.meta.eventId)
        )
      }
