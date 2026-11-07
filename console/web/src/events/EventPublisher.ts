import type { AnyGameEvent } from "@gameconsole/shared";
import { systemClock, type Clock } from "../core/Clock.js";
import type { Outbox } from "./Outbox.js";
import type { Transport } from "./Transport.js";

export interface PublisherOptions {
  /** sessionId of this tab, written as the outbox owner. */
  owner: string;
  clock?: Clock;
  /** Send at most this often (ms). */
  flushIntervalMs?: number;
  /** Send right away once this many events are waiting. */
  batchSize?: number;
  /** Most events per request; the server accepts up to 500. */
  maxBatch?: number;
  /** Waits after each consecutive failure (ms); then retryEveryMs forever. */
  backoffMs?: readonly number[];
  retryEveryMs?: number;
}

const DEFAULTS = {
  flushIntervalMs: 500,
  batchSize: 20,
  maxBatch: 500,
  backoffMs: [1000, 2000, 4000, 8000, 16000],
  retryEveryMs: 30000,
} as const;

/**
 * Sends the events of one match. The game only calls publish(), which never
 * waits for the network. Events wait in a queue (and in the outbox) and go out
 * every 500 ms or once 20 are waiting. There is never more than one request of
 * the same match in flight, so they arrive in seq order; publishers of other
 * matches are independent and send in parallel. A failed batch stays at the
 * front of the queue and is retried after 1, 2, 4, 8 and 16 s, then every 30 s.
 */
export class EventPublisher {
  readonly matchId: string;
  readonly #transport: Transport;
  readonly #outbox: Outbox;
  readonly #owner: string;
  readonly #clock: Clock;
  readonly #opt: Required<Omit<PublisherOptions, "owner" | "clock">>;

  #queue: AnyGameEvent[] = [];
  #inFlight = false;
  #failures = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #timerDue = 0;
  #closed = false;
  #idle: (() => void)[] = [];

  constructor(transport: Transport, outbox: Outbox, options: PublisherOptions) {
    this.matchId = outbox.matchId;
    this.#transport = transport;
    this.#outbox = outbox;
    this.#owner = options.owner;
    this.#clock = options.clock ?? systemClock;
    this.#opt = {
      flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      batchSize: options.batchSize ?? DEFAULTS.batchSize,
      maxBatch: options.maxBatch ?? DEFAULTS.maxBatch,
      backoffMs: options.backoffMs ?? DEFAULTS.backoffMs,
      retryEveryMs: options.retryEveryMs ?? DEFAULTS.retryEveryMs,
    };
  }

  /**
   * A publisher for events another tab left in the outbox: it takes them over
   * (this tab becomes the owner), sends them with the same retries and closes.
   */
  static resume(transport: Transport, outbox: Outbox, options: PublisherOptions): EventPublisher {
    const publisher = new EventPublisher(transport, outbox, options);
    publisher.#queue = [...(outbox.load()?.events ?? [])];
    publisher.#persist();
    return publisher;
  }

  /** Events not confirmed yet. */
  get pending(): number {
    return this.#queue.length;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Consecutive failed sends; 0 after a success. */
  get failures(): number {
    return this.#failures;
  }

  publish(event: AnyGameEvent): void {
    if (this.#closed) throw new Error(`publisher of ${this.matchId} is closed`);
    if (event.matchId !== this.matchId) {
      throw new Error(`event of ${event.matchId} sent to the publisher of ${this.matchId}`);
    }
    this.#queue.push(event);
    this.#persist();
    this.#schedule(this.#queue.length >= this.#opt.batchSize ? 0 : this.#opt.flushIntervalMs);
  }

  /**
   * No more events will come: sends what is left right away and resolves once
   * the server has confirmed everything. It keeps retrying while the tab is
   * open, so it may take long when the server is down; nobody needs to await it.
   */
  close(): Promise<void> {
    this.#closed = true;
    const done = this.#whenIdle();
    this.#schedule(0);
    return done;
  }

  /**
   * The tab is closing: hands the pending events to sendBeacon. They stay in
   * the outbox in case the beacon is lost.
   */
  beacon(): boolean {
    this.#stopTimer();
    return (
      this.#queue.length > 0 && this.#transport.beacon(this.#queue.slice(0, this.#opt.maxBatch))
    );
  }

  /** Stops the timers without sending; the outbox keeps the pending events. */
  dispose(): void {
    this.#stopTimer();
    this.#closed = true;
  }

  #persist(): void {
    this.#outbox.save(this.#owner, this.#clock.now(), this.#queue);
  }

  #whenIdle(): Promise<void> {
    if (this.#queue.length === 0 && !this.#inFlight) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  /** Makes sure a send happens within `delayMs`, without delaying an earlier one. */
  #schedule(delayMs: number): void {
    if (this.#inFlight || this.#queue.length === 0) return;
    const due = this.#clock.now() + delayMs;
    if (this.#timer !== null) {
      // While waiting after a failure, new events do not cut the wait short.
      if (this.#failures > 0 || this.#timerDue <= due) return;
      clearTimeout(this.#timer);
    }
    this.#timerDue = due;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#send();
    }, delayMs);
  }

  #stopTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #send(): Promise<void> {
    if (this.#inFlight || this.#queue.length === 0) return;
    this.#inFlight = true;
    const batch = this.#queue.slice(0, this.#opt.maxBatch);
    this.#persist(); // refreshes updatedAt: the outbox is still owned
    let ok = true;
    try {
      await this.#transport.send(batch);
    } catch {
      ok = false;
    }
    this.#inFlight = false;

    if (ok) {
      // The batch is the front of the queue: events published meanwhile stay.
      this.#queue = this.#queue.slice(batch.length);
      this.#failures = 0;
      this.#persist();
      const full = this.#queue.length >= this.#opt.batchSize || this.#closed;
      this.#schedule(full ? 0 : this.#opt.flushIntervalMs);
    } else {
      this.#failures += 1;
      const wait = this.#opt.backoffMs[this.#failures - 1] ?? this.#opt.retryEveryMs;
      this.#schedule(wait);
    }

    if (this.#queue.length === 0) {
      if (this.#closed) this.#outbox.clear();
      this.#idle.splice(0).forEach((resolve) => resolve());
    }
  }
}
