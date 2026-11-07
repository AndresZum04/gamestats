import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { CONSOLE_ID } from "@gameconsole/shared";
import type { Config } from "./config.js";
import type { EventSink } from "./events/EventSink.js";
import { registerEvents } from "./events/EventsController.js";
import { FileSink } from "./events/FileSink.js";
import { HttpSink } from "./events/HttpSink.js";

export interface AppOptions {
  /** JSON logs with pino (Fastify's logger); off in tests. */
  logger?: boolean;
  /** Replaces the sink chosen by EVENT_SINK (tests). */
  sink?: EventSink;
}

/** Builds the server without listening, so tests can call it with inject(). */
export function buildApp(config: Config, options: AppOptions = {}): FastifyInstance {
  // A batch of 500 events is about 200 KB; leave room.
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 5 * 1024 * 1024 });

  const sink =
    options.sink ??
    (config.eventSink === "http"
      ? new HttpSink(config.ingestorUrl, { log: app.log })
      : new FileSink(config.eventsDir));

  app.get("/health", async () => ({ status: "ok", service: CONSOLE_ID, sink: sink.kind }));
  registerEvents(app, sink);

  // In production the server also serves the built console; in development Vite does.
  if (existsSync(config.webDist)) {
    void app.register(fastifyStatic, { root: config.webDist });
    // /play/trivia, /panel...: the page is the same index.html; the browser's router decides.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: `${req.method} ${req.url} not found` });
    });
  }

  return app;
}
