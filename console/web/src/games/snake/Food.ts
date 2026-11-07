import type { FoodType } from "@gameconsole/shared";
import type { Rng } from "../../core/Rng.js";
import type { Point } from "./Point.js";

export interface FoodKind {
  points: number;
  /** Cells the snake grows. */
  grow: number;
  /** How likely it is to appear, relative to the others. */
  weight: number;
  /** A BONUS disappears if it is not eaten in time; null means it stays. */
  lifetimeMs: number | null;
}

export const FOODS: Readonly<Record<FoodType, FoodKind>> = {
  APPLE: { points: 10, grow: 1, weight: 80, lifetimeMs: null },
  GOLDEN: { points: 30, grow: 2, weight: 15, lifetimeMs: null },
  BONUS: { points: 50, grow: 1, weight: 5, lifetimeMs: 6000 },
};

/** The fruit on the board. There is always exactly one. */
export interface Food {
  readonly type: FoodType;
  readonly at: Point;
  /** Clock time when it disappears, or null. */
  readonly expiresAt: number | null;
}

/** A fruit type by weight: mostly apples, sometimes golden ones, rarely a bonus. */
export function pickFood(rng: Rng): FoodType {
  const kinds = Object.entries(FOODS) as [FoodType, FoodKind][];
  let roll = rng.next() * kinds.reduce((sum, [, k]) => sum + k.weight, 0);
  for (const [type, kind] of kinds) {
    roll -= kind.weight;
    if (roll < 0) return type;
  }
  return "APPLE";
}
