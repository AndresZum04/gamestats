import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ago, count, duration, pct, ratio, value } from "../../src/panel/format.js";
import { chartData } from "../../src/panel/GameChart.js";
import type { GameStatsView } from "../../src/panel/types.js";

const panelDir = fileURLToPath(new URL("../../src/panel/", import.meta.url));

describe("web/src/panel only formats", () => {
  it("no file adds up, averages or reduces data", () => {
    const files = readdirSync(panelDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const code = readFileSync(panelDir + file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\.reduce\s*\(/);
      expect(code, file).not.toMatch(/\+=/);
      expect(code, file).not.toMatch(/\b(sum|total|average|mean)\s*\(/i);
      expect(code, file).not.toMatch(/\.sort\s*\(/);
    }
  });
});

const view = (over: Partial<GameStatsView>): GameStatsView => ({
  summary: null,
  leaderboard: null,
  patterns: null,
  recent: null,
  live: null,
  ...over,
});

describe("chartData", () => {
  it("trivia: % of right answers per category, as GameStats gives it", () => {
    const data = chartData(
      "trivia",
      view({
        summary: { gameMetrics: { correctPctByCategory: { CIENCIA: 46.4, DEPORTES: 51.6 } } },
      }),
    );
    expect(data).toEqual({
      title: "% de aciertos por categoría",
      labels: ["CIENCIA", "DEPORTES"],
      values: [46.4, 51.6],
    });
  });

  it("snake and blackjack: the leaderboard's metric per player, in its order", () => {
    const data = chartData(
      "blackjack",
      view({
        leaderboard: {
          metric: "netGain",
          entries: [
            { rank: 1, playerId: "cpu-2", avgMetric: 150 },
            { rank: 2, playerId: "p-mari", avgMetric: null },
            { rank: 3, playerId: "cpu-1", avgMetric: -20 },
          ],
        },
      }),
    );
    expect(data.labels).toEqual(["cpu-2", "cpu-1"]);
    expect(data.values).toEqual([150, -20]);
    expect(data.title).toMatch(/ganancia neta/);
    expect(chartData("snake", undefined)).toMatchObject({ labels: [], values: [] });
  });
});

describe("format", () => {
  it("writes the numbers of GameStats", () => {
    expect(count(1234)).toMatch(/1.234/);
    expect(count(undefined)).toBe("—");
    expect(pct(62.5)).toBe("62,5 %");
    expect(ratio(0.163)).toMatch(/16,3/);
    expect(duration(8300)).toBe("8,3 s");
    expect(duration(125_000)).toBe("2 min 05 s");
    expect(value({ category: "HISTORIA", correctPct: 40 })).toBe(
      "categoría: HISTORIA · % de aciertos: 40",
    );
    expect(value(true)).toBe("sí");
  });

  it("says how long ago the last update was", () => {
    const now = Date.parse("2026-11-06T20:00:10Z");
    expect(ago("2026-11-06T20:00:07Z", now)).toBe("hace 3 s");
    expect(ago("2026-11-06T19:58:10Z", now)).toBe("hace 2 min");
    expect(ago(null, now)).toBe("nunca");
  });
});
