import { GAME_IDS, type GameId } from "@gameconsole/shared";
import type { GameStatsClient } from "./GameStatsClient.js";

/** What the panel shows of one game, each part as GameStats answered it. */
export interface GameStatsView {
  summary: unknown;
  leaderboard: unknown;
  patterns: unknown;
  recent: unknown;
  live: unknown;
}

export interface StatsSnapshot {
  generatedAt: string;
  /** False if some query failed this round; the data is then the last good one. */
  gamestatsUp: boolean;
  /** When every query last answered, or null if none has yet. */
  lastOkAt: string | null;
  general: { games: unknown; ingest: unknown; summary: unknown };
  byGame: Record<GameId, GameStatsView>;
}

export interface StatsHubOptions {
  intervalMs?: number;
  now?: () => number;
  log?: { warn(obj: object, msg: string): void };
}

type Listener = (snapshot: StatsSnapshot) => void;

const emptyGame = (): GameStatsView => ({
  summary: null,
  leaderboard: null,
  patterns: null,
  recent: null,
  live: null,
});

/**
 * Asks GameStats every 2 s, all the queries in parallel, and hands the result
 * to every connected panel. It is one series of queries no matter how many
 * panels are open, and none while nobody is connected.
 *
 * It does not add, average or sort anything: each figure goes to the panel as
 * GameStats returned it. If a query fails, gamestatsUp is false and that part
 * keeps its last good value.
 */
export class StatsHub {
  readonly #client: GameStatsClient;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #log: StatsHubOptions["log"];
  readonly #listeners = new Set<Listener>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #latest: StatsSnapshot | null = null;

  constructor(client: GameStatsClient, options: StatsHubOptions = {}) {
    this.#client = client;
    this.#intervalMs = options.intervalMs ?? 2000;
    this.#now = options.now ?? Date.now;
    this.#log = options.log;
  }

  get latest(): StatsSnapshot | null {
    return this.#latest;
  }
  get listeners(): number {
    return this.#listeners.size;
  }

  /** A panel connects: it gets the last snapshot now and every new one. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    if (this.#latest) listener(this.#latest);
    if (this.#timer === null) {
      void this.poll();
      this.#timer = setInterval(() => void this.poll(), this.#intervalMs);
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.stop();
    };
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One round of queries. A round still running makes the next tick wait. */
  async poll(): Promise<StatsSnapshot | null> {
    if (this.#polling) return this.#latest;
    this.#polling = true;
    try {
      const snapshot = await this.#collect();
      this.#latest = snapshot;
      for (const listener of this.#listeners) listener(snapshot);
      return snapshot;
    } finally {
      this.#polling = false;
    }
  }

  async #collect(): Promise<StatsSnapshot> {
    const c = this.#client;
    const prev = this.#latest;
    const failures: string[] = [];
    // Each part: the new answer, or the last good one if this query failed.
    const part = async (name: string, ask: () => Promise<unknown>, last: unknown) => {
      try {
        return await ask();
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        return last ?? null;
      }
    };

    const general = Promise.all([
      part("games", () => c.games(), prev?.general.games),
      part("ingest", () => c.ingestStats(), prev?.general.ingest),
      part("summary", () => c.summary(), prev?.general.summary),
    ]);
    const perGame = Promise.all(
      GAME_IDS.map(async (id) => {
        const last = prev?.byGame[id] ?? emptyGame();
        const [summary, leaderboard, patterns, recent, live] = await Promise.all([
          part(`${id} summary`, () => c.gameSummary(id), last.summary),
          part(`${id} leaderboard`, () => c.leaderboard(id), last.leaderboard),
          part(`${id} patterns`, () => c.patterns(id), last.patterns),
          part(`${id} recent`, () => c.recentMatches(id), last.recent),
          part(`${id} live`, () => c.liveMatches(id), last.live),
        ]);
        return [id, { summary, leaderboard, patterns, recent, live }] as const;
      }),
    );
    const [[games, ingest, summary], byGame] = await Promise.all([general, perGame]);

    const now = new Date(this.#now()).toISOString();
    const up = failures.length === 0;
    if (!up) this.#log?.warn({ failures: failures.slice(0, 3) }, "gamestats did not answer");
    return {
      generatedAt: now,
      gamestatsUp: up,
      lastOkAt: up ? now : (prev?.lastOkAt ?? null),
      general: { games, ingest, summary },
      byGame: Object.fromEntries(byGame) as Record<GameId, GameStatsView>,
    };
  }
}
