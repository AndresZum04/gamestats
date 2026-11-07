import type { DeathCause, MatchStartedData, Placement, PowerUpKind } from "@gameconsole/shared";
import { Game, type GameDeps } from "../../core/Game.js";
import type { HumanPlayer } from "../../core/Player.js";
import { CollisionDetector } from "./CollisionDetector.js";
import { FOODS, pickFood, type Food } from "./Food.js";
import { Grid } from "./Grid.js";
import { LevelPolicy } from "./LevelPolicy.js";
import { keyOf, manhattan, point, same, type Direction, type Point } from "./Point.js";
import {
  POWERUP_CHANCE,
  POWERUP_DURATION_MS,
  POWERUP_KINDS,
  POWERUP_LIFETIME_MS,
  SPEED_FACTOR,
  type PowerUp,
} from "./PowerUp.js";
import { Snake } from "./Snake.js";
import { SnakeBot } from "./SnakeBot.js";

export interface SnakeOptions {
  grid?: Grid;
  lives?: number;
  respawnMs?: number;
  /** ?autoplay=1: SnakeBot plays in the person's seat and the game never pauses. */
  autoplay?: boolean;
}

/** Obstacles never go this close to the head, nor on the row where the snake respawns. */
const OBSTACLE_MARGIN = 4;

/**
 * A snake match, one player and three lives. The logic runs by ticks and
 * draws nothing: SnakeCanvasView reads the state after each tick. Publishing an
 * event only queues it in the EventPublisher, so a tick never waits for the
 * network.
 *
 * The game pauses while its instance does not have the keyboard (or the tab is
 * hidden), except in autoplay mode, where nobody is watching each instance.
 */
export class SnakeGame extends Game<"snake"> {
  readonly grid: Grid;
  readonly #host: HumanPlayer;
  readonly #policy = new LevelPolicy();
  readonly #detector: CollisionDetector;
  readonly #lives: number;
  readonly #respawnMs: number;
  readonly #bot: SnakeBot | null;
  readonly #obstacles = new Set<string>();
  /** Active powers and the clock time each one ends. */
  readonly #effects = new Map<PowerUpKind, number>();
  #snake: Snake;
  #food: Food | null = null;
  #powerUp: PowerUp | null = null;
  #livesLeft: number;
  #fruits = 0;
  #level = 1;
  #score = 0;
  #focused = false;
  #dead = false;
  #tickTimer: ReturnType<typeof setTimeout> | null = null;
  #respawnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: HumanPlayer, deps: GameDeps, options: SnakeOptions = {}) {
    super("snake", [host], deps);
    this.#host = host;
    this.grid = options.grid ?? new Grid();
    this.#detector = new CollisionDetector(this.grid);
    this.#lives = options.lives ?? 3;
    this.#livesLeft = this.#lives;
    this.#respawnMs = options.respawnMs ?? 1500;
    this.#bot = options.autoplay ? new SnakeBot(this.rng.fork()) : null;
    this.#snake = this.#newSnake();
  }

  // ---- What the view reads ------------------------------------------------

  get snake(): Snake {
    return this.#snake;
  }
  get food(): Food | null {
    return this.#food;
  }
  get powerUp(): PowerUp | null {
    return this.#powerUp;
  }
  get obstacles(): readonly Point[] {
    return [...this.#obstacles].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return point(x ?? 0, y ?? 0);
    });
  }
  get score(): number {
    return this.#score;
  }
  get livesLeft(): number {
    return this.#livesLeft;
  }
  get level(): number {
    return this.#level;
  }
  /** Active powers and the ms left of each. */
  get effects(): { kind: PowerUpKind; leftMs: number }[] {
    const now = this.clock.now();
    return [...this.#effects].map(([kind, end]) => ({ kind, leftMs: Math.max(0, end - now) }));
  }
  /** Waiting to respawn after losing a life. */
  get dead(): boolean {
    return this.#dead;
  }
  get paused(): boolean {
    return this.status === "RUNNING" && !this.#running();
  }
  get autoplay(): boolean {
    return this.#bot !== null;
  }
  /** Current tick, with SPEED or SLOW applied. */
  get tickMs(): number {
    const base = this.#policy.tickMs(this.#level);
    if (this.#effects.has("SPEED")) return Math.round(base * SPEED_FACTOR.SPEED);
    if (this.#effects.has("SLOW")) return Math.round(base * SPEED_FACTOR.SLOW);
    return base;
  }

  // ---- What the view calls ------------------------------------------------

  /** Arrow keys, WASD or the on-screen buttons; false if the turn was not kept. */
  turn(direction: Direction): boolean {
    if (this.status !== "RUNNING" || this.#bot !== null) return false;
    this.markActivity();
    return this.#snake.turn(direction);
  }

  override setFocused(focused: boolean): void {
    this.#focused = focused;
    this.#schedule();
    this.changed();
  }

  // ---- Game ---------------------------------------------------------------

  protected startData(): MatchStartedData<"snake"> {
    return {
      players: [this.#host.id],
      mode: "CLASSIC",
      lives: this.#lives,
      grid: this.grid.label,
    };
  }

  protected onStart(): void {
    this.#placeFood();
    this.#schedule();
  }

  protected buildResults(): Placement[] {
    return [{ playerId: this.#host.id, placement: 1 }];
  }

  protected override finishData() {
    return { finalScore: this.#score };
  }

  protected override onFinish(): void {
    this.#stop();
    if (this.#respawnTimer !== null) clearTimeout(this.#respawnTimer);
    this.#respawnTimer = null;
  }

  // ---- The loop -----------------------------------------------------------

  #running(): boolean {
    return this.status === "RUNNING" && !this.#dead && (this.#focused || this.#bot !== null);
  }

  /** Keeps one tick timer while the game runs and none while it is paused. */
  #schedule(): void {
    if (!this.#running()) {
      this.#stop();
      return;
    }
    if (this.#tickTimer !== null) return;
    this.#tickTimer = setTimeout(() => {
      this.#tickTimer = null;
      this.#tick();
      this.#schedule();
    }, this.tickMs);
  }

  #stop(): void {
    if (this.#tickTimer !== null) clearTimeout(this.#tickTimer);
    this.#tickTimer = null;
  }

  /** One move of the snake and what it meets. */
  #tick(): void {
    if (!this.#running()) return;
    this.#expire();
    if (this.#bot !== null) {
      // The bot goes for a power when it is closer than the fruit.
      const head = this.#snake.head;
      const fruit = this.#food?.at ?? this.grid.center();
      const power = this.#powerUp?.at;
      const target =
        power !== undefined && manhattan(head, power) < manhattan(head, fruit) ? power : fruit;
      this.#snake.turn(
        this.#bot.choose({
          snake: this.#snake,
          target,
          obstacles: this.#obstacles,
          detector: this.#detector,
        }),
      );
      this.markActivity(); // the autoplay bot stands for the person
    }

    let next = this.#snake.nextHead();
    const shield = this.#effects.has("SHIELD");
    if (shield) next = this.grid.wrap(next);
    const cause = this.#detector.check(this.#snake, next, this.#obstacles);
    if (cause !== null && !shield) {
      this.#die(cause);
      return;
    }
    this.#snake.advance(next);

    if (this.#food !== null && same(this.#food.at, next)) this.#eat(this.#food);
    if (this.#powerUp !== null && same(this.#powerUp.at, next)) this.#pick(this.#powerUp);
    this.changed();
  }

  /** Ends powers whose time is over, a BONUS not eaten in time and an old power on the board. */
  #expire(): void {
    const now = this.clock.now();
    for (const [kind, end] of this.#effects) if (end <= now) this.#effects.delete(kind);
    const foodEnds = this.#food?.expiresAt ?? null;
    if (foodEnds !== null && foodEnds <= now) this.#placeFood("APPLE");
    if (this.#powerUp !== null && this.#powerUp.expiresAt <= now) this.#powerUp = null;
  }

  #eat(food: Food): void {
    const kind = FOODS[food.type];
    this.#snake.grow(kind.grow);
    const points = kind.points * (this.#effects.has("DOUBLE_POINTS") ? 2 : 1);
    this.#score += points;
    this.#fruits += 1;
    this.#bot?.ate();
    const playerId = this.#host.id;
    this.emit(
      "FOOD_EATEN",
      { foodType: food.type, length: this.#snake.length, points },
      { playerId },
    );
    this.scoreChanged(playerId, { delta: points, total: this.#score, reason: food.type });

    const level = this.#policy.levelFor(this.#fruits);
    if (level > this.#level) {
      this.#level = level;
      this.emit("LEVEL_UP", { level, speed: this.#policy.speed(level) }, { playerId });
      this.#addObstacles(this.#policy.obstacles(level));
    }

    this.#placeFood();
    if (this.#powerUp === null && this.rng.chance(POWERUP_CHANCE)) this.#placePowerUp();
  }

  #pick(powerUp: PowerUp): void {
    const durationMs = POWERUP_DURATION_MS[powerUp.kind];
    if (powerUp.kind === "SPEED") this.#effects.delete("SLOW");
    if (powerUp.kind === "SLOW") this.#effects.delete("SPEED");
    this.#effects.set(powerUp.kind, this.clock.now() + durationMs);
    this.#powerUp = null;
    this.emit("POWERUP_PICKED", { powerup: powerUp.kind, durationMs }, { playerId: this.#host.id });
  }

  #die(cause: DeathCause): void {
    this.#livesLeft -= 1;
    this.#effects.clear();
    this.emit(
      "SNAKE_DIED",
      { cause, length: this.#snake.length, livesLeft: this.#livesLeft },
      { playerId: this.#host.id },
    );
    if (this.#livesLeft <= 0) {
      this.finish();
      return;
    }
    this.#dead = true;
    this.#stop();
    this.changed();
    this.#respawnTimer = setTimeout(() => this.#respawn(), this.#respawnMs);
  }

  #respawn(): void {
    this.#respawnTimer = null;
    if (this.status !== "RUNNING") return;
    this.#snake = this.#newSnake();
    this.#dead = false;
    this.#bot?.newLife();
    if (this.#food !== null && this.#snake.occupies(this.#food.at)) this.#placeFood();
    if (this.#powerUp !== null && this.#snake.occupies(this.#powerUp.at)) this.#powerUp = null;
    this.emit("PLAYER_RESPAWNED", { livesLeft: this.#livesLeft }, { playerId: this.#host.id });
    this.#schedule();
    this.changed();
  }

  // ---- The board ----------------------------------------------------------

  /** Three cells in the middle row, going right. */
  #newSnake(): Snake {
    return new Snake(this.grid.center(), "RIGHT", 3);
  }

  #taken = (p: Point): boolean =>
    this.#snake.occupies(p) ||
    this.#obstacles.has(keyOf(p)) ||
    (this.#food !== null && same(this.#food.at, p)) ||
    (this.#powerUp !== null && same(this.#powerUp.at, p));

  #placeFood(type = pickFood(this.rng)): void {
    this.#food = null;
    const at = this.grid.randomFree(this.rng, this.#taken);
    if (at === null) return;
    const lifetime = FOODS[type].lifetimeMs;
    this.#food = { type, at, expiresAt: lifetime === null ? null : this.clock.now() + lifetime };
  }

  #placePowerUp(): void {
    const at = this.grid.randomFree(this.rng, this.#taken);
    if (at === null) return;
    const kind = this.rng.pick(POWERUP_KINDS);
    this.#powerUp = { kind, at, expiresAt: this.clock.now() + POWERUP_LIFETIME_MS };
  }

  /** Adds obstacles up to `count`, away from the head and off the respawn row. */
  #addObstacles(count: number): void {
    const head = this.#snake.head;
    const respawnRow = this.grid.center().y;
    const avoid = (p: Point) =>
      this.#taken(p) || manhattan(p, head) < OBSTACLE_MARGIN || p.y === respawnRow;
    while (this.#obstacles.size < count) {
      const at = this.grid.randomFree(this.rng, avoid);
      if (at === null) return;
      this.#obstacles.add(keyOf(at));
    }
  }
}
