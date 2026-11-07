import type { FastifyBaseLogger } from "fastify";
import type { EventSink } from "./EventSink.js";

/** The 202 body of the ingestor's POST /api/v1/events. */
interface IngestResult {
  accepted: number;
  rejected: number;
  errors: { index: number; reason: string; detail: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends the events to POST /api/v1/events of the ingestor, for a console that
 * runs on another machine than GameStats. Network errors, 429 and 5xx are
 * retried after 200, 500 and 1000 ms; then the write fails and the browser
 * retries. A 202 counts as written even if GameStats rejected some events:
 * deciding that is its job, and they are listed in its /api/v1/rejected.
 */
export class HttpSink implements EventSink {
  readonly kind = "http";
  readonly #url: string;
  readonly #fetch: typeof fetch;
  readonly #log: FastifyBaseLogger | undefined;
  readonly #backoffMs: readonly number[];

  constructor(
    ingestorUrl: string,
    options: { fetch?: typeof fetch; log?: FastifyBaseLogger; backoffMs?: readonly number[] } = {},
  ) {
    this.#url = `${ingestorUrl}/api/v1/events`;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#log = options.log;
    this.#backoffMs = options.backoffMs ?? [200, 500, 1000];
  }

  async write(_gameId: string, matchId: string, events: readonly unknown[]): Promise<void> {
    if (events.length === 0) return;
    const body = JSON.stringify(events);
    let lastError = "";
    for (let attempt = 0; attempt <= this.#backoffMs.length; attempt++) {
      if (attempt > 0) await sleep(this.#backoffMs[attempt - 1] ?? 0);
      try {
        const res = await this.#fetch(this.#url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 202) {
          const result = (await res.json()) as IngestResult;
          if (result.rejected > 0) {
            this.#log?.warn(
              { matchId, rejected: result.rejected, errors: result.errors },
              "ingestor rejected events",
            );
          }
          return;
        }
        lastError = `status ${res.status}`;
        if (res.status !== 429 && res.status < 500) break; // a 400 will not change by retrying
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(`POST ${this.#url} failed: ${lastError}`);
  }
}
