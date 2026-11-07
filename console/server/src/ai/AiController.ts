import type { FastifyInstance, FastifyReply } from "fastify";
import { PrologUnavailable, type PrologClient, type PrologReply } from "./PrologClient.js";

/**
 * POST /api/ai/blackjack/decision and /api/ai/blackjack/bet: the browser asks
 * here and the server forwards to Prolog, so the page only talks to its own
 * origin. The body goes as it came (Prolog validates it) and the answer comes
 * back as it is: 200, or 400 if the query is wrong. 503 means Prolog did not
 * answer; the browser then uses its fallback move.
 */
export function registerAi(app: FastifyInstance, prolog: PrologClient): void {
  const forward = async (
    body: unknown,
    reply: FastifyReply,
    call: (query: unknown) => Promise<PrologReply>,
  ) => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: "the body must be a JSON object" });
    }
    try {
      const result = await call(body);
      return reply.code(result.status).send(result.body);
    } catch (err) {
      if (!(err instanceof PrologUnavailable)) throw err;
      app.log.warn({ err: err.message }, "prolog unavailable");
      return reply.code(503).send({ error: "prolog unavailable" });
    }
  };

  app.post("/api/ai/blackjack/decision", (req, reply) =>
    forward(req.body, reply, (q) => prolog.decision(q)),
  );
  app.post("/api/ai/blackjack/bet", (req, reply) => forward(req.body, reply, (q) => prolog.bet(q)));
}
