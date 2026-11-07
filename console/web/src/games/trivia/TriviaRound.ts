import type { AnswerOption } from "@gameconsole/shared";
import type { Question } from "./Question.js";

export interface Outcome {
  /** Missing when the time ran out. */
  option?: AnswerOption;
  correct: boolean;
  points: number;
}

/**
 * One question in play. Every player answers it on their turn, in a fixed
 * order; once the last one has answered or run out of time the question can be
 * closed and its correctCount is known (QUESTION_CLOSED).
 */
export class TriviaRound {
  readonly question: Question;
  /** 1 for the first question of the match. */
  readonly number: number;
  readonly #order: readonly string[];
  readonly #outcomes = new Map<string, Outcome>();

  constructor(question: Question, number: number, order: readonly string[]) {
    if (order.length === 0) throw new Error("a round needs players");
    this.question = question;
    this.number = number;
    this.#order = [...order];
  }

  get order(): readonly string[] {
    return this.#order;
  }

  /** Whose turn it is, or undefined when everybody has played. */
  get current(): string | undefined {
    return this.#order[this.#outcomes.size];
  }

  get complete(): boolean {
    return this.#outcomes.size === this.#order.length;
  }

  get correctCount(): number {
    return [...this.#outcomes.values()].filter((o) => o.correct).length;
  }

  outcome(playerId: string): Outcome | undefined {
    return this.#outcomes.get(playerId);
  }

  /** Whether `option` is the right answer. */
  isCorrect(option: AnswerOption): boolean {
    return option === this.question.answer;
  }

  /** The current player answers and gets `points` (from the Scoreboard). */
  answer(playerId: string, option: AnswerOption, points: number): Outcome {
    this.#checkTurn(playerId);
    const outcome = { option, correct: this.isCorrect(option), points };
    this.#outcomes.set(playerId, outcome);
    return outcome;
  }

  /** The current player ran out of time. */
  timeout(playerId: string): Outcome {
    this.#checkTurn(playerId);
    const outcome = { correct: false, points: 0 };
    this.#outcomes.set(playerId, outcome);
    return outcome;
  }

  #checkTurn(playerId: string): void {
    if (this.current !== playerId) {
      throw new Error(`it is not the turn of ${playerId} in ${this.question.id}`);
    }
  }
}
