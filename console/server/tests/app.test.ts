import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

describe("app", () => {
  it("answers /health with the sink in use", async () => {
    const app = buildApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "gameconsole-web", sink: "file" });
    const http = buildApp(testConfig({ eventSink: "http" }));
    expect((await http.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      sink: "http",
    });
    await Promise.all([app.close(), http.close()]);
  });

  it("serves the built console when web/dist exists", async () => {
    const config = testConfig();
    const dist = join(config.eventsDir, "..", "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<title>GameConsole</title>");
    const app = buildApp({ ...config, webDist: dist });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("GameConsole");
    await app.close();
  });
});
