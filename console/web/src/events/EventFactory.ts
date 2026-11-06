import {
  EVENT_SPECS,
  GAME_VERSION,
  SCHEMA_VERSION,
  type EventData,
  type EventSource,
  type EventType,
  type GameEvent,
  type GameId,
} from "@gameconsole/shared";
import type { MatchContext } from "../core/MatchContext.js";

export interface EventOptions {
  playerId?: string | null;
  /** Envelope `action`, for example HIT, STAND or DOUBLE on a blackjack DECISION. */
  action?: string;
}

/**
 * A copy of `value` without keys whose value is undefined, at any depth.
 * JSON.stringify would drop them anyway, but then the event in memory and the
 * one on disk would differ; the console never emits an undefined field.
 */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, withoutUndefined(v)]),
    ) as T;
  }
  return value;
}

/**
 * Builds complete events of one match with the GameStats envelope. It enforces
 * the console's rules: MATCH_STARTED is the first event, nothing comes after
 * MATCH_FINISHED and a type that needs a player always has one.
 */
export class EventFactory<G extends GameId> {
  readonly #context: MatchContext<G>;
  readonly #source: EventSource;
  readonly #newId: () => string;

  constructor(
    context: MatchContext<G>,
    source: EventSource,
    newId: () => string = () => crypto.randomUUID(),
  ) {
    this.#context = context;
    this.#source = source;
    this.#newId = newId;
  }

  create<T extends EventType<G>>(
    type: T,
    data: EventData<G, T>,
    options: EventOptions = {},
  ): GameEvent<G, T> {
    const ctx = this.#context;
    const first = ctx.lastSeq === 0;
    if (first !== (type === "MATCH_STARTED")) {
      throw new Error(`${type} in ${ctx.matchId}: MATCH_STARTED must be the first event`);
    }
    const playerId = options.playerId ?? null;
    if (EVENT_SPECS[ctx.gameId][type].playerRequired && playerId === null) {
      throw new Error(`${type} in ${ctx.matchId} needs a playerId`);
    }

    const event: GameEvent<G, T> = {
      schemaVersion: SCHEMA_VERSION,
      eventId: this.#newId(),
      timestamp: new Date(ctx.clock.now()).toISOString(),
      gameId: ctx.gameId,
      gameVersion: GAME_VERSION,
      matchId: ctx.matchId,
      seq: ctx.nextSeq(),
      playerId,
      type,
      ...(options.action === undefined ? {} : { action: options.action }),
      source: { ...this.#source },
      data: withoutUndefined(data),
    };
    if (type === "MATCH_FINISHED") ctx.finish();
    return event;
  }
}
