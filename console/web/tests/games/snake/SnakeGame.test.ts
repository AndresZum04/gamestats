import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ID, EVENT_SPECS, type AnyGameEvent } from "@gameconsole/shared";
import { GameRegistry } from "../../../src/console/GameRegistry.js";
import { InstanceManager } from "../../../src/console/InstanceManager.js";
import { HumanPlayer } from "../../../src/core/Player.js";
import { Rng } from "../../../src/core/Rng.js";
import { snakeDefinition } from "../../../src/games/snake/index.js";
import { SnakeGame, type SnakeOptions } from "../../../src/games/snake/SnakeGame.js";
import { FakeOutlet, outlets, types } from "../../core/testGame.js";

const schemaPath = fileURLToPath(
  new URL("../../../../../schemas/event.schema.json", import.meta.url),
);
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(schemaPath, "utf8")) as object,
);

function expectValid(events: readonly AnyGameEvent[]) {
  events.forEach((e, i) => {
    expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    expect(e.seq).toBe(i + 1);
    const spec = EVENT_SPECS.snake[e.type as keyof typeof EVENT_SPECS.snake];
    expect(spec, e.type).toBeDefined();
    for (const key of spec.required) expect(e.data).toHaveProperty(key);
  });
}

function snake(options: SnakeOptions = {}, seed = 3) {
  const outlet = new FakeOutlet();
  const game = new SnakeGame(
    HumanPlayer.named("Kev"),
    {
      outlet: () => outlet,
      source: { consoleId: CONSOLE_ID, sessionId: "tab-1" },
      clock: { now: () => Date.now() },
      rng: new Rng(seed),
    },
    options,
  );
  return { game, outlet };
}

const data = <T>(e: AnyGameEvent | undefined) => e?.data as T;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SnakeGame", () => {
  it("autoplay with a fixed seed plays a whole match with the events of section 5", () => {
    const { game, outlet } = snake({ autoplay: true });
    game.start();
    vi.advanceTimersByTime(30 * 60_000);
    expect(game.status).toBe("FINISHED");
    const events = outlet.events;
    expectValid(events);

    expect(events[0]?.data).toEqual({
      players: ["p-kev"],
      mode: "CLASSIC",
      lives: 3,
      grid: "20x20",
    });
    expect(types(events).slice(0, 2)).toEqual(["MATCH_STARTED", "PLAYER_JOINED"]);

    const deaths = events.filter((e) => e.type === "SNAKE_DIED");
    expect(deaths.map((e) => data<{ livesLeft: number }>(e).livesLeft)).toEqual([2, 1, 0]);
    const respawns = events.filter((e) => e.type === "PLAYER_RESPAWNED");
    expect(respawns.map((e) => data<{ livesLeft: number }>(e).livesLeft)).toEqual([2, 1]);
    respawns.forEach((r, i) => {
      const died = Date.parse(deaths[i]?.timestamp ?? "");
      expect(Date.parse(r.timestamp) - died).toBe(1500);
    });
    // The last death ends the match.
    expect(types(events).slice(-2)).toEqual(["SNAKE_DIED", "MATCH_FINISHED"]);

    // Every fruit is followed by its SCORE_CHANGED.
    const fruits = events.filter((e) => e.type === "FOOD_EATEN");
    expect(fruits.length).toBeGreaterThanOrEqual(10);
    let total = 0;
    for (const f of fruits) {
      const next = events[events.indexOf(f) + 1];
      const points = data<{ points: number }>(f).points;
      total += points;
      expect(next).toMatchObject({ type: "SCORE_CHANGED", data: { delta: points, total } });
    }
    expect(events.at(-1)?.data).toMatchObject({
      results: [{ playerId: "p-kev", placement: 1 }],
      finalScore: total,
    });

    // A level every 5 fruits, with the speed of the policy.
    const levels = events.filter((e) => e.type === "LEVEL_UP");
    expect(levels.length).toBe(Math.floor(fruits.length / 5));
    expect(data<{ level: number; speed: number }>(levels[0])).toEqual({ level: 2, speed: 1.07 });
    const fifth = fruits[4];
    expect(events[events.indexOf(fifth as AnyGameEvent) + 2]?.type).toBe("LEVEL_UP");
  });

  it("powers: their duration, and DOUBLE_POINTS doubles the fruits while it lasts", () => {
    const { game, outlet } = snake({ autoplay: true }, 3);
    game.start();
    vi.advanceTimersByTime(30 * 60_000);
    const events = outlet.events;
    const picked = events.filter((e) => e.type === "POWERUP_PICKED");
    expect(picked.length).toBeGreaterThan(0);
    const durations = { SPEED: 5000, SLOW: 5000, SHIELD: 8000, DOUBLE_POINTS: 8000 };
    for (const p of picked) {
      const d = data<{ powerup: keyof typeof durations; durationMs: number }>(p);
      expect(d.durationMs).toBe(durations[d.powerup]);
    }
    const base = { APPLE: 10, GOLDEN: 30, BONUS: 50 };
    let doubleUntil = 0;
    for (const e of events) {
      const at = Date.parse(e.timestamp);
      if (e.type === "SNAKE_DIED") doubleUntil = 0; // a death ends the powers
      if (e.type === "POWERUP_PICKED" && data<{ powerup: string }>(e).powerup === "DOUBLE_POINTS") {
        doubleUntil = at + 8000;
      }
      if (e.type === "FOOD_EATEN") {
        const f = data<{ foodType: keyof typeof base; points: number }>(e);
        expect(f.points).toBe(base[f.foodType] * (at < doubleUntil ? 2 : 1));
      }
    }
  });

  it("the same seed gives the same match", () => {
    const play = () => {
      const { game, outlet } = snake({ autoplay: true }, 21);
      game.start();
      vi.advanceTimersByTime(30 * 60_000);
      return outlet.events.map((e) => [e.type, JSON.stringify(e.data)]);
    };
    expect(play()).toEqual(play());
  });

  it("a person's snake moves only while it has the focus", () => {
    const { game } = snake();
    game.start();
    const head = game.snake.head;
    vi.advanceTimersByTime(1000);
    expect(game.snake.head).toEqual(head);
    expect(game.paused).toBe(true);
    game.setFocused(true);
    vi.advanceTimersByTime(450); // three ticks of 150 ms
    expect(game.snake.head).toEqual({ x: head.x + 3, y: head.y });
    game.setFocused(false);
    vi.advanceTimersByTime(1000);
    expect(game.snake.head).toEqual({ x: head.x + 3, y: head.y });
  });

  it("hitting the wall: SNAKE_DIED (WALL), respawn after 1.5 s", () => {
    const { game, outlet } = snake();
    game.start();
    game.setFocused(true);
    game.turn("UP");
    vi.advanceTimersByTime(150 * 11); // from row 10 up to row 0, then the wall
    expect(outlet.events.at(-1)).toMatchObject({
      type: "SNAKE_DIED",
      playerId: "p-kev",
      data: { cause: "WALL", length: 3, livesLeft: 2 },
    });
    expect(game.dead).toBe(true);
    expect(game.turn("DOWN")).toBe(false); // not a move while dead
    vi.advanceTimersByTime(1500);
    expect(outlet.events.at(-1)).toMatchObject({
      type: "PLAYER_RESPAWNED",
      data: { livesLeft: 2 },
    });
    expect(game.snake.head).toEqual(game.grid.center());
  });

  it("closing mid-match ends it and stops the loop", () => {
    const { game, outlet } = snake({ autoplay: true });
    game.start();
    vi.advanceTimersByTime(3000);
    game.abandon("QUIT");
    const count = outlet.events.length;
    vi.advanceTimersByTime(60_000);
    expect(outlet.events).toHaveLength(count);
    expect(types(outlet.events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
    expectValid(outlet.events);
  });
});

describe("Two snakes in one console", () => {
  function console2(autoplay: { seed: number } | null) {
    const out = outlets();
    const m = new InstanceManager({
      registry: new GameRegistry().register(snakeDefinition),
      outlet: out.create,
      source: { consoleId: CONSOLE_ID, sessionId: "tab-1" },
      human: () => HumanPlayer.named("Kev"),
      clock: { now: () => Date.now() },
      autoplay,
    });
    const a = m.open("snake");
    const b = m.open("snake");
    return { m, a: a.game as SnakeGame, b: b.game as SnakeGame, ids: [a.id, b.id] as const };
  }

  it("only the focused one moves and takes the turns", () => {
    const { m, a, b, ids } = console2(null);
    const startA = a.snake.head;
    const startB = b.snake.head;
    vi.advanceTimersByTime(300);
    expect(a.snake.head).toEqual(startA); // b has the focus
    expect(b.snake.head).not.toEqual(startB);
    m.focus(ids[0]);
    const bNow = b.snake.head;
    vi.advanceTimersByTime(300);
    expect(a.snake.head).not.toEqual(startA);
    expect(b.snake.head).toEqual(bNow);
  });

  it("in autoplay both run at the same time and finish with their own events", () => {
    const { a, b } = console2({ seed: 4 });
    vi.advanceTimersByTime(30 * 60_000);
    expect([a.status, b.status]).toEqual(["FINISHED", "FINISHED"]);
    expect(a.matchId).not.toBe(b.matchId);
  });
});
