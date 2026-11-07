import type { FastifyInstance } from "fastify";
import type { EventSink } from "./EventSink.js";
import { MatchWriteQueue } from "./MatchWriteQueue.js";

export const MAX_EVENTS_PER_REQUEST = 500;

// The same rules as GameStats' schema: both become a folder and a file name.
const GAME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MATCH_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface Group {
  gameId: string;
  matchId: string;
  events: unknown[];
}

/**
 * Splits a request body into the events of each match, keeping their order.
 * It checks only what is needed to choose the file; GameStats validates the
 * rest. Returns an error message for a body it cannot use.
 */
export function groupByMatch(body: unknown): Group[] | string {
  if (!Array.isArray(body)) return "the body must be an array of events";
  if (body.length === 0) return "the array is empty";
  if (body.length > MAX_EVENTS_PER_REQUEST) {
    return `at most ${MAX_EVENTS_PER_REQUEST} events per request`;
  }
  const groups = new Map<string, Group>();
  for (const [i, event] of body.entries()) {
    const { gameId, matchId } = (event ?? {}) as { gameId?: unknown; matchId?: unknown };
    if (typeof gameId !== "string" || !GAME_ID.test(gameId)) return `event ${i}: invalid gameId`;
    if (typeof matchId !== "string" || !MATCH_ID.test(matchId))
      return `event ${i}: invalid matchId`;
    const group = groups.get(matchId);
    if (group === undefined) groups.set(matchId, { gameId, matchId, events: [event] });
    else if (group.gameId !== gameId) return `event ${i}: match ${matchId} has two gameIds`;
    else group.events.push(event);
  }
  return [...groups.values()];
}

/**
 * POST /api/events: one or more matches per request. Each match is written
 * through the MatchWriteQueue, so two requests of the same match never mix
 * their lines. 202 {"written": n} once every line is written; 503 if the sink
 * failed, so the browser retries the whole batch.
 */
export function registerEvents(app: FastifyInstance, sink: EventSink): MatchWriteQueue {
  const queue = new MatchWriteQueue();

  app.post("/api/events", async (req, reply) => {
    const groups = groupByMatch(req.body);
    if (typeof groups === "string") return reply.code(400).send({ error: groups });

    const results = await Promise.allSettled(
      groups.map((g) => queue.run(g.matchId, () => sink.write(g.gameId, g.matchId, g.events))),
    );
    const failed = results.flatMap((r, i) =>
      r.status === "rejected" ? [{ r, g: groups[i] }] : [],
    );
    if (failed.length > 0) {
      for (const { r, g } of failed) {
        req.log.error(
          { matchId: g?.matchId, err: (r as PromiseRejectedResult).reason },
          "write failed",
        );
      }
      return reply.code(503).send({ error: `could not write to ${sink.kind} sink, retry` });
    }
    const written = groups.reduce((n, g) => n + g.events.length, 0);
    req.log.info({ matches: groups.length, written, sink: sink.kind }, "events written");
    return reply.code(202).send({ written });
  });

  return queue;
}
