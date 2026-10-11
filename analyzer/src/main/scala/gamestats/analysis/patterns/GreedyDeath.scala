package gamestats.analysis.patterns

import gamestats.analysis.PatternDetector
import gamestats.model.{PatternMatch, SnakeEvent}
import gamestats.model.SnakeEvent.*

/** P4, Muerte por codicia (snake): SNAKE_DIED less than 2 s after a FOOD_EATEN of the same player.
  *
  * A foldLeft walks the events in order carrying the last fruit of each player; a death close to it
  * is a match.
  */
object GreedyDeath:
  val id = "P4"
  val name = "Muerte por codicia"
  val withinMs = 2000L

  val detect: PatternDetector[SnakeEvent] = ctx =>
    val (_, found) = ctx.events.foldLeft((Map.empty[String, FoodEaten], List.empty[PatternMatch])) {
      case ((last, acc), f: FoodEaten) => (last.updated(f.playerId, f), acc)
      case ((last, acc), d: SnakeDied) =>
        val hit = last.get(d.playerId).filter(f => d.meta.atMs - f.meta.atMs < withinMs).map { f =>
          Patterns.make(
            ctx,
            id,
            name,
            Some(d.playerId),
            None,
            d.meta.atMs,
            s"${d.playerId} murió (${d.cause}) ${Patterns.seconds(d.meta.atMs - f.meta.atMs)} s " +
              s"después de comer, con largo ${d.length}",
            List(f.meta.eventId, d.meta.eventId)
          )
        }
        (last - d.playerId, hit.toList ++ acc)
      case (state, _) => state
    }
    found.reverse
