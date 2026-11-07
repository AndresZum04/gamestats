import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("has the plan's defaults, with folders taken from console/server", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3000,
      eventSink: "file",
      ingestorUrl: "http://localhost:8080",
      analyzerUrl: "http://localhost:8081",
      prologUrl: "http://localhost:4000",
    });
    // console/server/../../gamestats-data/events = the repository's gamestats-data
    expect(c.eventsDir.endsWith(join("gamestats-data", "events"))).toBe(true);
    expect(c.eventsDir).not.toContain(join("console", "gamestats-data"));
    expect(c.webDist.endsWith(join("console", "web", "dist"))).toBe(true);
  });

  it("reads overrides and rejects bad values", () => {
    const c = loadConfig({
      PORT: "4100",
      EVENT_SINK: "http",
      EVENTS_DIR: "/data/events",
      GAMESTATS_INGESTOR_URL: "http://ingestor:8080/",
    });
    expect(c.port).toBe(4100);
    expect(c.eventSink).toBe("http");
    expect(c.eventsDir).toBe(resolve("/data/events"));
    expect(c.ingestorUrl).toBe("http://ingestor:8080");

    expect(() => loadConfig({ EVENT_SINK: "kafka" })).toThrow(/EVENT_SINK/);
    expect(() => loadConfig({ PORT: "0" })).toThrow(/PORT/);
    expect(() => loadConfig({ PROLOG_URL: "not a url" })).toThrow(/PROLOG_URL/);
  });
});
