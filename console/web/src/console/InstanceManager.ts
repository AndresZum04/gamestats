import type { EventSource, GameId } from "@gameconsole/shared";
import { systemClock, type Clock } from "../core/Clock.js";
import type { EventOutlet, Game } from "../core/Game.js";
import type { HumanPlayer } from "../core/Player.js";
import { Rng } from "../core/Rng.js";
import type { GameDefinition, GameRegistry } from "./GameRegistry.js";

export interface Instance {
  /** Local id of the window (1, 2, 3...); the match has its own matchId. */
  id: number;
  definition: GameDefinition;
  game: Game;
}

export interface InstanceManagerOptions {
  registry: GameRegistry;
  outlet: (matchId: string) => EventOutlet;
  source: EventSource;
  human: () => HumanPlayer;
  clock?: Clock;
  /** ?autoplay=1&seed=N: bots play and each instance gets its own seed from N. */
  autoplay?: { seed: number } | null;
  idleTimeoutMs?: number;
  /** The tab must be hidden this long before players count as disconnected. */
  awayAfterMs?: number;
}

/**
 * The game windows open in this tab. It creates and closes instances, keeps
 * which one has the keyboard and applies the rules that concern every game:
 * a closed window or tab ends its match, 5 minutes without action end it as
 * IDLE, and a tab hidden for more than 10 s disconnects its players.
 */
export class InstanceManager {
  readonly #opt: InstanceManagerOptions;
  readonly #clock: Clock;
  readonly #rng: Rng | null;
  readonly #instances: Instance[] = [];
  readonly #listeners = new Set<() => void>();
  #nextId = 1;
  #focused: number | null = null;
  #hiddenAt: number | null = null;
  #awayTimer: ReturnType<typeof setTimeout> | null = null;
  #away = false;

  constructor(options: InstanceManagerOptions) {
    this.#opt = options;
    this.#clock = options.clock ?? systemClock;
    this.#rng = options.autoplay ? new Rng(options.autoplay.seed) : null;
  }

  get instances(): readonly Instance[] {
    return this.#instances;
  }

  get focused(): Instance | undefined {
    return this.#instances.find((i) => i.id === this.#focused);
  }

  /** Creates a match of the game, starts it (unless it shows a start screen) and gives it the keyboard. */
  open(gameId: GameId): Instance {
    const definition = this.#opt.registry.get(gameId);
    if (definition === undefined) throw new Error(`${gameId} is not registered`);
    const game = definition.create({
      human: this.#opt.human(),
      autoplay: this.#rng !== null,
      outlet: this.#opt.outlet,
      source: this.#opt.source,
      clock: this.#clock,
      rng: this.#rng?.fork() ?? new Rng(),
    });
    const instance: Instance = { id: this.#nextId++, definition, game };
    this.#instances.push(instance);
    if (!game.awaitingSetup) game.start();
    this.focus(instance.id);
    return instance;
  }

  /** Closes a window; a match still running ends with PLAYER_LEFT (QUIT). */
  close(id: number): void {
    const index = this.#instances.findIndex((i) => i.id === id);
    const instance = this.#instances[index];
    if (instance === undefined) return;
    instance.game.abandon("QUIT");
    this.#instances.splice(index, 1);
    if (this.#focused === id) {
      this.#focused = null;
      const next = this.#instances[Math.min(index, this.#instances.length - 1)];
      if (next) this.focus(next.id);
    }
    this.#changed();
  }

  /** Gives the keyboard to one instance; the others lose it (Snake pauses). */
  focus(id: number): void {
    if (!this.#instances.some((i) => i.id === id)) return;
    this.#focused = id;
    for (const i of this.#instances) i.game.setFocused(i.id === id && this.#hiddenAt === null);
    this.#changed();
  }

  /** Ends with PLAYER_LEFT (IDLE) every match without action for 5 minutes. */
  checkIdle(): void {
    const limit = this.#opt.idleTimeoutMs ?? 5 * 60_000;
    for (const { game } of this.#instances) {
      if (game.status === "RUNNING" && game.idleMs >= limit) game.abandon("IDLE");
    }
  }

  /** visibilitychange of the tab. */
  setVisible(visible: boolean): void {
    if (!visible) {
      if (this.#hiddenAt !== null) return;
      this.#hiddenAt = this.#clock.now();
      for (const i of this.#instances) i.game.setFocused(false);
      this.#awayTimer = setTimeout(() => {
        this.#away = true;
        for (const i of this.#instances) i.game.disconnect();
      }, this.#opt.awayAfterMs ?? 10_000);
      return;
    }
    if (this.#hiddenAt === null) return;
    const awayMs = this.#clock.now() - this.#hiddenAt;
    this.#hiddenAt = null;
    if (this.#awayTimer !== null) clearTimeout(this.#awayTimer);
    this.#awayTimer = null;
    if (this.#away) for (const i of this.#instances) i.game.reconnect(awayMs);
    this.#away = false;
    const focused = this.focused;
    if (focused) focused.game.setFocused(true);
  }

  /** pagehide: every running match ends (CLOSED_TAB) and is handed to sendBeacon. */
  closeTab(): void {
    for (const { game } of this.#instances) {
      game.abandon("CLOSED_TAB");
      game.beacon();
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
