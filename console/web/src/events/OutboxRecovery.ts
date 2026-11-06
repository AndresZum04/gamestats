import { systemClock, type Clock } from "../core/Clock.js";
import { EventPublisher, type PublisherOptions } from "./EventPublisher.js";
import { Outbox, type KeyValueStore } from "./Outbox.js";
import type { Transport } from "./Transport.js";

export interface RecoveryOptions extends PublisherOptions {
  /** An outbox of another tab untouched for this long (ms) is an orphan. */
  orphanAfterMs?: number;
  /** How often start() looks again (ms). */
  checkEveryMs?: number;
}

/**
 * Sends the events that tabs closed or crashed left in localStorage. Every tab
 * shares localStorage, so an outbox is taken only when its owner is another tab
 * and it has not been touched for 2 minutes: a live publisher saves at least on
 * every attempt, and it never waits more than 30 s between attempts.
 */
export class OutboxRecovery {
  readonly #store: KeyValueStore;
  readonly #transport: Transport;
  readonly #options: RecoveryOptions;
  readonly #clock: Clock;
  readonly #orphanAfterMs: number;
  readonly #taken = new Map<string, EventPublisher>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: KeyValueStore, transport: Transport, options: RecoveryOptions) {
    this.#store = store;
    this.#transport = transport;
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
    this.#orphanAfterMs = options.orphanAfterMs ?? 120_000;
  }

  /** Takes every orphan outbox now and returns the publishers that send them. */
  recover(): EventPublisher[] {
    const now = this.#clock.now();
    const resumed: EventPublisher[] = [];
    for (const matchId of Outbox.matchIds(this.#store)) {
      if (this.#taken.has(matchId)) continue;
      const outbox = new Outbox(matchId, this.#store);
      const entry = outbox.load();
      if (entry === null) {
        outbox.clear(); // unreadable: nothing in it can be sent
        continue;
      }
      if (entry.owner === this.#options.owner || now - entry.updatedAt < this.#orphanAfterMs) {
        continue;
      }
      const publisher = EventPublisher.resume(this.#transport, outbox, this.#options);
      this.#taken.set(matchId, publisher);
      void publisher.close().then(() => this.#taken.delete(matchId));
      resumed.push(publisher);
    }
    return resumed;
  }

  /** Recovers now and then every minute while the tab is open. */
  start(): void {
    this.recover();
    this.#timer ??= setInterval(() => this.recover(), this.#options.checkEveryMs ?? 60_000);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}
