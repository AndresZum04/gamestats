import Fastify, { type FastifyInstance } from "fastify";
import { CONSOLE_ID } from "@gameconsole/shared";

/** Builds the server without listening, so tests can call it with inject(). */
export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", async () => ({ status: "ok", service: CONSOLE_ID }));

  return app;
}
