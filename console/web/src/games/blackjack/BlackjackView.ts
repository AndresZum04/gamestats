import type { BlackjackAction, HandOutcome } from "@gameconsole/shared";
import { h } from "../../console/dom.js";
import type { GameView } from "../../console/GameRegistry.js";
import { MAX_CPUS, MIN_CPUS, type BlackjackGame } from "./BlackjackGame.js";
import type { Card } from "./Card.js";
import type { Hand } from "./Hand.js";
import type { Seat } from "./Seat.js";

const KEYS: Readonly<Record<string, BlackjackAction>> = { h: "HIT", s: "STAND", d: "DOUBLE" };
const RESULT: Readonly<Record<HandOutcome, string>> = {
  WIN: "Gana",
  LOSE: "Pierde",
  PUSH: "Empate",
};

const cardEl = (card: Card) => h("span", { class: card.red ? "card red" : "card" }, card.label);
const handValue = (hand: Hand) =>
  hand.size === 0 ? "" : `${hand.value}${hand.soft && hand.value < 21 ? " blando" : ""}`;

/**
 * Draws a blackjack table. The house's second card stays face down until its
 * turn, and every hand shows its value. Buttons (and keys H, S, D) only call
 * BlackjackGame.placeBet and act.
 */
export class BlackjackView implements GameView {
  readonly #game: BlackjackGame;
  #el: HTMLElement | null = null;
  #cpus = 2;
  #betDraft = 50;

  constructor(game: BlackjackGame) {
    this.#game = game;
  }

  mount(el: HTMLElement): void {
    this.#el = el;
    this.render();
  }

  dispose(): void {
    this.#el?.replaceChildren();
    this.#el = null;
  }

  handleKey(event: KeyboardEvent): boolean {
    const action = KEYS[event.key.toLowerCase()];
    return action !== undefined && this.#game.act(action);
  }

  render(): void {
    const el = this.#el;
    if (el === null) return;
    const game = this.#game;
    if (game.awaitingSetup && game.status === "READY") el.replaceChildren(this.#setup());
    else if (game.status === "FINISHED") el.replaceChildren(this.#final());
    else el.replaceChildren(this.#tableView());
  }

  #setup(): HTMLElement {
    const choices = [];
    for (let n = MIN_CPUS; n <= MAX_CPUS; n++) {
      choices.push(
        h(
          "label",
          {},
          h("input", {
            type: "radio",
            name: `cpus-${this.#game.matchId}`,
            value: n,
            checked: n === this.#cpus,
            onchange: () => (this.#cpus = n),
          }),
          ` ${n}`,
        ),
      );
    }
    return h(
      "div",
      { class: "blackjack setup" },
      h("p", {}, "1000 fichas, 10 rondas, apuestas de 10 a 200. El blackjack paga 3 a 2."),
      h("fieldset", {}, h("legend", {}, "Jugadores CPU en la mesa"), ...choices),
      h(
        "button",
        { type: "button", class: "primary", onclick: () => this.#game.startWith(this.#cpus) },
        "Sentarse a la mesa",
      ),
    );
  }

  #tableView(): HTMLElement {
    const game = this.#game;
    const table = game.table;
    if (table === null) return h("p", { class: "muted" }, "Preparando la mesa…");
    const dealer = table.dealer;
    const dealerCards = dealer.hand.cards.map((c, i) =>
      i === 1 && !dealer.revealed ? h("span", { class: "card back" }, "🂠") : cardEl(c),
    );
    const dealerValue = dealer.revealed
      ? handValue(dealer.hand)
      : dealer.upcard
        ? `${dealer.upcard.points} + ?`
        : "";

    return h(
      "div",
      { class: "blackjack" },
      h(
        "p",
        { class: "muted" },
        `Ronda ${game.round} de ${game.rounds} · Quedan ${table.shoe.remaining} cartas en el zapato`,
      ),
      h(
        "div",
        { class: "bj-dealer" },
        h("strong", {}, "Casa"),
        h("div", { class: "cards" }, ...dealerCards),
        h("span", { class: "value" }, dealerValue),
      ),
      h("div", { class: "bj-seats" }, ...table.seats.map((s) => this.#seat(s))),
      this.#controls(),
    );
  }

  #seat(seat: Seat): HTMLElement {
    const game = this.#game;
    const onTurn = game.turn === seat;
    let status = "";
    if (seat.out) status = "Sin fichas";
    else if (seat.lastResult) {
      const r = seat.lastResult;
      status = `${RESULT[r.result]} ${r.payout > 0 ? "+" : ""}${r.payout}`;
    } else if (seat.state === "BUST") status = "Se pasó";
    else if (seat.state === "BLACKJACK") status = "¡Blackjack!";
    else if (onTurn && !seat.strategy.human) status = "Pensando…";
    return h(
      "div",
      { class: `bj-seat${onTurn ? " on-turn" : ""}${seat.out ? " out" : ""}` },
      h("strong", {}, seat.player.name),
      h(
        "span",
        { class: "muted" },
        ` ${seat.chips} fichas${seat.bet > 0 ? ` · apuesta ${seat.bet}` : ""}${seat.doubled ? " (doblada)" : ""}`,
      ),
      h("div", { class: "cards" }, ...seat.hand.cards.map(cardEl)),
      h("span", { class: "value" }, handValue(seat.hand)),
      status ? h("span", { class: "bj-status" }, status) : null,
    );
  }

  #controls(): HTMLElement | null {
    const game = this.#game;
    const seat = game.turn;
    const waiting = game.waitingFor;
    if (seat === null || waiting === null) return null;
    if (waiting === "BET") {
      const { minBet, maxBet } = game.limits;
      const top = Math.min(maxBet, Math.floor(seat.chips / minBet) * minBet);
      this.#betDraft = Math.min(Math.max(this.#betDraft, minBet), top);
      const input = h("input", {
        type: "number",
        min: minBet,
        max: top,
        step: minBet,
        value: this.#betDraft,
        "aria-label": "Apuesta",
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === "Enter") submit();
        },
      });
      const submit = () => {
        const amount = Number(input.value);
        if (!Number.isFinite(amount)) return;
        this.#betDraft = amount;
        game.placeBet(amount);
      };
      return h(
        "div",
        { class: "actions bj-controls" },
        h("label", {}, `Tu apuesta (${minBet} a ${top}) `, input),
        h("button", { type: "button", class: "primary", onclick: submit }, "Apostar"),
      );
    }
    const act = (action: BlackjackAction) => () => game.act(action);
    return h(
      "div",
      { class: "actions bj-controls" },
      h("button", { type: "button", class: "primary", onclick: act("HIT") }, "Pedir (H)"),
      h("button", { type: "button", onclick: act("STAND") }, "Plantarse (S)"),
      h(
        "button",
        { type: "button", disabled: !seat.canDouble, onclick: act("DOUBLE") },
        "Doblar (D)",
      ),
    );
  }

  #final(): HTMLElement {
    const game = this.#game;
    if (game.table === null) return h("p", { class: "muted" }, "Partida cerrada sin jugar.");
    const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
    return h(
      "div",
      { class: "blackjack final" },
      h("p", { class: "question" }, "Partida terminada"),
      h(
        "table",
        { class: "scores" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", {}, "Posición"), h("th", {}, "Jugador"), h("th", {}, "Fichas")),
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
                h("td", { class: "num" }, String(s.chips)),
              ),
            ),
        ),
      ),
    );
  }
}
