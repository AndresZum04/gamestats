import type { AnswerOption, Difficulty, TriviaCategory } from "@gameconsole/shared";
import { h } from "../../console/dom.js";
import type { GameView } from "../../console/GameRegistry.js";
import { OPTIONS } from "./Question.js";
import { MAX_SEATS, TriviaGame, type SeatChoice } from "./TriviaGame.js";

const CATEGORY: Readonly<Record<TriviaCategory, string>> = {
  CIENCIA: "Ciencia",
  HISTORIA: "Historia",
  DEPORTES: "Deportes",
  GEOGRAFIA: "Geografía",
  ENTRETENIMIENTO: "Entretenimiento",
};
const DIFFICULTY: Readonly<Record<Difficulty, string>> = {
  EASY: "fácil",
  MEDIUM: "media",
  HARD: "difícil",
};
const KEYS: Readonly<Record<string, AnswerOption>> = {
  a: "A",
  b: "B",
  c: "C",
  d: "D",
  "1": "A",
  "2": "B",
  "3": "C",
  "4": "D",
};

/**
 * Draws a trivia match. It only reads the game and calls its methods (seats,
 * answer); the flow, the timers and the events are in TriviaGame. Keys A-D or
 * 1-4 answer when this instance has the focus.
 */
export class TriviaView implements GameView {
  readonly #game: TriviaGame;
  #el: HTMLElement | null = null;
  #timer: HTMLElement | null = null;
  #tick: ReturnType<typeof setInterval> | null = null;
  /** The start screen's seats after the host's; two CPU by default. */
  #seats: SeatChoice[] = [{ kind: "cpu" }, { kind: "cpu" }];
  #setupError = "";

  constructor(game: TriviaGame) {
    this.#game = game;
  }

  mount(el: HTMLElement): void {
    this.#el = el;
    this.#tick = setInterval(() => this.#updateTimer(), 250);
    this.render();
  }

  dispose(): void {
    if (this.#tick !== null) clearInterval(this.#tick);
    this.#el?.replaceChildren();
    this.#el = null;
  }

  handleKey(event: KeyboardEvent): boolean {
    const option = KEYS[event.key.toLowerCase()];
    return option !== undefined && this.#game.answer(option);
  }

  render(): void {
    const el = this.#el;
    if (el === null) return;
    const game = this.#game;
    this.#timer = null;
    if (game.awaitingSetup && game.status === "READY") {
      el.replaceChildren(this.#setup());
    } else if (game.status === "FINISHED") {
      el.replaceChildren(this.#final());
    } else {
      el.replaceChildren(this.#question());
    }
  }

  // ---- Start screen -------------------------------------------------------

  #setup(): HTMLElement {
    const game = this.#game;
    const rows = this.#seats.map((seat, i) =>
      h(
        "li",
        {},
        seat.kind === "cpu"
          ? h(
              "span",
              {},
              `CPU ${this.#seats.slice(0, i + 1).filter((s) => s.kind === "cpu").length}`,
            )
          : h("input", {
              value: seat.name,
              placeholder: "Nombre",
              maxlength: 24,
              "aria-label": `Nombre del jugador ${i + 2}`,
              oninput: (e: Event) => {
                seat.name = (e.target as HTMLInputElement).value;
              },
            }),
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              this.#seats.splice(i, 1);
              this.render();
            },
          },
          "Quitar",
        ),
      ),
    );
    const full = this.#seats.length + 1 >= MAX_SEATS;
    const add = (seat: SeatChoice) => () => {
      this.#seats.push(seat);
      this.render();
    };
    return h(
      "div",
      { class: "trivia setup" },
      h("p", {}, "Por turnos en la misma pantalla, de 2 a 6 jugadores. 15 s por respuesta."),
      h("ol", { class: "seats" }, h("li", {}, h("strong", {}, game.host.name), " (vos)"), ...rows),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", disabled: full, onclick: add({ kind: "person", name: "" }) },
          "Agregar persona",
        ),
        h(
          "button",
          { type: "button", disabled: full, onclick: add({ kind: "cpu" }) },
          "Agregar CPU",
        ),
        h("button", { type: "button", class: "primary", onclick: () => this.#start() }, "Empezar"),
      ),
      this.#setupError ? h("p", { class: "error", role: "alert" }, this.#setupError) : null,
    );
  }

  #start(): void {
    const problem = TriviaGame.checkSeats(this.#game.host, this.#seats);
    if (problem !== null) {
      this.#setupError = problem;
      this.render();
      return;
    }
    this.#game.startWith(this.#seats);
  }

  // ---- A question ---------------------------------------------------------

  #question(): HTMLElement {
    const game = this.#game;
    const round = game.round;
    if (round === null) return h("p", { class: "muted" }, "Preparando la partida…");
    const q = round.question;
    const reveal = game.phase === "REVEAL";
    const current = game.currentPlayer;

    const options = OPTIONS.map((o) => {
      const cls = reveal ? (o === q.answer ? "option correct" : "option") : "option";
      return h(
        "button",
        {
          type: "button",
          class: cls,
          disabled: !game.waitingForPerson,
          onclick: () => game.answer(o),
        },
        h("span", { class: "key" }, o),
        q.options[o],
      );
    });

    let status: HTMLElement;
    if (reveal) {
      status = h("p", {}, `Respuesta correcta: ${q.answer}. ${q.options[q.answer]}`);
    } else if (current === undefined) {
      status = h("p", {}, "");
    } else {
      this.#timer = h("span", { class: "timer" });
      status = h(
        "p",
        { class: "turn" },
        game.waitingForPerson
          ? `Turno de ${current.name}: elegí una opción (A-D o 1-4). `
          : `${current.name} está pensando… `,
        this.#timer,
      );
    }

    return h(
      "div",
      { class: "trivia" },
      h(
        "p",
        { class: "muted" },
        `Pregunta ${round.number} de ${game.totalQuestions} · ${CATEGORY[q.category]} · ${DIFFICULTY[q.difficulty]}`,
      ),
      h("p", { class: "question" }, q.text),
      h("div", { class: "options" }, ...options),
      status,
      this.#players(reveal),
    );
  }

  /** Each player's score and what they did with this question. */
  #players(reveal: boolean): HTMLElement {
    const game = this.#game;
    const round = game.round;
    const rows = game.players.map((p) => {
      const outcome = round?.outcome(p.id);
      let note = "";
      if (outcome !== undefined) {
        if (!reveal) note = outcome.option === undefined ? "sin tiempo" : "respondió";
        else if (outcome.option === undefined) note = "sin tiempo";
        else note = `${outcome.option} ${outcome.correct ? `✓ +${outcome.points}` : "✗"}`;
      } else if (round?.current === p.id) {
        note = "en turno";
      }
      return h(
        "tr",
        { class: round?.current === p.id ? "on-turn" : "" },
        h("td", {}, p.name),
        h(
          "td",
          { class: "num" },
          String(game.standings().find((s) => s.playerId === p.id)?.total ?? 0),
        ),
        h("td", { class: "muted" }, note),
      );
    });
    return h(
      "table",
      { class: "scores" },
      h("thead", {}, h("tr", {}, h("th", {}, "Jugador"), h("th", {}, "Puntos"), h("th", {}, ""))),
      h("tbody", {}, ...rows),
    );
  }

  #updateTimer(): void {
    if (this.#timer === null) return;
    this.#timer.textContent = `${Math.ceil(this.#game.timeLeftMs / 1000)} s`;
  }

  // ---- The end ------------------------------------------------------------

  #final(): HTMLElement {
    const game = this.#game;
    if (game.round === null) return h("p", { class: "muted" }, "Partida cerrada sin jugar.");
    const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
    return h(
      "div",
      { class: "trivia final" },
      h("p", { class: "question" }, "Partida terminada"),
      h(
        "table",
        { class: "scores" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", {}, "Posición"), h("th", {}, "Jugador"), h("th", {}, "Puntos")),
        ),
        h(
          "tbody",
          {},
          ...game
            .standings()
            .map((s) =>
              h(
                "tr",
                {},
                h("td", {}, `${s.placement}.º`),
                h("td", {}, name(s.playerId)),
                h("td", { class: "num" }, String(s.total)),
              ),
            ),
        ),
      ),
    );
  }
}
