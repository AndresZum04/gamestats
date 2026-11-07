import type { AnswerOption, Difficulty } from "@gameconsole/shared";
import { BotPlayer } from "../../core/Player.js";
import type { Rng } from "../../core/Rng.js";
import { OPTIONS, type Question } from "./Question.js";

/** Change of the bot's accuracy by difficulty. */
const DIFFICULTY_SHIFT: Readonly<Record<Difficulty, number>> = {
  EASY: 0.15,
  MEDIUM: 0,
  HARD: -0.15,
};

/**
 * How the computer answers: right with a fixed probability (a bit more on easy
 * questions, a bit less on hard ones), otherwise one of the wrong options.
 * There is no Prolog here; the plan keeps the AI for Blackjack.
 */
export function botAnswer(question: Question, accuracy: number, rng: Rng): AnswerOption {
  const p = Math.max(0, Math.min(1, accuracy + DIFFICULTY_SHIFT[question.difficulty]));
  if (rng.chance(p)) return question.answer;
  return rng.pick(OPTIONS.filter((o) => o !== question.answer));
}

/** A trivia player of the computer (cpu-1, cpu-2...). */
export class TriviaBot extends BotPlayer {
  readonly accuracy: number;

  constructor(id: string, name: string, accuracy = 0.6) {
    super(id, name);
    this.accuracy = accuracy;
  }

  static numbered(n: number): TriviaBot {
    return new TriviaBot(`cpu-${n}`, `CPU ${n}`);
  }
}
