import { describe, expect, it } from "vitest";
import { Rng } from "../../../src/core/Rng.js";
import { CollisionDetector } from "../../../src/games/snake/CollisionDetector.js";
import { Grid } from "../../../src/games/snake/Grid.js";
import { LevelPolicy } from "../../../src/games/snake/LevelPolicy.js";
import { keyOf, point } from "../../../src/games/snake/Point.js";
import { Snake } from "../../../src/games/snake/Snake.js";
import { SnakeBot } from "../../../src/games/snake/SnakeBot.js";

const grid = new Grid();
const detector = new CollisionDetector(grid);
const none = new Set<string>();

describe("Snake", () => {
  it("starts with three cells behind the head", () => {
    const s = new Snake(point(10, 10), "RIGHT");
    expect(s.body).toEqual([point(10, 10), point(9, 10), point(8, 10)]);
  });

  it("moves, and grows after eating without moving the tail", () => {
    const s = new Snake(point(10, 10), "RIGHT");
    s.advance();
    expect(s.body).toEqual([point(11, 10), point(10, 10), point(9, 10)]);
    s.grow(2);
    expect(s.length).toBe(5);
    s.advance();
    s.advance();
    expect(s.body).toEqual([
      point(13, 10),
      point(12, 10),
      point(11, 10),
      point(10, 10),
      point(9, 10),
    ]);
    s.advance();
    expect(s.body.at(-1)).toEqual(point(10, 10));
  });

  it("ignores a turn straight back and keeps up to two quick turns", () => {
    const s = new Snake(point(10, 10), "RIGHT");
    expect(s.turn("LEFT")).toBe(false);
    expect(s.turn("RIGHT")).toBe(false);
    expect(s.turn("UP")).toBe(true);
    expect(s.turn("DOWN")).toBe(false); // back from UP
    expect(s.turn("LEFT")).toBe(true);
    expect(s.turn("DOWN")).toBe(false); // already two waiting
    s.advance();
    expect(s.head).toEqual(point(10, 9));
    s.advance();
    expect(s.head).toEqual(point(9, 9));
    expect(s.direction).toBe("LEFT");
  });
});

describe("CollisionDetector", () => {
  it("WALL outside the grid, on every side", () => {
    const s = new Snake(point(19, 0), "RIGHT");
    expect(detector.check(s, point(20, 0), none)).toBe("WALL");
    expect(detector.check(s, point(-1, 5), none)).toBe("WALL");
    expect(detector.check(s, point(5, -1), none)).toBe("WALL");
    expect(detector.check(s, point(5, 20), none)).toBe("WALL");
    expect(detector.check(s, point(0, 0), none)).toBeNull();
  });

  it("OBSTACLE on an obstacle cell", () => {
    const s = new Snake(point(5, 5), "RIGHT");
    expect(detector.check(s, point(6, 5), new Set([keyOf(point(6, 5))]))).toBe("OBSTACLE");
  });

  it("SELF on its body, but not on the tail that moves away", () => {
    // A snake of 5 bent into a square: the head can go into the tail's cell.
    const s = new Snake(point(5, 5), "RIGHT", 2);
    s.grow(3);
    for (const d of ["DOWN", "LEFT", "UP"] as const) {
      s.turn(d);
      s.advance();
    }
    // body: (5,5) (5,6) (4,6) (4,5)... the head at (4,5) going up
    expect(s.head).toEqual(point(4, 5));
    s.turn("RIGHT");
    expect(detector.check(s, s.nextHead(), none)).toBe("SELF");
  });

  it("the tail cell is free unless the snake just ate", () => {
    const s = new Snake(point(5, 5), "RIGHT", 4);
    const tail = s.body.at(-1) ?? point(0, 0);
    expect(detector.check(s, tail, none)).toBeNull();
    s.grow(1);
    expect(detector.check(s, tail, none)).toBe("SELF");
  });
});

describe("LevelPolicy", () => {
  const policy = new LevelPolicy();

  it("a level every 5 fruits", () => {
    expect([0, 4, 5, 9, 10, 27].map((f) => policy.levelFor(f))).toEqual([1, 1, 2, 2, 3, 6]);
  });

  it("tick of 150 ms, 10 less per level, never under 60", () => {
    expect([1, 2, 5, 10, 11, 30].map((l) => policy.tickMs(l))).toEqual([150, 140, 110, 60, 60, 60]);
    expect(policy.speed(1)).toBe(1);
    expect(policy.speed(2)).toBe(1.07);
    expect(policy.speed(10)).toBe(2.5);
  });

  it("obstacles from level 3", () => {
    expect([1, 2, 3, 4, 9].map((l) => policy.obstacles(l))).toEqual([0, 0, 4, 8, 24]);
  });
});

describe("Grid", () => {
  it("wraps cells and finds a free one", () => {
    expect(grid.wrap(point(20, -1))).toEqual(point(0, 19));
    const small = new Grid(2, 1);
    expect(small.randomFree(new Rng(1), (p) => p.x === 0)).toEqual(point(1, 0));
    expect(small.randomFree(new Rng(1), () => true)).toBeNull();
    expect(grid.label).toBe("20x20");
  });
});

describe("SnakeBot", () => {
  it("after 120 moves without eating it stops chasing and goes straight", () => {
    const bot = new SnakeBot(new Rng(1));
    const snake = new Snake(point(10, 10), "RIGHT");
    // A target it never reaches: the bot keeps choosing a safe direction.
    const view = { snake, target: point(0, 0), obstacles: none, detector };
    for (let i = 0; i < 119; i++) bot.choose(view);
    expect(bot.careless).toBe(false);
    bot.choose(view);
    expect(bot.careless).toBe(true);
    expect(bot.choose(view)).toBe(snake.nextDirection);
    bot.ate(); // eating resets the count (the fruit budget is still there)
    bot.newLife();
    expect(bot.careless).toBe(false);
  });
});
