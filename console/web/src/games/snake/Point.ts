/** A cell of the grid; x grows to the right and y downwards. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export const DIRECTIONS: readonly Direction[] = ["UP", "RIGHT", "DOWN", "LEFT"];

const DELTA: Readonly<Record<Direction, Point>> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

export const point = (x: number, y: number): Point => ({ x, y });

/** The neighbouring cell in that direction. */
export function step(p: Point, direction: Direction): Point {
  const d = DELTA[direction];
  return { x: p.x + d.x, y: p.y + d.y };
}

export const opposite = (direction: Direction): Direction => OPPOSITE[direction];

export const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** "x,y", to keep points in a Set. */
export const keyOf = (p: Point): string => `${p.x},${p.y}`;

export const manhattan = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
