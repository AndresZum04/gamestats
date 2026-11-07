import type { Placement } from "@gameconsole/shared";

export const POINTS_CORRECT = 100;
export const MAX_SPEED_BONUS = 50;

export interface Award {
  delta: number;
  total: number;
  /** CORRECT_FAST (speed bonus of 25 or more), CORRECT or WRONG. */
  reason: "CORRECT_FAST" | "CORRECT" | "WRONG";
}

export interface Standing {
  playerId: string;
  total: number;
  placement: number;
}

/**
 * Points of a trivia match: 100 for a right answer plus up to 50 for speed,
 * going down in a straight line from 50 (instant answer) to 0 (at the time
 * limit). A wrong answer is worth nothing.
 */
export class Scoreboard {
  readonly #order: readonly string[];
  readonly #totals = new Map<string, number>();

  /** `playerIds` in seat order, which keeps the order of ties stable. */
  constructor(playerIds: readonly string[]) {
    this.#order = [...playerIds];
    for (const id of playerIds) this.#totals.set(id, 0);
  }

  static points(correct: boolean, responseMs: number, timeLimitMs: number): number {
    if (!correct) return 0;
    const left = Math.max(0, Math.min(1, 1 - responseMs / timeLimitMs));
    return POINTS_CORRECT + Math.round(MAX_SPEED_BONUS * left);
  }

  /** Adds the points of one answer and returns what SCORE_CHANGED carries. */
  award(playerId: string, correct: boolean, responseMs: number, timeLimitMs: number): Award {
    const current = this.#totals.get(playerId);
    if (current === undefined) throw new Error(`${playerId} is not in this match`);
    const delta = Scoreboard.points(correct, responseMs, timeLimitMs);
    const total = current + delta;
    this.#totals.set(playerId, total);
    const reason = !correct ? "WRONG" : delta - POINTS_CORRECT >= 25 ? "CORRECT_FAST" : "CORRECT";
    return { delta, total, reason };
  }

  total(playerId: string): number {
    return this.#totals.get(playerId) ?? 0;
  }

  /** Highest total first. Equal totals share the placement (1, 1, 3). */
  standings(): Standing[] {
    const sorted = [...this.#order].sort((a, b) => this.total(b) - this.total(a));
    return sorted.map((playerId) => ({
      playerId,
      total: this.total(playerId),
      placement: 1 + sorted.filter((other) => this.total(other) > this.total(playerId)).length,
    }));
  }

  placements(): Placement[] {
    return this.standings().map(({ playerId, placement }) => ({ playerId, placement }));
  }
}
