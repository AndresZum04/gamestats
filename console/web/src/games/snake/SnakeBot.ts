import type { Rng } from "../../core/Rng.js";
import type { CollisionDetector } from "./CollisionDetector.js";
import { DIRECTIONS, manhattan, opposite, step, type Direction, type Point } from "./Point.js";
import type { Snake } from "./Snake.js";

export interface BotView {
  snake: Snake;
  target: Point;
  obstacles: ReadonlySet<string>;
  detector: CollisionDetector;
}

/**
 * The simple player of the autoplay mode. It goes towards the fruit by a safe
 * cell; on a tie it picks at random. After eating some fruits in a life it gets
 * "careless" and goes straight on until it crashes, so an automatic match
 * always ends and loses its three lives in a reasonable time.
 */
export class SnakeBot {
  readonly #rng: Rng;
  #budget = 0;
  #eaten = 0;

  constructor(rng: Rng) {
    this.#rng = rng;
    this.newLife();
  }

  /** Fruits it will eat in this life before getting careless: 4 to 9. */
  newLife(): void {
    this.#budget = this.#rng.int(4, 9);
    this.#eaten = 0;
  }

  ate(): void {
    this.#eaten += 1;
  }

  get careless(): boolean {
    return this.#eaten >= this.#budget;
  }

  choose(view: BotView): Direction {
    const { snake, target, obstacles, detector } = view;
    const current = snake.nextDirection;
    if (this.careless) return current;
    const safe = DIRECTIONS.filter(
      (d) =>
        d !== opposite(current) && detector.check(snake, step(snake.head, d), obstacles) === null,
    );
    if (safe.length === 0) return current;
    const distance = (d: Direction) => manhattan(step(snake.head, d), target);
    const best = Math.min(...safe.map(distance));
    return this.#rng.pick(safe.filter((d) => distance(d) === best));
  }
}
