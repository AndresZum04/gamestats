import { GAME_IDS, type GameId } from "@gameconsole/shared";
import { h } from "../console/dom.js";
import {
  GAME_NAMES,
  PATTERN_NAMES,
  ago,
  count,
  duration,
  label,
  number,
  pct,
  ratio,
  value,
} from "./format.js";
import { GameChart, chartData } from "./GameChart.js";
import { StatsStream } from "./StatsStream.js";
import type {
  GameStatsView,
  Leaderboard,
  MatchDetail,
  MatchSummary,
  PatternMatch,
  StatsSnapshot,
} from "./types.js";

type Cell = Node | string;

/** A table from rows already computed by GameStats. */
function table(headers: string[], rows: Cell[][], empty: string): HTMLElement {
  if (rows.length === 0) return h("p", { class: "muted" }, empty);
  return h(
    "table",
    { class: "scores" },
    h("thead", {}, h("tr", {}, ...headers.map((t) => h("th", {}, t)))),
    h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c))))),
  );
}

/** Pairs label → value of an object of GameStats, as a definition list. */
function facts(pairs: [string, string][]): HTMLElement {
  return h(
    "dl",
    { class: "facts" },
    ...pairs.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
  );
}

const card = (title: string, ...content: (Node | null)[]) =>
  h("article", { class: "card" }, h("h3", {}, title), ...content);

/**
 * The stats panel. It shows what GameStats computed, as the console server
 * forwards it every 2 s; it only formats. Two zones: the general one (every
 * game) and one per game in tabs, with a chart and the detail of a match.
 */
export class PanelPage {
  readonly #main: HTMLElement;
  readonly #stream: StatsStream;
  readonly #status = h("p", { class: "panel-status", role: "status" });
  readonly #general = h("section", { class: "zone", "aria-label": "General" });
  readonly #tabs = h("div", { class: "tabs", role: "tablist" });
  readonly #gameBody = h("div", { class: "game-body", role: "tabpanel" });
  readonly #chartTitle = h("h3", {});
  readonly #canvas = h("canvas", { "aria-label": "Gráfico del juego" });
  readonly #detail = h("div", { class: "detail" });
  #chart: GameChart | null = null;
  #game: GameId;
  #snapshot: StatsSnapshot | null = null;
  #connected = false;
  #unsubscribe: (() => void) | null = null;
  #clock: ReturnType<typeof setInterval> | null = null;

  constructor(main: HTMLElement, game: string | null) {
    this.#main = main;
    this.#game = (GAME_IDS as readonly string[]).includes(game ?? "") ? (game as GameId) : "trivia";
    this.#stream = new StatsStream();
  }

  mount(): void {
    this.#main.append(
      h("h1", {}, "Panel"),
      this.#status,
      h("h2", {}, "General"),
      this.#general,
      h("h2", {}, "Por juego"),
      h(
        "section",
        { class: "zone", "aria-label": "Por juego" },
        this.#tabs,
        this.#gameBody,
        h(
          "div",
          { class: "card chart" },
          this.#chartTitle,
          h("div", { class: "chart-box" }, this.#canvas),
        ),
        this.#detail,
      ),
    );
    this.#chart = new GameChart(this.#canvas);
    this.#renderTabs();
    this.#unsubscribe = this.#stream.subscribe((snapshot, connected) => {
      this.#snapshot = snapshot;
      this.#connected = connected;
      this.#render();
    });
    this.#clock = setInterval(() => this.#renderStatus(), 1000);
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#stream.close();
    if (this.#clock !== null) clearInterval(this.#clock);
    this.#chart?.destroy();
  }

  #render(): void {
    this.#renderStatus();
    const s = this.#snapshot;
    if (s === null) {
      this.#general.replaceChildren(h("p", { class: "muted" }, "Esperando datos de GameStats…"));
      return;
    }
    this.#renderGeneral(s);
    this.#renderGame(s.byGame[this.#game]);
  }

  // ---- Status -------------------------------------------------------------

  #renderStatus(): void {
    const s = this.#snapshot;
    const parts: Node[] = [document.createTextNode(`Última actualización ${ago(s?.lastOkAt)}`)];
    if (!this.#connected) {
      parts.push(h("span", { class: "warning" }, " · Sin conexión con el servidor de la consola"));
    } else if (s && !s.gamestatsUp) {
      parts.push(
        h("span", { class: "warning" }, " · GameStats no responde: se muestran los últimos datos"),
      );
    }
    this.#status.replaceChildren(...parts);
  }

  // ---- General zone -------------------------------------------------------

  #renderGeneral(s: StatsSnapshot): void {
    const { games, ingest, summary } = s.general;
    const instances = table(
      ["Juego", "En curso", "Terminadas", "Parciales", "Total iniciado", "Eventos"],
      (games ?? []).map((g) => [
        GAME_NAMES[g.gameId] ?? g.gameId,
        count(g.open),
        count(g.finished),
        count(g.partial),
        count(g.started),
        count(g.events),
      ]),
      "El ingestor todavía no vio partidas.",
    );
    const rejectedByCode = Object.entries(ingest?.rejectedByCode ?? {});
    const patterns = table(
      ["Patrón", "Detectados"],
      Object.entries(summary?.patternsByType ?? {}).map(([id, n]) => [
        `${id} ${PATTERN_NAMES[id] ?? ""}`,
        count(n),
      ]),
      "Sin patrones todavía.",
    );
    this.#general.replaceChildren(
      h(
        "div",
        { class: "cards" },
        card("Instancias por juego", instances),
        card(
          "Eventos",
          facts([
            ["Recibidos", count(ingest?.received)],
            ["Aceptados", count(ingest?.accepted)],
            ["Rechazados", count(ingest?.rejected)],
            ...rejectedByCode.map(([code, n]): [string, string] => [`  ${code}`, count(n)]),
          ]),
        ),
        card(
          "Análisis",
          facts([
            ["Partidas analizadas", count(summary?.matches)],
            ["Jugadores distintos", count(summary?.players)],
            ...GAME_IDS.map((g): [string, string] => [
              GAME_NAMES[g] ?? g,
              `${count(summary?.matchesByGame?.[g])} partidas · ${duration(summary?.avgDurationMsByGame?.[g])} en promedio`,
            ]),
          ]),
        ),
        card("Patrones detectados por tipo", patterns),
      ),
    );
  }

  // ---- Per game -----------------------------------------------------------

  #renderTabs(): void {
    this.#tabs.replaceChildren(
      ...GAME_IDS.map((g) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: g === this.#game ? "tab selected" : "tab",
            "aria-selected": g === this.#game ? "true" : "false",
            onclick: () => this.#select(g),
          },
          GAME_NAMES[g] ?? g,
        ),
      ),
    );
  }

  #select(game: GameId): void {
    this.#game = game;
    history.replaceState(null, "", `/panel?game=${game}`);
    this.#detail.replaceChildren();
    this.#renderTabs();
    this.#render();
  }

  #renderGame(view: GameStatsView | undefined): void {
    const summary = view?.summary;
    this.#gameBody.replaceChildren(
      h(
        "div",
        { class: "cards" },
        card(
          "Resumen",
          facts([
            ["Partidas analizadas", count(summary?.matches)],
            ["Parciales", count(summary?.partialMatches)],
            ["Duración promedio", duration(summary?.avgDurationMs)],
            ["Jugadores en partidas", count(summary?.playerEntries)],
            ["Abandonos", `${count(summary?.playersLeft)} (${ratio(summary?.abandonmentRate)})`],
            ...Object.entries(summary?.gameMetrics ?? {}).map(([k, v]): [string, string] => [
              label(k),
              k.endsWith("Pct") ? pct(v) : value(v),
            ]),
          ]),
        ),
        card("Leaderboard", this.#leaderboard(view?.leaderboard ?? null)),
      ),
      h(
        "div",
        { class: "cards" },
        card("Partidas en curso", this.#matches(view?.live ?? [], "No hay partidas en curso.")),
        card(
          "Últimas partidas terminadas",
          this.#matches(view?.recent ?? [], "Todavía no hay partidas terminadas."),
        ),
        card("Patrones recientes", this.#patterns(view?.patterns ?? [])),
      ),
    );
    const data = chartData(this.#game, view);
    this.#chartTitle.textContent = data.title;
    this.#chart?.update(data);
  }

  #leaderboard(board: Leaderboard | null): HTMLElement {
    const metric = board?.metric ? label(board.metric) : "métrica";
    return table(
      ["#", "Jugador", "Partidas", "Ganadas", "% ganadas", metric],
      (board?.entries ?? []).map((e) => [
        count(e.rank),
        e.playerId,
        count(e.matches),
        count(e.wins),
        pct(e.winPct),
        number(e.avgMetric),
      ]),
      "Sin jugadores todavía.",
    );
  }

  #matches(matches: MatchSummary[], empty: string): HTMLElement {
    return table(
      ["Partida", "Duración", "Jugadores", "Eventos", "Patrones"],
      matches.map((m) => [
        h(
          "button",
          { type: "button", class: "link", onclick: () => void this.#openMatch(m.matchId) },
          m.matchId,
        ),
        duration(m.durationMs),
        count(m.players),
        count(m.events),
        count(m.patterns),
      ]),
      empty,
    );
  }

  #patterns(patterns: PatternMatch[]): HTMLElement {
    return table(
      ["Patrón", "Jugador", "Descripción"],
      patterns.map((p) => [
        p.name ?? PATTERN_NAMES[p.patternId] ?? p.patternId,
        p.playerId ?? "—",
        p.description ?? "",
      ]),
      "Sin patrones todavía.",
    );
  }

  // ---- Detail of a match --------------------------------------------------

  async #openMatch(matchId: string): Promise<void> {
    this.#detail.replaceChildren(
      card(`Partida ${matchId}`, h("p", { class: "muted" }, "Cargando…")),
    );
    let detail: MatchDetail;
    try {
      const res = await fetch(`/api/stats/match/${encodeURIComponent(matchId)}`);
      if (!res.ok) throw new Error(String(res.status));
      detail = (await res.json()) as MatchDetail;
    } catch {
      this.#detail.replaceChildren(
        card(`Partida ${matchId}`, h("p", { class: "warning" }, "No se pudo leer el detalle.")),
      );
      return;
    }
    const close = h(
      "button",
      { type: "button", onclick: () => this.#detail.replaceChildren() },
      "Cerrar",
    );
    const state = detail.live
      ? "en curso (estadísticas parciales)"
      : detail.partial
        ? "parcial"
        : "terminada";
    const players = (detail.players ?? []).map((p) =>
      h(
        "div",
        { class: "player" },
        h("h4", {}, `${p.playerId} · posición ${p.placement ?? "—"}`),
        facts(
          Object.entries(p.metrics ?? {}).map(([k, v]): [string, string] => [
            label(k),
            k.endsWith("Pct") ? pct(v) : value(v),
          ]),
        ),
      ),
    );
    this.#detail.replaceChildren(
      card(
        `Partida ${detail.matchId}`,
        h(
          "p",
          { class: "muted" },
          `${GAME_NAMES[detail.gameId ?? ""] ?? ""} · ${state} · ${duration(detail.durationMs)}`,
        ),
        facts(
          Object.entries(detail.matchMetrics ?? {}).map(([k, v]): [string, string] => [
            label(k),
            k.endsWith("Pct") ? pct(v) : value(v),
          ]),
        ),
        h("div", { class: "players" }, ...players),
        this.#patterns(detail.patterns ?? []),
        close,
      ),
    );
  }
}
