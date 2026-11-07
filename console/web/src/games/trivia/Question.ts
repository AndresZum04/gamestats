import type { AnswerOption, Difficulty, TriviaCategory } from "@gameconsole/shared";

export const CATEGORIES: readonly TriviaCategory[] = [
  "CIENCIA",
  "HISTORIA",
  "DEPORTES",
  "GEOGRAFIA",
  "ENTRETENIMIENTO",
];
export const DIFFICULTIES: readonly Difficulty[] = ["EASY", "MEDIUM", "HARD"];
export const OPTIONS: readonly AnswerOption[] = ["A", "B", "C", "D"];

/** One question of the bank (web/src/games/trivia/questions.json). */
export interface Question {
  id: string;
  category: TriviaCategory;
  difficulty: Difficulty;
  text: string;
  options: Readonly<Record<AnswerOption, string>>;
  answer: AnswerOption;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * Checks one entry of the bank and returns the question, or fails saying what
 * is wrong. The file is edited by hand, so a bad entry is refused with a clear
 * message when the console loads instead of breaking a match halfway.
 */
export function parseQuestion(raw: unknown, index: number): Question {
  const where = `question ${index + 1}`;
  if (!isRecord(raw)) throw new Error(`${where}: not an object`);
  const { id, category, difficulty, text, options, answer } = raw;
  if (typeof id !== "string" || !/^q-\d{3,}$/.test(id)) throw new Error(`${where}: bad id`);
  if (!oneOf(CATEGORIES, category)) throw new Error(`${id}: unknown category`);
  if (!oneOf(DIFFICULTIES, difficulty)) throw new Error(`${id}: unknown difficulty`);
  if (!nonEmpty(text)) throw new Error(`${id}: empty text`);
  if (!isRecord(options)) throw new Error(`${id}: options must be an object`);
  const keys = Object.keys(options).sort();
  if (keys.join() !== OPTIONS.join() || !OPTIONS.every((o) => nonEmpty(options[o]))) {
    throw new Error(`${id}: options must be A, B, C and D, none empty`);
  }
  if (!oneOf(OPTIONS, answer)) throw new Error(`${id}: answer must be A, B, C or D`);
  return {
    id,
    category,
    difficulty,
    text,
    options: options as Record<AnswerOption, string>,
    answer,
  };
}
