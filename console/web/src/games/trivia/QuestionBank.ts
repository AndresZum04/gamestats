import type { Rng } from "../../core/Rng.js";
import { CATEGORIES, parseQuestion, type Question } from "./Question.js";
import bankFile from "./questions.json";

/** Questions of one match (the `questions` of MATCH_STARTED). */
export const QUESTIONS_PER_MATCH = 10;

/**
 * The question bank. It validates the whole file when created: every entry
 * well formed, no repeated id, at least two questions per category and enough
 * for one match. It works with any number of questions from 10 up.
 */
export class QuestionBank {
  readonly #questions: readonly Question[];

  constructor(raw: unknown) {
    if (!Array.isArray(raw)) throw new Error("the question bank must be a list");
    const questions = raw.map((q, i) => parseQuestion(q, i));
    const ids = new Set<string>();
    for (const q of questions) {
      if (ids.has(q.id)) throw new Error(`${q.id} is repeated`);
      ids.add(q.id);
    }
    if (questions.length < QUESTIONS_PER_MATCH) {
      throw new Error(`the bank needs at least ${QUESTIONS_PER_MATCH} questions`);
    }
    for (const c of CATEGORIES) {
      if (questions.filter((q) => q.category === c).length < 2) {
        throw new Error(`category ${c} needs at least two questions`);
      }
    }
    this.#questions = questions;
  }

  get size(): number {
    return this.#questions.length;
  }

  all(): readonly Question[] {
    return this.#questions;
  }

  /** `count` different questions in random order. */
  draw(count: number, rng: Rng): Question[] {
    if (count > this.#questions.length) throw new Error(`the bank has only ${this.size}`);
    return rng.shuffle(this.#questions).slice(0, count);
  }
}

/** The bank of questions.json, validated once when the console loads. */
export const defaultBank = new QuestionBank(bankFile);
