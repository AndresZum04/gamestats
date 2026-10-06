package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.ArenaEvent
import gamestats.model.ArenaEvent.PlayerEliminated

/** P5, Remontada de equipo (arena-clash): the winning team was 5 or more eliminations behind at
  * some point.
  */
object TeamComeback:
  val id = "P5"
  val name = "Remontada de equipo"
  val minDeficit = 5

  /** Score after each elimination, built with scanLeft: (winner, other, kill that produced it).
    */
  final case class Score(winner: Int, other: Int, by: Option[PlayerEliminated]):
    def deficit: Int = other - winner

  val detect: PatternDetector[ArenaEvent] = ctx =>
    Patterns.finished(ctx).flatMap(_.winnerTeam).toList.flatMap { winner =>
      val kills = ctx.events.collect { case k: PlayerEliminated => k }.sortBy(_.meta.seq)
      val timeline = kills.scanLeft(Score(0, 0, None)) { (s, k) =>
        if ctx.teams.get(k.playerId).contains(winner) then Score(s.winner + 1, s.other, Some(k))
        else Score(s.winner, s.other + 1, Some(k))
      }
      val worst = timeline.maxBy(_.deficit)
      if !timeline.exists(_.deficit >= minDeficit) then Nil
      else
        val last = timeline.last
        List(
          Patterns.make(
            ctx,
            id,
            name,
            None,
            Some(winner),
            worst.by.fold(0L)(_.meta.atMs),
            s"$winner estuvo ${worst.deficit} eliminaciones abajo (${worst.winner} a ${worst.other}) " +
              s"y ganó ${last.winner} a ${last.other}",
            worst.by.toList.map(_.meta.eventId)
          )
        )
    }
