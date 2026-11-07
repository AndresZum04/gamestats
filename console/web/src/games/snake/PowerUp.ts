import type { PowerUpKind } from "@gameconsole/shared";
import type { Point } from "./Point.js";

/** How long each power lasts once picked (durationMs of POWERUP_PICKED). */
export const POWERUP_DURATION_MS: Readonly<Record<PowerUpKind, number>> = {
  SPEED: 5000,
  SLOW: 5000,
  SHIELD: 8000,
  DOUBLE_POINTS: 8000,
};

export const POWERUP_KINDS = Object.keys(POWERUP_DURATION_MS) as PowerUpKind[];

/** Chance that a power appears after eating, when there is none on the board. */
export const POWERUP_CHANCE = 0.3;
/** A power on the board disappears after this long. */
export const POWERUP_LIFETIME_MS = 7000;

/** Tick multiplier of the speed powers: SPEED makes ticks shorter, SLOW longer. */
export const SPEED_FACTOR = { SPEED: 0.7, SLOW: 1.5 } as const;

/**
 * A power on the board:
 * SPEED and SLOW change the speed (picking one cancels the other),
 * SHIELD lets the snake cross walls (it comes out on the other side), itself
 * and obstacles without dying, and DOUBLE_POINTS doubles what fruits are worth.
 */
export interface PowerUp {
  readonly kind: PowerUpKind;
  readonly at: Point;
  readonly expiresAt: number;
}
