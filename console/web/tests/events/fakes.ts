import { CONSOLE_ID, type AnyGameEvent } from "@gameconsole/shared";
import { MatchContext } from "../../src/core/MatchContext.js";
import { EventFactory } from "../../src/events/EventFactory.js";
import type { KeyValueStore } from "../../src/events/Outbox.js";
import type { Transport } from "../../src/events/Transport.js";

/** localStorage in memory. */
export class MemoryStore implements KeyValueStore {
  readonly #items = new Map<string, string>();
  get length(): number {
    return this.#items.size;
  }
  key(i: number): string | null {
    return [...this.#items.keys()][i] ?? null;
  }
  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
  removeItem(key: string): void {
    this.#items.delete(key);
  }
}

/**
 * Records every request. `failNext` makes the next requests fail; `delayMs`
 * keeps each one in flight that long, to see how many overlap.
 */
export class FakeTransport implements Transport {
  calls: { at: number; events: AnyGameEvent[] }[] = [];
  delivered: AnyGameEvent[] = [];
  beacons: AnyGameEvent[][] = [];
  failNext = 0;
  delayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  readonly #byMatch = new Map<string, number>();
  readonly maxByMatch = new Map<string, number>();

  async send(events: readonly AnyGameEvent[]): Promise<void> {
    const matchId = events[0]?.matchId ?? "";
    this.calls.push({ at: Date.now(), events: [...events] });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const now = (this.#byMatch.get(matchId) ?? 0) + 1;
    this.#byMatch.set(matchId, now);
    this.maxByMatch.set(matchId, Math.max(this.maxByMatch.get(matchId) ?? 0, now));
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.failNext > 0) {
        this.failNext -= 1;
        throw new Error("server down");
      }
      this.delivered.push(...events);
    } finally {
      this.inFlight -= 1;
      this.#byMatch.set(matchId, (this.#byMatch.get(matchId) ?? 1) - 1);
    }
  }

  beacon(events: readonly AnyGameEvent[]): boolean {
    this.beacons.push([...events]);
    return true;
  }
}

/** A trivia match: MATCH_STARTED and then SCORE_CHANGED events. */
export function triviaMatch() {
  const ctx = new MatchContext("trivia", { now: () => Date.now() });
  const factory = new EventFactory(ctx, { consoleId: CONSOLE_ID, sessionId: "tab-a" });
  let total = 0;
  const started = factory.create("MATCH_STARTED", {
    players: ["p-ana"],
    mode: "CLASSIC",
    questions: 10,
  });
  return {
    matchId: ctx.matchId,
    started,
    next: (): AnyGameEvent => {
      total += 10;
      return factory.create("SCORE_CHANGED", { delta: 10, total }, { playerId: "p-ana" });
    },
  };
}

export const seqs = (events: readonly AnyGameEvent[]): number[] => events.map((e) => e.seq);
export const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
