package gamestats.analysis.racing

import gamestats.analysis.*
import gamestats.analysis.Metrics.*
import gamestats.codec.Typed
import gamestats.model.*
import io.circe.Json

import java.time.Instant

/** racing-pro: R1 to R7 per driver and R5 for the race. Placements come from MATCH_FINISHED through
  * MatchContext; a PARTIAL race has none, so R3 is left out. Patterns: P1 and P2.
  */
object RacingAnalyzer extends ComposedAnalyzer[RacingEvent]:
  val gameId = "racing-pro"

  protected def toTyped(e: Event, start: Instant): Option[RacingEvent] = Typed.toRacing(e, start)

  override protected def playerMetrics(ctx: MatchContext[RacingEvent]): PlayerMetrics =
    import RacingStats.*
    val events = ctx.events
    val laps = lapsByPlayer(events)
    val r1r2: PlayerMetrics = laps.flatMap { (p, ls) =>
      val times = ls.map(_.lapTimeMs)
      lapStats(times).map { s =>
        p -> Map(
          "laps" -> int(ls.size.toLong),
          "bestLapMs" -> int(s.bestMs),
          "avgLapMs" -> num(s.avgMs),
          "lapStdDevMs" -> num(s.stdDevMs),
          "consistency" -> Json.fromDoubleOrNull(consistency(s))
        )
      }
    }
    val passes = overtakes(events)
    val impact = incidentImpact(events)
    val counts: PlayerMetrics = laps.keySet.map { p =>
      p -> Map(
        "overtakes" -> int(passes.getOrElse(p, 0).toLong),
        "incidentImpactMs" -> int(impact.getOrElse(p, 0L))
      )
    }.toMap
    Metrics.merge(
      r1r2,
      counts,
      positionsGained(events, ctx.placements).view
        .mapValues(g => Map("positionsGained" -> int(g.toLong)))
        .toMap,
      pitEffect(events).view.mapValues(e => Map("pitEffectMs" -> num(e))).toMap
    )

  override protected def matchMetrics(ctx: MatchContext[RacingEvent]): Map[String, Json] =
    RacingStats.raceSummary(ctx.events)

  override protected def detectors: List[PatternDetector[RacingEvent]] =
    List(patterns.Comeback.detect, patterns.ConsistentStreak.detect)
