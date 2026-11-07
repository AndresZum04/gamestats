import type { GameId } from "@gameconsole/shared";

/** An answer of GameStats that is not 2xx, with its status (404 for an unknown match). */
export class GameStatsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * The GameStats endpoints the panel uses. Every method returns the JSON as
 * GameStats wrote it: the console shows those figures and never computes its
 * own (the console never computes stats).
 */
export class GameStatsClient {
  readonly #ingestor: string;
  readonly #analyzer: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(
    ingestorUrl: string,
    analyzerUrl: string,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.#ingestor = ingestorUrl.replace(/\/+$/, "");
    this.#analyzer = analyzerUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    // Less than the 2 s between rounds, so two rounds never overlap.
    this.#timeoutMs = options.timeoutMs ?? 1500;
  }

  // ---- ingestor ------------------------------------------------------------

  /** Per game: open, finished and partial matches, accepted events, last event. */
  games(): Promise<unknown> {
    return this.#get(this.#ingestor, "/api/v1/games");
  }
  /** Events received, accepted and rejected, and matches by state. */
  ingestStats(): Promise<unknown> {
    return this.#get(this.#ingestor, "/api/v1/stats");
  }

  // ---- analyzer ------------------------------------------------------------

  summary(): Promise<unknown> {
    return this.#get(this.#analyzer, "/api/v1/summary");
  }
  /** null while the game has no analyzed match (the analyzer answers 404 then). */
  async gameSummary(gameId: GameId): Promise<unknown> {
    try {
      return await this.#get(this.#analyzer, `/api/v1/games/${gameId}/summary`);
    } catch (err) {
      if (err instanceof GameStatsError && err.status === 404) return null;
      throw err;
    }
  }
  leaderboard(gameId: GameId): Promise<unknown> {
    return this.#get(this.#analyzer, `/api/v1/games/${gameId}/leaderboard`);
  }
  patterns(gameId: GameId): Promise<unknown> {
    return this.#get(this.#analyzer, `/api/v1/patterns?gameId=${gameId}&limit=10`);
  }
  /** The last 10 finished matches of the game. */
  recentMatches(gameId: GameId): Promise<unknown> {
    return this.#get(this.#analyzer, `/api/v1/matches?gameId=${gameId}&limit=10`);
  }
  /** Matches still running, with their partial statistics (LIVE batches). */
  liveMatches(gameId: GameId): Promise<unknown> {
    return this.#get(this.#analyzer, `/api/v1/matches?gameId=${gameId}&live=true`);
  }
  match(matchId: string): Promise<unknown> {
    return this.#get(this.#analyzer, `/api/v1/matches/${encodeURIComponent(matchId)}`);
  }

  async #get(base: string, path: string): Promise<unknown> {
    const url = `${base}${path}`;
    const res = await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) });
    if (!res.ok) throw new GameStatsError(`GET ${url} answered ${res.status}`, res.status);
    return res.json();
  }
}
