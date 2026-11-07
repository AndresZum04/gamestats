import { describe, expect, it } from "vitest";
import { Scoreboard } from "../../../src/games/trivia/Scoreboard.js";
import { TriviaRound } from "../../../src/games/trivia/TriviaRound.js";
import { defaultBank } from "../../../src/games/trivia/QuestionBank.js";

describe("Scoreboard", () => {
  it("gives 100 for a right answer plus up to 50 for speed", () => {
    expect(Scoreboard.points(true, 0, 15_000)).toBe(150);
    expect(Scoreboard.points(true, 7500, 15_000)).toBe(125);
    expect(Scoreboard.points(true, 15_000, 15_000)).toBe(100);
    expect(Scoreboard.points(true, 20_000, 15_000)).toBe(100);
    expect(Scoreboard.points(false, 0, 15_000)).toBe(0);
  });

  it("returns delta, total and reason for SCORE_CHANGED", () => {
    const board = new Scoreboard(["p-ana", "cpu-1"]);
    expect(board.award("p-ana", true, 3000, 15_000)).toEqual({
      delta: 140,
      total: 140,
      reason: "CORRECT_FAST",
    });
    expect(board.award("p-ana", true, 12_000, 15_000)).toEqual({
      delta: 110,
      total: 250,
      reason: "CORRECT",
    });
    expect(board.award("p-ana", false, 1000, 15_000)).toEqual({
      delta: 0,
      total: 250,
      reason: "WRONG",
    });
    expect(() => board.award("p-x", true, 0, 15_000)).toThrow(/not in this match/);
  });

  it("orders by points and ties share the placement", () => {
    const board = new Scoreboard(["p-ana", "p-luis", "cpu-1", "cpu-2"]);
    board.award("p-luis", true, 15_000, 15_000); // 100
    board.award("cpu-1", true, 15_000, 15_000); // 100
    board.award("cpu-2", true, 0, 15_000); // 150
    expect(board.standings()).toEqual([
      { playerId: "cpu-2", total: 150, placement: 1 },
      { playerId: "p-luis", total: 100, placement: 2 },
      { playerId: "cpu-1", total: 100, placement: 2 },
      { playerId: "p-ana", total: 0, placement: 4 },
    ]);
  });
});

describe("TriviaRound", () => {
  const question = defaultBank.all()[0];
  if (question === undefined) throw new Error("empty bank");
  const wrong = question.answer === "A" ? "B" : "A";

  it("takes the answers in turn and closes with correctCount", () => {
    const round = new TriviaRound(question, 1, ["p-ana", "cpu-1", "p-luis"]);
    expect(round.current).toBe("p-ana");
    expect(round.answer("p-ana", question.answer, 140)).toEqual({
      option: question.answer,
      correct: true,
      points: 140,
    });
    expect(round.current).toBe("cpu-1");
    round.timeout("cpu-1");
    expect(round.complete).toBe(false);
    round.answer("p-luis", wrong, 0);
    expect(round.complete).toBe(true);
    expect(round.current).toBeUndefined();
    expect(round.correctCount).toBe(1);
    expect(round.outcome("cpu-1")).toEqual({ correct: false, points: 0 });
  });

  it("refuses an answer out of turn", () => {
    const round = new TriviaRound(question, 1, ["p-ana", "cpu-1"]);
    expect(() => round.answer("cpu-1", question.answer, 100)).toThrow(/not the turn/);
    round.answer("p-ana", wrong, 0);
    expect(() => round.answer("p-ana", wrong, 0)).toThrow(/not the turn/);
  });
});
