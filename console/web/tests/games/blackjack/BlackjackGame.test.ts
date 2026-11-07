import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ID, EVENT_SPECS, type AnyGameEvent } from "@gameconsole/shared";
import { HumanPlayer } from "../../../src/core/Player.js";
import { Rng } from "../../../src/core/Rng.js";
import {
  BlackjackGame,
  type BlackjackOptions,
} from "../../../src/games/blackjack/BlackjackGame.js";
import type { DecisionStrategy } from "../../../src/games/blackjack/DecisionStrategy.js";
import { FakeOutlet, types } from "../../core/testGame.js";

const schemaPath = fileURLToPath(
  new URL("../../../../../schemas/event.schema.json", import.meta.url),
);
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(schemaPath, "utf8")) as object,
);

function expectValid(events: readonly AnyGameEvent[]) {
  events.forEach((e, i) => {
    expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    expect(e.seq).toBe(i + 1);
    const spec = EVENT_SPECS.blackjack[e.type as keyof typeof EVENT_SPECS.blackjack];
    expect(spec, e.type).toBeDefined();
    for (const key of spec.required) expect(e.data).toHaveProperty(key);
    if (spec.playerRequired) expect(e.playerId).not.toBeNull();
  });
}

function blackjack(options: BlackjackOptions = {}, seed = 8) {
  const outlet = new FakeOutlet();
  const game = new BlackjackGame(
    HumanPlayer.named("Mari"),
    {
      outlet: () => outlet,
      source: { consoleId: CONSOLE_ID, sessionId: "tab-1" },
      clock: { now: () => Date.now() },
      rng: new Rng(seed),
    },
    options,
  );
  return { game, outlet };
}

type Data = Record<string, unknown>;
const d = (e: AnyGameEvent | undefined) => (e?.data ?? {}) as Data;
const ofRound = (events: readonly AnyGameEvent[], round: number) => {
  const start = events.findIndex((e) => e.type === "ROUND_STARTED" && d(e).round === round);
  const end = events.findIndex(
    (e, i) => i > start && (e.type === "ROUND_STARTED" || e.type === "MATCH_FINISHED"),
  );
  return events.slice(start, end);
};

/** Plays the person's seat by buttons: bets 100, hits under 17. */
async function playAsPerson(game: BlackjackGame) {
  for (let i = 0; i < 10_000 && game.status !== "FINISHED"; i++) {
    if (game.waitingFor === "BET") game.placeBet(100);
    else if (game.waitingFor === "DECIDE") {
      game.act((game.turn?.hand.value ?? 21) < 17 ? "HIT" : "STAND");
    } else await vi.advanceTimersByTimeAsync(100);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BlackjackGame", () => {
  it("autoplay plays 10 rounds with 3 CPU and the events of section 5", async () => {
    const { game, outlet } = blackjack({ autoplay: true });
    game.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(game.status).toBe("FINISHED");
    const events = outlet.events;
    expectValid(events);
    expect(d(events[0])).toEqual({
      players: ["p-mari", "cpu-1", "cpu-2", "cpu-3"],
      mode: "TABLE",
      startingChips: 1000,
      rounds: 10,
      bots: ["cpu-1", "cpu-2", "cpu-3"],
    });
    const rounds = events.filter((e) => e.type === "ROUND_STARTED").map((e) => d(e).round);
    expect(rounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Chips follow the payouts, hand by hand.
    const chips = new Map<string, number>();
    for (const e of events) {
      if (e.type === "BET_PLACED") {
        expect(d(e).chipsBefore).toBe(chips.get(e.playerId ?? "") ?? 1000);
        const amount = d(e).amount as number;
        expect(amount % 10).toBe(0);
        expect(amount).toBeGreaterThanOrEqual(10);
        expect(amount).toBeLessThanOrEqual(200);
      }
      if (e.type === "HAND_RESULT") {
        const before = chips.get(e.playerId ?? "") ?? 1000;
        expect(d(e).chips).toBe(before + (d(e).payout as number));
        chips.set(e.playerId ?? "", d(e).chips as number);
      }
    }

    // Placement by final chips.
    const results = d(events.at(-1)).results as { playerId: string; placement: number }[];
    for (const a of results) {
      for (const b of results) {
        if ((chips.get(a.playerId) ?? 0) > (chips.get(b.playerId) ?? 0)) {
          expect(a.placement).toBeLessThan(b.placement);
        }
      }
    }
  });

  it("each round follows the order of a real table", async () => {
    const { game, outlet } = blackjack({ autoplay: true });
    game.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    for (let r = 1; r <= 10; r++) {
      const round = ofRound(outlet.events, r);
      const t = types(round);
      expect(t.slice(0, 13)).toEqual([
        "ROUND_STARTED",
        ...Array<string>(4).fill("BET_PLACED"),
        ...Array<string>(4).fill("CARD_DEALT"),
        "DEALER_CARD",
        "CARD_DEALT",
        "CARD_DEALT",
        "CARD_DEALT",
      ]);
      expect(t[13]).toBe("CARD_DEALT");
      expect(round[14]).toMatchObject({ type: "DEALER_CARD", data: { hidden: true } });
      expect(round[9]).toMatchObject({ type: "DEALER_CARD", data: { hidden: false } });
      expect(t.slice(-4)).toEqual(Array<string>(4).fill("HAND_RESULT"));
      // A DOUBLE takes exactly one card; the seat does not decide again.
      round.forEach((e, i) => {
        if (e.type === "DECISION" && e.action === "DOUBLE") {
          expect(round[i + 1]).toMatchObject({ type: "CARD_DEALT", playerId: e.playerId });
          const later = round.slice(i + 2).filter((x) => x.playerId === e.playerId);
          expect(later.map((x) => x.type).filter((x) => x === "DECISION")).toEqual([]);
        }
        if (e.type === "DECISION") expect(["HIT", "STAND", "DOUBLE"]).toContain(e.action);
      });
      // Every BUST comes right after the card that caused it.
      round.forEach((e, i) => {
        if (e.type === "BUST") {
          expect(round[i - 1]?.type).toBe("CARD_DEALT");
          expect(d(e).handValue as number).toBeGreaterThan(21);
        }
      });
    }
  });

  it("the person bets and decides with the buttons; the CPU wait for them", async () => {
    const { game, outlet } = blackjack();
    expect(game.awaitingSetup).toBe(true);
    game.startWith(1);
    expect(game.players.map((p) => p.id)).toEqual(["p-mari", "cpu-1"]);
    expect(d(outlet.events[0]).bots).toEqual(["cpu-1"]);
    expect(game.waitingFor).toBe("BET");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(types(outlet.events).at(-1)).toBe("ROUND_STARTED"); // nothing moves without the person
    expect(game.placeBet(55)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outlet.events.find((e) => e.type === "BET_PLACED")).toMatchObject({
      playerId: "p-mari",
      data: { round: 1, amount: 60, chipsBefore: 1000 },
    });
    await playAsPerson(game);
    expect(game.status).toBe("FINISHED");
    expectValid(outlet.events);
    const decisions = outlet.events.filter((e) => e.type === "DECISION" && e.playerId === "p-mari");
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("refuses a double after the first two cards", async () => {
    const { game } = blackjack({}, 2);
    game.startWith(1);
    for (let i = 0; i < 1000 && game.status !== "FINISHED"; i++) {
      if (game.waitingFor === "BET") game.placeBet(100);
      else if (game.waitingFor === "DECIDE") {
        const seat = game.turn;
        if (seat && seat.hand.size > 2) {
          expect(seat.canDouble).toBe(false);
          expect(game.act("DOUBLE")).toBe(false);
          return;
        }
        game.act("HIT");
      } else await vi.advanceTimersByTimeAsync(100);
    }
    throw new Error("no hand with three cards to try");
  });

  it("a CPU out of chips leaves with NO_CHIPS and the table goes on", async () => {
    // A reckless CPU: always bets 200 and always hits.
    const reckless: DecisionStrategy = {
      human: false,
      bet: () => Promise.resolve(200),
      decide: () => Promise.resolve({ action: "HIT" as const }),
    };
    const { game, outlet } = blackjack({ autoplay: true, cpuStrategy: () => reckless });
    game.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const events = outlet.events;
    expectValid(events);
    const left = events.filter((e) => e.type === "PLAYER_LEFT");
    expect(left.length).toBeGreaterThan(0);
    for (const e of left) {
      expect(d(e).reason).toBe("NO_CHIPS");
      const lastHand = events
        .filter((x) => x.type === "HAND_RESULT" && x.playerId === e.playerId)
        .at(-1);
      expect(d(lastHand).chips as number).toBeLessThan(10);
      // Nothing more of that player after leaving, but the rounds go on.
      const after = events.slice(events.indexOf(e) + 1);
      expect(after.filter((x) => x.playerId === e.playerId)).toEqual([]);
    }
    expect(events.filter((e) => e.type === "ROUND_STARTED")).toHaveLength(10);
  });

  it("closing mid-round ends the match without more events", async () => {
    const { game, outlet } = blackjack({ autoplay: true });
    game.start();
    await vi.advanceTimersByTimeAsync(3000);
    game.abandon("QUIT");
    const count = outlet.events.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outlet.events).toHaveLength(count);
    expect(types(outlet.events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
    expectValid(outlet.events);
  });

  it("the same seed plays the same match", async () => {
    const play = async () => {
      const { game, outlet } = blackjack({ autoplay: true }, 13);
      game.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      return outlet.events.map((e) => [e.type, e.playerId, e.action, JSON.stringify(e.data)]);
    };
    expect(await play()).toEqual(await play());
  });
});
