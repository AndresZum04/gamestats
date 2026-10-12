package gamestats.analysis.snake

import gamestats.analysis.*
import gamestats.analysis.Metrics.*
import gamestats.codec.Typed
import gamestats.model.*
import io.circe.Json

import java.time.Instant

/** snake: S1 to S4 per player, S5 for the game and patterns P3 and P4. The duration for S2 is G2.
  */
object SnakeAnalyzer extends ComposedAnalyzer[SnakeEvent]:
  val gameId = "snake"

  protected def toTyped(e: Event, start: Instant): Option[SnakeEvent] = Typed.toSnake(e, start)

  override protected def playerMetrics(ctx: MatchContext[SnakeEvent]): PlayerMetrics =
    import SnakeStats.*
    val events = ctx.events
    val s1s2: PlayerMetrics = growth(events).map { (p, g) =>
      p -> (Map("maxLength" -> int(g.maxLength.toLong), "fruits" -> int(g.fruits.toLong)) ++
        fruitsPerMinute(g.fruits, ctx.minutes).map(f => "fruitsPerMinute" -> num(f, 2)))
    }
    val s3: PlayerMetrics = deathsByCause(events).view
      .mapValues(byCause =>
        Map(
          "deaths" -> int(byCause.values.sum.toLong),
          "deathsByCause" -> Json.fromFields(
            byCause.toList.sortBy(_._1).map((c, n) => c -> int(n.toLong))
          )
        )
      )
      .toMap
    val s4: PlayerMetrics = events.groupBy(_.playerId).map { (p, evs) =>
      p -> (Map("fruitsPerLife" -> Json.arr(lives(evs).map(l => int(l.size.toLong))*)) ++
        avgFruitsPerLife(evs).map(a => "avgFruitsPerLife" -> num(a)))
    }
    val chart: PlayerMetrics = lengthSeries(events).view
      .mapValues(points =>
        Map(
          "lengthSeries" -> Json.arr(
            points.map(pt =>
              Json.obj(
                "atMs" -> int(pt.atMs),
                "length" -> int(pt.length.toLong),
                "died" -> bool(pt.died)
              )
            )*
          )
        )
      )
      .toMap
    Metrics.merge(
      s1s2,
      avgMsBetweenFruits(events).view.mapValues(ms => Map("avgMsBetweenFruits" -> num(ms))).toMap,
      s3,
      s4,
      chart
    )

  override protected def matchMetrics(ctx: MatchContext[SnakeEvent]): Map[String, Json] =
    SnakeStats.matchSummary(ctx.events)

  override def gameMetrics(matches: List[MatchAnalysis]): Map[String, Json] =
    SnakeStats.gameSummary(matches)

  override protected def detectors: List[PatternDetector[SnakeEvent]] =
    List(patterns.Frenzy.detect, patterns.GreedyDeath.detect)
