import type { AnyGameEvent } from "@gameconsole/shared";

/** How a batch of events leaves the browser. */
export interface Transport {
  /** Resolves when the server confirmed the batch; rejects on any failure. */
  send(events: readonly AnyGameEvent[]): Promise<void>;
  /**
   * Hands the batch to the browser to send after the tab closes (sendBeacon).
   * There is no answer, so the events stay in the outbox and OutboxRecovery
   * sends them again on the next load; GameStats drops the repeated eventIds.
   */
  beacon(events: readonly AnyGameEvent[]): boolean;
}

/** POST /api/events of the console server, which answers 202 once the lines are written. */
export class HttpTransport implements Transport {
  readonly #url: string;
  readonly #fetch: typeof fetch;

  constructor(url = "/api/events", fetchFn: typeof fetch = (...args) => fetch(...args)) {
    this.#url = url;
    this.#fetch = fetchFn;
  }

  async send(events: readonly AnyGameEvent[]): Promise<void> {
    const res = await this.#fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events),
    });
    if (!res.ok) throw new Error(`POST ${this.#url}: ${res.status}`);
  }

  beacon(events: readonly AnyGameEvent[]): boolean {
    if (typeof navigator === "undefined" || !("sendBeacon" in navigator)) return false;
    const body = new Blob([JSON.stringify(events)], { type: "application/json" });
    return navigator.sendBeacon(this.#url, body);
  }
}
