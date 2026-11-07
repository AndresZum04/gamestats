import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { GameStatsError, type GameStatsClient } from "./GameStatsClient.js";
import type { StatsHub } from "./StatsHub.js";

/** Same rule as GameStats (schemas/event.schema.json). */
const MATCH_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * GET /api/stats/stream: Server-Sent Events, one `data:` line with the whole
 * snapshot every 2 s. GET /api/stats: a current snapshot, once (tests, scripts).
 * GET /api/stats/match/:matchId: the detail of one match from the analyzer.
 */
export function registerStats(app: FastifyInstance, hub: StatsHub, client: GameStatsClient): void {
  const streams = new Set<ServerResponse>();

  app.get("/api/stats/stream", (req, reply) => {
    reply.hijack(); // the answer never ends: Fastify does not send it, we write it
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n"); // the browser reconnects after 3 s if the stream drops
    streams.add(res);
    const unsubscribe = hub.subscribe((snapshot) => {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    });
    req.raw.on("close", () => {
      unsubscribe();
      streams.delete(res);
    });
  });

  // With panels connected the last snapshot is at most 2 s old; without them, ask now.
  app.get("/api/stats", async () =>
    hub.listeners > 0 && hub.latest ? hub.latest : await hub.poll(),
  );

  app.get<{ Params: { matchId: string } }>("/api/stats/match/:matchId", async (req, reply) => {
    const { matchId } = req.params;
    if (!MATCH_ID.test(matchId)) return reply.code(400).send({ error: "bad matchId" });
    try {
      return await client.match(matchId);
    } catch (err) {
      if (err instanceof GameStatsError && err.status === 404) {
        return reply.code(404).send({ error: `match ${matchId} not found` });
      }
      return reply.code(503).send({ error: "gamestats unavailable" });
    }
  });

  // Open streams would keep app.close() waiting forever.
  app.addHook("onClose", (_app, done) => {
    hub.stop();
    for (const res of streams) res.end();
    streams.clear();
    done();
  });
}
