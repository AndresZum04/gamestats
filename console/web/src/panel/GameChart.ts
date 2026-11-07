import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { GameId } from "@gameconsole/shared";
import { label } from "./format.js";
import type { GameStatsView } from "./types.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface ChartData {
  title: string;
  labels: string[];
  values: number[];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * What the chart of each game shows, taken as it comes from GameStats:
 * Trivia, % of right answers per category (T5); Snake, the leaderboard's
 * maxLength per player (S1); Blackjack, the leaderboard's netGain per player
 * (B2). Pairs without a number are left out.
 */
export function chartData(gameId: GameId, view: GameStatsView | undefined): ChartData {
  if (gameId === "trivia") {
    const byCategory = view?.summary?.gameMetrics?.correctPctByCategory;
    const pairs = Object.entries(
      typeof byCategory === "object" && byCategory !== null ? byCategory : {},
    ).filter((p): p is [string, number] => isNumber(p[1]));
    return {
      title: "% de aciertos por categoría",
      labels: pairs.map(([k]) => k),
      values: pairs.map(([, v]) => v),
    };
  }
  const board = view?.leaderboard;
  const entries = (board?.entries ?? []).filter((e): e is typeof e & { avgMetric: number } =>
    isNumber(e.avgMetric),
  );
  const metric = board?.metric ?? "";
  return {
    title: `${label(metric)} por jugador (promedio de GameStats)`,
    labels: entries.map((e) => e.playerId),
    values: entries.map((e) => e.avgMetric),
  };
}

/** A bar chart that keeps its canvas and only changes its data on each snapshot. */
export class GameChart {
  readonly #chart: Chart<"bar">;

  constructor(canvas: HTMLCanvasElement) {
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    this.#chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{ data: [], backgroundColor: color("--accent", "#2f6fed"), borderRadius: 4 }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: color("--muted", "#5d6677") }, grid: { display: false } },
          y: {
            ticks: { color: color("--muted", "#5d6677") },
            grid: { color: color("--border", "#d9dde5") },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  update(data: ChartData): void {
    this.#chart.data.labels = data.labels;
    const dataset = this.#chart.data.datasets[0];
    if (dataset) dataset.data = data.values;
    this.#chart.update("none");
  }

  destroy(): void {
    this.#chart.destroy();
  }
}
