import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { EventSink } from "../src/events/EventSink.js";
import { MatchWriteQueue } from "../src/events/MatchWriteQueue.js";
import { event, testConfig } from "./helpers.js";

const post = (app: ReturnType<typeof buildApp>, body: unknown) =>
  app.inject({ method: "POST", url: "/api/events", payload: body as object });

describe("POST /api/events", () => {
  it("10 matches sending batches in parallel give 10 files, in order and unmixed", async () => {
    const config = testConfig();
    const app = buildApp(config);
    const games = ["trivia", "snake", "blackjack"];
    const matches = Array.from({ length: 10 }, (_, i) => ({
      gameId: games[i % 3] ?? "trivia",
      matchId: `m-${i}`,
    }));

    // Like the browser: each match sends its batches one after the other
    // (one request in flight), and the 10 matches at the same time.
    await Promise.all(
      matches.map(async ({ gameId, matchId }) => {
        for (let b = 0; b < 10; b++) {
          const batch = Array.from({ length: 20 }, (_, i) =>
            event(gameId, matchId, b * 20 + i + 1),
          );
          const res = await post(app, batch);
          expect(res.statusCode).toBe(202);
          expect(res.json()).toEqual({ written: 20 });
        }
      }),
    );

    for (const { gameId, matchId } of matches) {
      const text = readFileSync(join(config.eventsDir, gameId, `${matchId}.jsonl`), "utf8");
      expect(text.endsWith("\n")).toBe(true);
      const lines = text
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l) as { matchId: string; seq: number });
      expect(lines.map((l) => l.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
      expect(new Set(lines.map((l) => l.matchId))).toEqual(new Set([matchId]));
    }
    const files = games.flatMap((g) => readdirSync(join(config.eventsDir, g)));
    expect(files).toHaveLength(10);
    await app.close();
  });

  it("splits a request with several matches into their files", async () => {
    const config = testConfig();
    const app = buildApp(config);
    const res = await post(app, [
      event("trivia", "tv-1", 1),
      event("snake", "sn-1", 1),
      event("trivia", "tv-1", 2),
    ]);
    expect(res.json()).toEqual({ written: 3 });
    const seqsOf = (path: string) =>
      readFileSync(join(config.eventsDir, path), "utf8")
        .trimEnd()
        .split("\n")
        .map((l) => (JSON.parse(l) as { seq: number }).seq);
    expect(seqsOf("trivia/tv-1.jsonl")).toEqual([1, 2]);
    expect(seqsOf("snake/sn-1.jsonl")).toEqual([1]);
    await app.close();
  });

  it("400 for a body it cannot turn into files", async () => {
    const config = testConfig();
    const app = buildApp(config);
    const bad: [unknown, RegExp][] = [
      [{ gameId: "trivia" }, /array/],
      [[], /empty/],
      [Array.from({ length: 501 }, (_, i) => event("trivia", "tv-1", i + 1)), /at most 500/],
      [[event("trivia", "../../etc", 1)], /matchId/],
      [[event("Trivia", "tv-1", 1)], /gameId/],
      [[{ matchId: "tv-1" }], /gameId/],
      [[event("trivia", "x-1", 1), event("snake", "x-1", 2)], /two gameIds/],
    ];
    for (const [body, message] of bad) {
      const res = await post(app, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(res.json().error).toMatch(message);
    }
    expect(readdirSync(join(config.eventsDir, "..")).includes("events")).toBe(false);
    await app.close();
  });

  it("503 when the sink fails, so the browser retries", async () => {
    const failing: EventSink = {
      kind: "file",
      write: () => Promise.reject(new Error("disk full")),
    };
    const app = buildApp(testConfig(), { sink: failing });
    const res = await post(app, [event("trivia", "tv-1", 1)]);
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe("MatchWriteQueue", () => {
  it("runs the writes of a match one at a time and different matches together", async () => {
    const queue = new MatchWriteQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const write = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, ms));
      running -= 1;
      log.push(`end ${name}`);
    };
    await Promise.all([
      queue.run("a", write("a1", 30)),
      queue.run("a", write("a2", 5)),
      queue.run("b", write("b1", 10)),
    ]);
    // a2 starts only after a1 ended, although it is shorter; b1 overlaps a1.
    expect(log.indexOf("start a2")).toBeGreaterThan(log.indexOf("end a1"));
    expect(log.indexOf("start b1")).toBeLessThan(log.indexOf("end a1"));
    expect(maxRunning).toBe(2);
    expect(queue.size).toBe(0);
  });

  it("a failed write does not block the next one of the match", async () => {
    const queue = new MatchWriteQueue();
    await expect(queue.run("a", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.run("a", async () => "ok")).resolves.toBe("ok");
  });
});
