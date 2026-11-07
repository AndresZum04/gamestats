import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.js";

/** A config whose folders are fresh temp folders. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), "console-"));
  return {
    ...loadConfig({}),
    eventsDir: join(dir, "events"),
    webDist: join(dir, "no-web"),
    ...overrides,
  };
}

/** An event with the fields the server looks at, plus seq to check the order. */
export const event = (gameId: string, matchId: string, seq: number) => ({
  schemaVersion: "1.0",
  gameId,
  matchId,
  seq,
  type: "SCORE_CHANGED",
  data: { delta: 1, total: seq },
});
