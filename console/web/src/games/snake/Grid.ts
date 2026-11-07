import type { Rng } from "../../core/Rng.js";
import { point, type Point } from "./Point.js";

/** The board: 20×20 cells by default. */
export class Grid {
  readonly width: number;
  readonly height: number;

  constructor(width = 20, height = 20) {
    this.width = width;
    this.height = height;
  }

  /** `grid` of MATCH_STARTED, for example "20x20". */
  get label(): string {
    return `${this.width}x${this.height}`;
  }

  contains(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  center(): Point {
    return point(Math.floor(this.width / 2), Math.floor(this.height / 2));
  }

  /** The cell on the other side, for a snake with a shield that crosses a wall. */
  wrap(p: Point): Point {
    const mod = (n: number, m: number) => ((n % m) + m) % m;
    return point(mod(p.x, this.width), mod(p.y, this.height));
  }

  /** A random cell for which `taken` is false, or null if the board is full. */
  randomFree(rng: Rng, taken: (p: Point) => boolean): Point | null {
    const free: Point[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const p = point(x, y);
        if (!taken(p)) free.push(p);
      }
    }
    return free.length === 0 ? null : rng.pick(free);
  }
}
