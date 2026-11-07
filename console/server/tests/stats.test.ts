import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { GameStatsClient } from "../src/stats/GameStatsClient.js";
import { StatsHub, type StatsSnapshot } from "../src/stats/StatsHub.js";
import { testConfig } from "./helpers.js";

/** GameStats in memory: each GET answers {path}; `down` makes every call fail. */
function fakeGameStats() {
  const calls: string[] = [];
  const state = { down: false, missing: new Set<string>() };
  const fn = async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const path = u.pathname + u.search;
    calls.push(`${u.host}${path}`);
    if (state.down) throw new TypeError("fetch failed");
    if (state.missing.has(u.pathname)) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ path }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new GameStatsClient("http://ingestor:8080", "http://analyzer:8081", {
    fetch: fn as typeof fetch,
  });
  return { client, calls, state };
}

/** Queries of one round: 3 general ones and 5 for each of the 3 games. */
const ROUND = 3 + 5 * 3;

afterEach(() => {
  vi.useRealTimers();
});

describe("StatsHub", () => {
  it("asks nothing while nobody is connected", async () => {
    vi.useFakeTimers();
    const gs = fakeGameStats();
    new StatsHub(gs.client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gs.calls).toEqual([]);
  });

  it("two panels get the same snapshots from one series of queries every 2 s", async () => {
    vi.useFakeTimers();
    const gs = fakeGameStats();
    const hub = new StatsHub(gs.client);
    const a: StatsSnapshot[] = [];
    const b: StatsSnapshot[] = [];
    const offA = hub.subscribe((s) => a.push(s));
    await vi.advanceTimersByTimeAsync(0);
    const offB = hub.subscribe((s) => b.push(s));
    expect(b).toHaveLength(1); // the second panel gets the last snapshot at once
    expect(gs.calls).toHaveLength(ROUND);

    await vi.advanceTimersByTimeAsync(6000);
    expect(gs.calls).toHaveLength(4 * ROUND);
    expect(a.at(-1)).toBe(b.at(-1));

    offA();
    offB();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gs.calls).toHaveLength(4 * ROUND); // nobody left: no more queries
  });

  it("passes GameStats' answers as they are, in general and per game", async () => {
    const gs = fakeGameStats();
    const snap = await new StatsHub(gs.client, {
      now: () => Date.parse("2026-11-06T20:00:00Z"),
    }).poll();
    expect(snap).toMatchObject({
      generatedAt: "2026-11-06T20:00:00.000Z",
      gamestatsUp: true,
      lastOkAt: "2026-11-06T20:00:00.000Z",
      general: {
        games: { path: "/api/v1/games" },
        ingest: { path: "/api/v1/stats" },
        summary: { path: "/api/v1/summary" },
      },
    });
    expect(snap?.byGame.blackjack).toEqual({
      summary: { path: "/api/v1/games/blackjack/summary" },
      leaderboard: { path: "/api/v1/games/blackjack/leaderboard" },
      patterns: { path: "/api/v1/patterns?gameId=blackjack&limit=10" },
      recent: { path: "/api/v1/matches?gameId=blackjack&limit=10" },
      live: { path: "/api/v1/matches?gameId=blackjack&live=true" },
    });
    expect(Object.keys(snap?.byGame ?? {})).toEqual(["trivia", "snake", "blackjack"]);
    expect(gs.calls.filter((c) => c.startsWith("ingestor:8080"))).toHaveLength(2);
  });

  it("when GameStats is down: gamestatsUp false and the last good data stays", async () => {
    let now = Date.parse("2026-11-06T20:00:00Z");
    const gs = fakeGameStats();
    const hub = new StatsHub(gs.client, { now: () => now });
    const good = await hub.poll();
    gs.state.down = true;
    now += 2000;
    const bad = await hub.poll();
    expect(bad?.gamestatsUp).toBe(false);
    expect(bad?.generatedAt).toBe("2026-11-06T20:00:02.000Z");
    expect(bad?.lastOkAt).toBe(good?.generatedAt);
    expect(bad?.general).toEqual(good?.general);
    expect(bad?.byGame).toEqual(good?.byGame);
  });
});

describe("stats routes", () => {
  it("GET /api/stats/stream sends the snapshot to two clients with one series of queries", async () => {
    const gs = fakeGameStats();
    const app = buildApp(testConfig(), { gamestats: gs.client, statsIntervalMs: 200 });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    try {
      const firstEvent = async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/stats/stream`);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no body");
        let text = "";
        while (!text.includes("data: ")) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
        await reader.cancel();
        const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? "";
        return JSON.parse(line.slice(6)) as StatsSnapshot;
      };
      const [a, b] = await Promise.all([firstEvent(), firstEvent()]);
      expect(a.gamestatsUp).toBe(true);
      expect(b.general).toEqual(a.general);
      // Both connected at once: one round, not two.
      expect(gs.calls.length % ROUND).toBe(0);
      expect(gs.calls.length).toBeLessThanOrEqual(2 * ROUND);
    } finally {
      await app.close();
    }
  });

  it("GET /api/stats/match/:matchId forwards the detail, 404 and a bad id", async () => {
    const gs = fakeGameStats();
    gs.state.missing.add("/api/v1/matches/tv-none");
    const app = buildApp(testConfig(), { gamestats: gs.client });
    const ok = await app.inject({ url: "/api/stats/match/bj-1" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ path: "/api/v1/matches/bj-1" });
    expect((await app.inject({ url: "/api/stats/match/tv-none" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/stats/match/a.b" })).statusCode).toBe(400);
    gs.state.down = true;
    expect((await app.inject({ url: "/api/stats/match/bj-1" })).statusCode).toBe(503);
  });

  it("GET /api/stats answers the last snapshot once", async () => {
    const gs = fakeGameStats();
    const app = buildApp(testConfig(), { gamestats: gs.client });
    const res = await app.inject({ url: "/api/stats" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gamestatsUp: true });
  });
});
