import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ID, EVENT_SPECS, type AnyGameEvent } from "@gameconsole/shared";
import { HumanPlayer } from "../../../src/core/Player.js";
import { Rng } from "../../../src/core/Rng.js";
import { TriviaGame, type TriviaOptions } from "../../../src/games/trivia/TriviaGame.js";
import { FakeOutlet, types } from "../../core/testGame.js";

const schemaPath = fileURLToPath(
  new URL("../../../../../schemas/event.schema.json", import.meta.url),
);
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(schemaPath, "utf8")) as object,
);

function trivia(options: TriviaOptions = {}, seed = 5) {
  const outlet = new FakeOutlet();
  const game = new TriviaGame(
    HumanPlayer.named("Ana"),
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

/** Every event follows the envelope schema and carries the keys GameStats requires. */
function expectValid(events: readonly AnyGameEvent[]) {
  events.forEach((e, i) => {
    expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    expect(e.seq).toBe(i + 1);
    const spec = EVENT_SPECS.trivia[e.type as keyof typeof EVENT_SPECS.trivia];
    expect(spec, e.type).toBeDefined();
    for (const key of spec.required) expect(e.data).toHaveProperty(key);
    if (spec.playerRequired) expect(e.playerId).not.toBeNull();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TriviaGame", () => {
  it("autoplay plays a whole match with the events of section 5", () => {
    const { game, outlet } = trivia({ autoplay: true });
    expect(game.awaitingSetup).toBe(false);
    game.start();
    vi.advanceTimersByTime(10 * 60_000);
    expect(game.status).toBe("FINISHED");

    const events = outlet.events;
    expectValid(events);
    expect(types(events).slice(0, 4)).toEqual([
      "MATCH_STARTED",
      "PLAYER_JOINED",
      "PLAYER_JOINED",
      "PLAYER_JOINED",
    ]);
    expect(events[0]?.data).toEqual({
      players: ["p-ana", "cpu-1", "cpu-2"],
      mode: "CLASSIC",
      questions: 10,
    });

    // Each question: shown, three answers with their score, closed.
    const perQuestion = types(events.slice(4, -1));
    expect(perQuestion).toHaveLength(10 * 8);
    for (let q = 0; q < 10; q++) {
      expect(perQuestion.slice(q * 8, q * 8 + 8)).toEqual([
        "QUESTION_SHOWN",
        "ANSWER_SUBMITTED",
        "SCORE_CHANGED",
        "ANSWER_SUBMITTED",
        "SCORE_CHANGED",
        "ANSWER_SUBMITTED",
        "SCORE_CHANGED",
        "QUESTION_CLOSED",
      ]);
    }

    const shown = events.filter((e) => e.type === "QUESTION_SHOWN");
    expect(shown.map((e) => (e.data as { number: number }).number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(new Set(shown.map((e) => (e.data as { questionId: string }).questionId)).size).toBe(10);

    // The first player changes with each question.
    const firstAnswer = (q: number) => events.filter((e) => e.type === "ANSWER_SUBMITTED")[q * 3];
    expect([0, 1, 2, 3].map((q) => firstAnswer(q)?.playerId)).toEqual([
      "p-ana",
      "cpu-1",
      "cpu-2",
      "p-ana",
    ]);

    const last = events.at(-1);
    expect(last?.type).toBe("MATCH_FINISHED");
    const totals = new Map<string, number>();
    for (const e of events) {
      if (e.type === "SCORE_CHANGED" && e.playerId) {
        totals.set(e.playerId, (e.data as { total: number }).total);
      }
    }
    const results = (last?.data as { results: { playerId: string; placement: number }[] }).results;
    expect(results.map((r) => r.playerId).sort()).toEqual(["cpu-1", "cpu-2", "p-ana"]);
    for (const a of results) {
      for (const b of results) {
        if ((totals.get(a.playerId) ?? 0) > (totals.get(b.playerId) ?? 0)) {
          expect(a.placement).toBeLessThan(b.placement);
        }
      }
    }
  });

  it("the same seed plays the same match", () => {
    const play = () => {
      const { game, outlet } = trivia({ autoplay: true }, 11);
      game.start();
      vi.advanceTimersByTime(10 * 60_000);
      return outlet.events.map((e) => [e.type, e.playerId, JSON.stringify(e.data)]);
    };
    expect(play()).toEqual(play());
  });

  it("hot seat: a person answers with a button, another runs out of time", () => {
    const { game, outlet } = trivia({ questions: 1, thinkMs: [1000, 1000], revealMs: 500 });
    expect(game.awaitingSetup).toBe(true);
    expect(game.status).toBe("READY");
    game.startWith([{ kind: "person", name: "Luis" }, { kind: "cpu" }]);
    expect(game.players.map((p) => p.id)).toEqual(["p-ana", "p-luis", "cpu-1"]);

    // Ana's turn: she answers after 3 s.
    expect(game.waitingForPerson).toBe(true);
    expect(game.currentPlayer?.id).toBe("p-ana");
    vi.advanceTimersByTime(3000);
    const question = game.round?.question;
    if (question === undefined) throw new Error("no question");
    expect(game.answer(question.answer)).toBe(true);
    expect(outlet.events.at(-2)).toMatchObject({
      type: "ANSWER_SUBMITTED",
      playerId: "p-ana",
      data: { questionId: question.id, option: question.answer, correct: true, responseMs: 3000 },
    });
    expect(outlet.events.at(-1)).toMatchObject({
      type: "SCORE_CHANGED",
      data: { delta: 140, total: 140, reason: "CORRECT_FAST" },
    });

    // Luis does not answer: ANSWER_TIMEOUT after 15 s and no points.
    expect(game.currentPlayer?.id).toBe("p-luis");
    vi.advanceTimersByTime(15_000);
    expect(outlet.events.at(-1)).toMatchObject({
      type: "ANSWER_TIMEOUT",
      playerId: "p-luis",
      data: { questionId: question.id },
    });

    // The CPU answers alone and the question closes.
    expect(game.waitingForPerson).toBe(false);
    expect(game.answer("A")).toBe(false); // not a person's turn
    vi.advanceTimersByTime(1000);
    const closed = outlet.events.at(-1);
    expect(closed?.type).toBe("QUESTION_CLOSED");
    expect(closed?.data).toMatchObject({ questionId: question.id, correctOption: question.answer });
    expect(game.phase).toBe("REVEAL");

    vi.advanceTimersByTime(500);
    expect(game.status).toBe("FINISHED");
    expect(outlet.events.at(-1)?.data).toMatchObject({ durationMs: 19_500 });
    expectValid(outlet.events);
  });

  it("checks the seats of the start screen", () => {
    const host = HumanPlayer.named("Ana");
    expect(TriviaGame.checkSeats(host, [])).toMatch(/de 2 a 6/);
    expect(
      TriviaGame.checkSeats(
        host,
        Array.from({ length: 6 }, () => ({ kind: "cpu" as const })),
      ),
    ).toMatch(/de 2 a 6/);
    expect(TriviaGame.checkSeats(host, [{ kind: "person", name: " " }])).toMatch(/nombre/);
    expect(TriviaGame.checkSeats(host, [{ kind: "person", name: "ana" }])).toMatch(/dos jugadores/);
    expect(
      TriviaGame.checkSeats(host, [{ kind: "cpu" }, { kind: "person", name: "Luis" }]),
    ).toBeNull();
    const { game } = trivia();
    expect(() => game.startWith([])).toThrow(/de 2 a 6/);
    expect(game.status).toBe("READY");
  });

  it("closing mid-question ends the match without more events", () => {
    const { game, outlet } = trivia({ autoplay: true });
    game.start();
    vi.advanceTimersByTime(2000);
    game.abandon("QUIT");
    const count = outlet.events.length;
    expect(types(outlet.events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
    vi.advanceTimersByTime(60_000); // no timer of the game is left
    expect(outlet.events).toHaveLength(count);
    expectValid(outlet.events);
  });

  it("a person's answer counts as activity; the CPU's do not", () => {
    const { game } = trivia({ thinkMs: [1000, 1000] });
    game.startWith([{ kind: "cpu" }]);
    vi.advanceTimersByTime(15_000); // Ana times out
    vi.advanceTimersByTime(1000); // the CPU answers
    expect(game.idleMs).toBe(16_000);
  });
});
