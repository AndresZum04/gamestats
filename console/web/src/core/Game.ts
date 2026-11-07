import type {
  AnyGameEvent,
  CommonData,
  CommonEventType,
  EventData,
  EventSource,
  EventType,
  GameId,
  LeaveReason,
  MatchStartedData,
  Placement,
} from "@gameconsole/shared";
import { EventFactory, type EventOptions } from "../events/EventFactory.js";
import { systemClock, type Clock } from "./Clock.js";
import { MatchContext } from "./MatchContext.js";
import type { Player } from "./Player.js";
import { Rng } from "./Rng.js";

export type GameStatus = "READY" | "RUNNING" | "FINISHED";

/** Where a game's events go: an EventPublisher, or a fake one in tests. */
export interface EventOutlet {
  publish(event: AnyGameEvent): void;
  /** No more events: send the rest. Nobody waits for it. */
  close(): Promise<void>;
  /** The tab is closing: hand what is pending to sendBeacon. */
  beacon(): boolean;
}

export interface GameDeps {
  /** Builds the outlet of the match once its matchId exists. */
  outlet: (matchId: string) => EventOutlet;
  source: EventSource;
  clock?: Clock;
  rng?: Rng;
}

/**
 * A match of any game. It owns the match's identity, its events and its life
 * cycle (READY, RUNNING, FINISHED), and emits the general events itself, so a
 * game only says what is particular to it: the data of MATCH_STARTED, how it
 * starts and the final results. Game logic never touches the DOM or the
 * network; views read it and call its methods.
 */
export abstract class Game<G extends GameId = GameId> {
  readonly #context: MatchContext<G>;
  readonly #factory: EventFactory<G>;
  readonly #outlet: EventOutlet;
  readonly #players: readonly Player[];
  readonly #listeners = new Set<() => void>();
  #status: GameStatus = "READY";
  #lastActivity: number;
  readonly #away = new Set<string>();
  protected readonly clock: Clock;
  protected readonly rng: Rng;

  constructor(gameId: G, players: readonly Player[], deps: GameDeps) {
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? new Rng();
    this.#context = new MatchContext(gameId, this.clock);
    this.#factory = new EventFactory(this.#context, deps.source);
    this.#outlet = deps.outlet(this.#context.matchId);
    this.#players = [...players];
    this.#lastActivity = this.clock.now();
  }

  get gameId(): G {
    return this.#context.gameId;
  }
  get matchId(): string {
    return this.#context.matchId;
  }
  get status(): GameStatus {
    return this.#status;
  }
  get players(): readonly Player[] {
    return this.#players;
  }
  get humans(): readonly Player[] {
    return this.#players.filter((p) => !p.isBot);
  }
  /** Milliseconds since the last action of a person (or of the autoplay bot). */
  get idleMs(): number {
    return this.clock.now() - this.#lastActivity;
  }

  /** Emits MATCH_STARTED and a PLAYER_JOINED per player, then lets the game begin. */
  start(): void {
    if (this.#status !== "READY") return;
    this.#status = "RUNNING";
    this.#lastActivity = this.clock.now();
    this.#publish(this.#factory.create("MATCH_STARTED" as EventType<G>, this.startData() as never));
    for (const p of this.#players) this.#emitCommon("PLAYER_JOINED", {}, p.id);
    this.onStart();
    this.changed();
  }

  /** Emits MATCH_FINISHED, the last event of the match, and closes the outlet. */
  finish(): void {
    if (this.#status !== "RUNNING") return;
    this.#status = "FINISHED";
    this.onFinish();
    this.#emitCommon("MATCH_FINISHED", {
      durationMs: this.#context.elapsedMs(),
      results: this.buildResults(),
      ...this.finishData(),
    });
    void this.#outlet.close();
    this.changed();
  }

  /**
   * The people leave before the end (closed window, closed tab, inactivity):
   * PLAYER_LEFT for each of them and then MATCH_FINISHED with the results so far.
   */
  abandon(reason: LeaveReason): void {
    if (this.#status === "READY") {
      this.#status = "FINISHED";
      void this.#outlet.close();
      this.changed();
      return;
    }
    if (this.#status !== "RUNNING") return;
    for (const p of this.humans) this.#emitCommon("PLAYER_LEFT", { reason }, p.id);
    this.finish();
  }

  /** The tab has been hidden long enough: the people count as disconnected. */
  disconnect(): void {
    if (this.#status !== "RUNNING") return;
    for (const p of this.humans) {
      if (this.#away.has(p.id)) continue;
      this.#away.add(p.id);
      this.#emitCommon("PLAYER_DISCONNECTED", {}, p.id);
    }
  }

  reconnect(awayMs: number): void {
    if (this.#status !== "RUNNING") return;
    for (const id of this.#away) this.#emitCommon("PLAYER_RECONNECTED", { awayMs }, id);
    this.#away.clear();
  }

  /** Hands what is pending to sendBeacon (the tab is closing). */
  beacon(): boolean {
    return this.#outlet.beacon();
  }

  /** Called with true when this instance gets the keyboard, false when it loses it. */
  setFocused(_focused: boolean): void {
    // games that care (Snake pauses) override it
  }

  /** Views subscribe to redraw; returns the function that unsubscribes. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Emits one event of the game's own types. */
  protected emit<T extends EventType<G>>(
    type: T,
    data: EventData<G, T>,
    options: EventOptions = {},
  ): void {
    if (this.#status !== "RUNNING") return; // nothing after MATCH_FINISHED (LATE_EVENT)
    this.#publish(this.#factory.create(type, data, options));
  }

  /** SCORE_CHANGED, the general event most games use for points. */
  protected scoreChanged(playerId: string, data: CommonData["SCORE_CHANGED"]): void {
    if (this.#status === "RUNNING") this.#emitCommon("SCORE_CHANGED", data, playerId);
  }

  /** A person acted: resets the inactivity clock. */
  protected markActivity(): void {
    this.#lastActivity = this.clock.now();
  }

  /** Tells the views that the state changed. */
  protected changed(): void {
    for (const listener of this.#listeners) listener();
  }

  /** `data` of MATCH_STARTED: players, mode and the game's own keys. */
  protected abstract startData(): MatchStartedData<G>;
  /** The first moves of the game, right after MATCH_STARTED and PLAYER_JOINED. */
  protected abstract onStart(): void;
  /** Final placement of each player, for MATCH_FINISHED. */
  protected abstract buildResults(): Placement[];
  /** Extra keys of MATCH_FINISHED (finalScore in Snake). */
  protected finishData(): Partial<CommonData["MATCH_FINISHED"]> {
    return {};
  }
  /** Stops the game's timers before MATCH_FINISHED. */
  protected onFinish(): void {
    // games with timers override it
  }

  #emitCommon<T extends CommonEventType>(type: T, data: CommonData[T], playerId?: string): void {
    // The general types exist in every game; the compiler cannot see it for a generic G.
    const event = this.#factory.create(type as EventType<G>, data as never, {
      playerId: playerId ?? null,
    });
    this.#publish(event);
  }

  #publish(event: AnyGameEvent | ReturnType<EventFactory<G>["create"]>): void {
    this.#outlet.publish(event as AnyGameEvent);
  }
}
