import { describe, expect, it } from "vitest";
import bankFile from "../../../src/games/trivia/questions.json";
import { CATEGORIES, parseQuestion } from "../../../src/games/trivia/Question.js";
import { QuestionBank } from "../../../src/games/trivia/QuestionBank.js";
import { Rng } from "../../../src/core/Rng.js";

const raw: unknown[] = bankFile;

const question = (id: string, category = "CIENCIA") => ({
  id,
  category,
  difficulty: "EASY",
  text: "¿Pregunta?",
  options: { A: "1", B: "2", C: "3", D: "4" },
  answer: "A",
});
/** A valid bank of `n` questions spread over the categories. */
const bankOf = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    question(`q-${String(i + 1).padStart(3, "0")}`, CATEGORIES[i % CATEGORIES.length]),
  );

describe("questions.json", () => {
  it("every question has the format of the plan", () => {
    raw.forEach((q, i) => {
      expect(() => parseQuestion(q, i)).not.toThrow();
      expect(Object.keys(q as object).sort()).toEqual(
        ["answer", "category", "difficulty", "id", "options", "text"].sort(),
      );
    });
  });

  it("has no repeated id and at least two questions per category", () => {
    const questions = raw.map((q, i) => parseQuestion(q, i));
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const c of CATEGORIES) {
      expect(questions.filter((q) => q.category === c).length).toBeGreaterThanOrEqual(2);
    }
    expect(new QuestionBank(raw).size).toBeGreaterThanOrEqual(10);
  });
});

describe("QuestionBank", () => {
  it("works with any number of questions from 10 up", () => {
    expect(new QuestionBank(bankOf(10)).size).toBe(10);
    expect(new QuestionBank(bankOf(40)).size).toBe(40);
    expect(() => new QuestionBank(bankOf(9))).toThrow(/at least 10/);
  });

  it("refuses a repeated id, a missing category and a bad entry", () => {
    const repeated = bankOf(10);
    repeated[9] = question("q-001", "ENTRETENIMIENTO");
    expect(() => new QuestionBank(repeated)).toThrow(/q-001 is repeated/);

    const noSport = bankOf(10).map((q) => ({
      ...q,
      category: q.category === "DEPORTES" ? "CIENCIA" : q.category,
    }));
    expect(() => new QuestionBank(noSport)).toThrow(/DEPORTES/);

    const bad = bankOf(10);
    bad[0] = { ...question("q-001"), answer: "E" };
    expect(() => new QuestionBank(bad)).toThrow(/answer/);
    bad[0] = { ...question("q-001"), options: { A: "1", B: "2", C: "3", D: "" } };
    expect(() => new QuestionBank(bad)).toThrow(/options/);
  });

  it("draws different questions, the same for the same seed", () => {
    const bank = new QuestionBank(bankOf(40));
    const ids = (seed: number) => bank.draw(10, new Rng(seed)).map((q) => q.id);
    expect(new Set(ids(1)).size).toBe(10);
    expect(ids(1)).toEqual(ids(1));
    expect(ids(1)).not.toEqual(ids(2));
  });
});
