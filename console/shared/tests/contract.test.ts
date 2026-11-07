// Checks the console's event model against the real GameStats files of this
// repo, so a change in GameStats breaks the console's CI instead of the demo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVENT_SPECS,
  GAME_IDS,
  GAME_VERSION,
  MATCH_MODE,
  MATCH_PREFIX,
  SCHEMA_VERSION,
  type GameId,
} from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(repo + path, "utf8"));

interface ConfigType {
  playerRequired: boolean;
  data: Record<string, string>;
}
interface GameConfig {
  gameId: string;
  versions: string[];
  events: Record<string, ConfigType>;
}

const common = (readJson("configs/games/_common.json") as { events: Record<string, ConfigType> })
  .events;
const config = (game: GameId): GameConfig => readJson(`configs/games/${game}.json`) as GameConfig;

interface Example {
  schemaVersion: string;
  gameId: string;
  matchId: string;
  playerId?: string | null;
  type: string;
  data: Record<string, unknown>;
}
const examples: Example[] = readFileSync(repo + "data/samples/examples.jsonl", "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Example);

const specsOf = (game: GameId) =>
  Object.entries(EVENT_SPECS[game]) as [string, { playerRequired: boolean; required: string[] }][];

describe.each(GAME_IDS)("%s", (game) => {
  const cfg = config(game);
  const types = { ...common, ...cfg.events };

  it("is registered in GameStats with the console's game version", () => {
    expect(cfg.gameId).toBe(game);
    expect(cfg.versions).toContain(GAME_VERSION);
  });

  it.each(specsOf(game))("%s exists with the same playerRequired", (type, spec) => {
    expect(types[type], `${type} is not in configs/games`).toBeDefined();
    expect(spec.playerRequired).toBe(types[type]?.playerRequired);
  });

  it.each(specsOf(game))("%s requires every key GameStats requires", (type, spec) => {
    for (const key of Object.keys(types[type]?.data ?? {})) {
      expect(spec.required, `${type}.data.${key}`).toContain(key);
    }
  });

  it.each(specsOf(game))("%s has a real line in examples.jsonl with its keys", (type, spec) => {
    // A line of the same game first. A general event (PLAYER_LEFT...) may come from
    // another game; MATCH_STARTED is general too, but each game adds its own keys.
    const own = type in cfg.events;
    const line =
      examples.find((e) => e.type === type && e.gameId === game) ??
      (own ? undefined : examples.find((e) => e.type === type));
    expect(line, `no ${type} in examples.jsonl`).toBeDefined();
    for (const key of spec.required) {
      expect(Object.keys(line?.data ?? {}), `${type}.data.${key}`).toContain(key);
    }
    if (spec.playerRequired) expect(typeof line?.playerId).toBe("string");
  });

  it("uses the mode, matchId prefix and schemaVersion of the examples", () => {
    const lines = examples.filter((e) => e.gameId === game);
    expect(lines.length).toBeGreaterThan(0);
    for (const e of lines) {
      expect(e.schemaVersion).toBe(SCHEMA_VERSION);
      expect(e.matchId.startsWith(`${MATCH_PREFIX[game]}-`), e.matchId).toBe(true);
    }
    const started = lines.find((e) => e.type === "MATCH_STARTED");
    expect(started?.data["mode"]).toBe(MATCH_MODE[game]);
  });
});
