/** Prolog did not answer: timeouts, network errors or 5xx on every attempt. */
export class PrologUnavailable extends Error {}

/** What Prolog answered: 200 with the result, or 400 with its error. */
export interface PrologReply {
  status: number;
  body: unknown;
}

export interface PrologClientOptions {
  fetch?: typeof fetch;
  /** Limit of each attempt. */
  timeoutMs?: number;
  /** Attempts after the first one. */
  retries?: number;
}

/**
 * Talks to the Prolog service (prolog/server.pl). Each call has 2 s and is
 * retried twice on a timeout, a network error or a 5xx; a 400 is Prolog
 * saying the query is wrong, which would not change by retrying.
 */
export class PrologClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #retries: number;

  constructor(baseUrl: string, options: PrologClientOptions = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#timeoutMs = options.timeoutMs ?? 2000;
    this.#retries = options.retries ?? 2;
  }

  decision(query: unknown): Promise<PrologReply> {
    return this.#post("/blackjack/decision", query);
  }

  bet(query: unknown): Promise<PrologReply> {
    return this.#post("/blackjack/bet", query);
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.#fetch(`${this.#baseUrl}/health`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async #post(path: string, query: unknown): Promise<PrologReply> {
    const url = `${this.#baseUrl}${path}`;
    const body = JSON.stringify(query);
    let lastError = "";
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      try {
        const res = await this.#fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (res.status < 500) return { status: res.status, body: await res.json() };
        lastError = `status ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new PrologUnavailable(`POST ${url} failed: ${lastError}`);
  }
}
