package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.analysis.snake.SnakeStats
import gamestats.model.SnakeEvent

/** P3, Frenesí (snake): 5 FOOD_EATEN with 15 s or less between the first and the last, in the same
  * life. Windows come from sliding(5) over the fruits of each life; only the first window of a life
  * is reported, so a long burst counts once.
  */
object Frenzy:
  val id = "P3"
  val name = "Frenesí"
  val fruits = 5
  val windowMs = 15000L

  val detect: PatternDetector[SnakeEvent] = ctx =>
    ctx.events.groupBy(_.playerId).toList.sortBy(_._1).flatMap { (player, events) =>
      SnakeStats.lives(events).zipWithIndex.flatMap { (life, i) =>
        life
          .sliding(fruits)
          .find(w => w.size == fruits && w.last.meta.atMs - w.head.meta.atMs <= windowMs)
          .map { w =>
            val span = w.last.meta.atMs - w.head.meta.atMs
            Patterns.make(
              ctx,
              id,
              name,
              Some(player),
              None,
              w.last.meta.atMs,
              s"$player comió $fruits frutas en ${Patterns.seconds(span)} s (vida ${i + 1})",
              w.map(_.meta.eventId)
            )
          }
      }
    }
