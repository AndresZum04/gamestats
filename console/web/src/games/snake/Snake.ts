import { opposite, point, same, step, type Direction, type Point } from "./Point.js";

/** Turns pressed between two ticks that are kept, so a quick double turn is not lost. */
const MAX_QUEUED_TURNS = 2;

/**
 * The snake: its cells (head first) and where it is going. Growing adds copies
 * of the tail cell, which stay in place while the rest moves, so `length` is
 * the real length right after eating.
 */
export class Snake {
  #body: Point[];
  #direction: Direction;
  readonly #queued: Direction[] = [];

  /** A snake of `length` cells with its head at `head`, going in `direction`. */
  constructor(head: Point, direction: Direction = "RIGHT", length = 3) {
    const back = opposite(direction);
    this.#body = [head];
    for (let i = 1; i < length; i++) this.#body.push(step(this.#body[i - 1] ?? head, back));
    this.#direction = direction;
  }

  get head(): Point {
    return this.#body[0] ?? point(0, 0);
  }
  get body(): readonly Point[] {
    return this.#body;
  }
  get length(): number {
    return this.#body.length;
  }
  get direction(): Direction {
    return this.#direction;
  }

  /** The direction of the next move: the first turn waiting, or the current one. */
  get nextDirection(): Direction {
    return this.#queued[0] ?? this.#direction;
  }

  /**
   * Asks to turn. A turn to the same direction or straight back is ignored
   * (going back would be biting itself at once). Returns whether it was kept.
   */
  turn(direction: Direction): boolean {
    const last = this.#queued.at(-1) ?? this.#direction;
    if (direction === last || direction === opposite(last)) return false;
    if (this.#queued.length >= MAX_QUEUED_TURNS) return false;
    this.#queued.push(direction);
    return true;
  }

  /** Where the head would go on the next move. */
  nextHead(): Point {
    return step(this.head, this.nextDirection);
  }

  /** Moves one cell; `to` is the new head (nextHead, or the wrapped cell with a shield). */
  advance(to: Point = this.nextHead()): void {
    this.#direction = this.#queued.shift() ?? this.#direction;
    this.#body = [to, ...this.#body.slice(0, -1)];
  }

  grow(cells: number): void {
    const tail = this.#body.at(-1) ?? this.head;
    for (let i = 0; i < cells; i++) this.#body.push(tail);
  }

  occupies(p: Point): boolean {
    return this.#body.some((c) => same(c, p));
  }

  /**
   * The cells the head may not enter on the next move. The last cell is not
   * one of them, because the tail leaves it in that same move; after eating,
   * the copies of the tail stay, so the cell remains blocked.
   */
  blocking(): readonly Point[] {
    return this.#body.slice(0, -1);
  }
}
