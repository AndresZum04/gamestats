package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.{ArenaEvent, PatternMatch}
import gamestats.model.ArenaEvent.PlayerEliminated

/** P3, Racha de eliminaciones (arena-clash): 3 or more eliminations by the same player within 10 s,
  * without dying in between.
  *
  * A foldLeft walks the player's kills and deaths in order with an immutable StreakState: a kill
  * inside the window joins the current streak; a death or a kill outside the window closes it (and
  * records it if it reached 3).
  */
object KillStreak:
  val id = "P3"
  val name = "Racha de eliminaciones"
  val windowMs = 10000L
  val minKills = 3

  /** What happens to a player, in time order. */
  private enum Step:
    case Kill(e: PlayerEliminated)
    case Death(atMs: Long)

  final case class StreakState(
      current: List[PlayerEliminated],
      found: List[List[PlayerEliminated]]
  ):
    /** Closes the current streak, keeping it if it is long enough. */
    def close: StreakState =
      StreakState(Nil, if current.size >= minKills then current.reverse :: found else found)

  def streaks(kills: List[PlayerEliminated], deaths: List[Long]): List[List[PlayerEliminated]] =
    val steps = (kills.map(Step.Kill(_)) ++ deaths.map(Step.Death(_))).sortBy {
      case Step.Kill(k)   => (k.meta.atMs, 1)
      case Step.Death(at) => (at, 0)
    }
    val end = steps.foldLeft(StreakState(Nil, Nil)) {
      case (state, Step.Death(_)) => state.close
      case (state, Step.Kill(k)) =>
        state.current.lastOption match
          case Some(first) if k.meta.atMs - first.meta.atMs <= windowMs =>
            state.copy(current = k :: state.current)
          case _ => state.close.copy(current = List(k))
    }
    end.close.found.reverse

  val detect: PatternDetector[ArenaEvent] = ctx =>
    val kills = ctx.events.collect { case k: PlayerEliminated => k }
    kills.map(_.playerId).distinct.sorted.flatMap { player =>
      val deaths = kills.filter(_.victimId == player).map(_.meta.atMs)
      streaks(kills.filter(_.playerId == player), deaths).map(streak =>
        describe(ctx.teams.get(player), player, streak, ctx)
      )
    }

  private def describe(
      team: Option[String],
      player: String,
      streak: List[PlayerEliminated],
      ctx: gamestats.analysis.MatchContext[ArenaEvent]
  ): PatternMatch =
    val span = streak.last.meta.atMs - streak.head.meta.atMs
    Patterns.make(
      ctx,
      id,
      name,
      Some(player),
      team,
      streak.last.meta.atMs,
      s"$player eliminó a ${streak.size} rivales en ${Patterns.seconds(span)} s sin morir",
      streak.map(_.meta.eventId)
    )
