import type { DeathCause } from "@gameconsole/shared";
import type { Grid } from "./Grid.js";
import { keyOf, same, type Point } from "./Point.js";
import type { Snake } from "./Snake.js";

/** Says whether the head of the snake can enter a cell, and what kills it if not. */
export class CollisionDetector {
  readonly #grid: Grid;

  constructor(grid: Grid) {
    this.#grid = grid;
  }

  /** The cause of death if the head moves to `next`, or null if it is safe. */
  check(snake: Snake, next: Point, obstacles: ReadonlySet<string>): DeathCause | null {
    if (!this.#grid.contains(next)) return "WALL";
    if (obstacles.has(keyOf(next))) return "OBSTACLE";
    if (snake.blocking().some((c) => same(c, next))) return "SELF";
    return null;
  }
}
