import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type SinkKind = "file" | "http";

export interface Config {
  port: number;
  /** file: lines in EVENTS_DIR (default). http: POST to the ingestor. */
  eventSink: SinkKind;
  /** The events/ folder that GameStats' ingestor watches. */
  eventsDir: string;
  ingestorUrl: string;
  analyzerUrl: string;
  prologUrl: string;
  /** Built web console (web/dist); not served if the folder does not exist. */
  webDist: string;
}

/** console/server, whether the code runs from src (tsx) or from dist. */
const serverDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Relative folders are resolved from console/server, not from the current
 * directory, so `npm run dev` and `node dist/index.js` write to the same place:
 * by default the repository's gamestats-data/events, which docker compose
 * mounts into the ingestor as /data/events.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = (key: string, fallback: string): string => {
    const v = env[key]?.trim();
    return v === undefined || v === "" ? fallback : v;
  };

  const port = Number(value("PORT", "3000"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${env["PORT"]}`);
  }
  const sink = value("EVENT_SINK", "file");
  if (sink !== "file" && sink !== "http") {
    throw new Error(`EVENT_SINK must be file or http, got ${sink}`);
  }
  const url = (key: string, fallback: string): string => {
    const v = value(key, fallback);
    try {
      return new URL(v).toString().replace(/\/$/, "");
    } catch {
      throw new Error(`${key} must be a URL, got ${v}`);
    }
  };

  return {
    port,
    eventSink: sink,
    eventsDir: resolve(serverDir, value("EVENTS_DIR", "../../gamestats-data/events")),
    ingestorUrl: url("GAMESTATS_INGESTOR_URL", "http://localhost:8080"),
    analyzerUrl: url("GAMESTATS_ANALYZER_URL", "http://localhost:8081"),
    prologUrl: url("PROLOG_URL", "http://localhost:4000"),
    webDist: resolve(serverDir, value("WEB_DIST", "../web/dist")),
  };
}
