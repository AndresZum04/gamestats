package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.{ArenaEvent, CommonEvent}
import gamestats.model.ArenaEvent.PlayerEliminated

/** P6, Abandono por frustración (arena-clash): 3 deaths of the player within 60 s, followed by
  * PLAYER_LEFT less than 30 s after the third.
  */
object RageQuit:
  val id = "P6"
  val name = "Abandono por frustración"
  val deathsWindowMs = 60000L
  val leaveWindowMs = 30000L

  val detect: PatternDetector[ArenaEvent] = ctx =>
    val kills = ctx.events.collect { case k: PlayerEliminated => k }.sortBy(_.meta.seq)
    ctx.common.collect { case l: CommonEvent.PlayerLeft => l }.flatMap { left =>
      val deaths = kills.filter(k => k.victimId == left.playerId && k.meta.atMs <= left.meta.atMs)
      deaths
        .sliding(3)
        .find(w =>
          w.size == 3 &&
            w.last.meta.atMs - w.head.meta.atMs <= deathsWindowMs &&
            left.meta.atMs - w.last.meta.atMs < leaveWindowMs
        )
        .map { w =>
          Patterns.make(
            ctx,
            id,
            name,
            Some(left.playerId),
            ctx.teams.get(left.playerId),
            left.meta.atMs,
            s"${left.playerId} murió 3 veces en ${Patterns.seconds(w.last.meta.atMs - w.head.meta.atMs)} s " +
              s"y se fue ${Patterns.seconds(left.meta.atMs - w.last.meta.atMs)} s después",
            w.map(_.meta.eventId) :+ left.meta.eventId
          )
        }
    }
