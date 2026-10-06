package gamestats.analysis.arena

import gamestats.analysis.*
import gamestats.analysis.Metrics.*
import gamestats.codec.Typed
import gamestats.model.*
import io.circe.Json

import java.time.Instant

/** arena-clash: A1 to A5 per player and A3 for the match. teamId comes from MATCH_STARTED.teams
  * through MatchContext. Patterns: P3 to P6.
  */
object ArenaAnalyzer extends ComposedAnalyzer[ArenaEvent]:
  val gameId = "arena-clash"

  protected def toTyped(e: Event, start: Instant): Option[ArenaEvent] = Typed.toArena(e, start)

  override protected def playerMetrics(ctx: MatchContext[ArenaEvent]): PlayerMetrics =
    import ArenaStats.*
    val events = ctx.events
    val dmg = damage(events)
    val longest = longestKill(events)
    val a1a2: PlayerMetrics = combat(events, ctx.players).map { (p, c) =>
      val d = dmg.get(p)
      p -> (Map(
        "kills" -> int(c.kills.toLong),
        "deaths" -> int(c.deaths.toLong),
        "assists" -> int(c.assists.toLong),
        "kd" -> num(c.kd, 2),
        "damageDealt" -> num(d.fold(0.0)(_.total))
      ) ++ d
        .filter(_.hits > 0)
        .toList
        .flatMap(d =>
          List(
            "avgDamagePerHit" -> num(d.total / d.hits),
            "headshotPct" -> num(100.0 * d.headshots / d.hits)
          )
        ) ++ longest.get(p).map(m => "longestKillM" -> num(m)))
    }
    Metrics.merge(
      a1a2,
      damagePerKill(events).view.mapValues(v => Map("damagePerKill" -> num(v))).toMap,
      weaponConversion(events).view.mapValues(v => Map("weaponConversionPct" -> num(v))).toMap
    )

  override protected def matchMetrics(ctx: MatchContext[ArenaEvent]): Map[String, Json] =
    val winner =
      if ctx.batch.partial then None
      else ctx.common.collectFirst { case f: CommonEvent.MatchFinished => f.winnerTeam }.flatten
    ArenaStats.matchSummary(ctx.events, ctx.teams, ctx.players, winner)

  override protected def detectors: List[PatternDetector[ArenaEvent]] =
    List(
      patterns.KillStreak.detect,
      patterns.Revenge.detect,
      patterns.TeamComeback.detect,
      patterns.RageQuit.detect
    )
