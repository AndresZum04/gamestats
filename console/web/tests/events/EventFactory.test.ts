import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { CONSOLE_ID, type GameId } from "@gameconsole/shared";
import { MatchContext } from "../../src/core/MatchContext.js";
import { EventFactory, withoutUndefined } from "../../src/events/EventFactory.js";

const schemaPath = fileURLToPath(new URL("../../../../schemas/event.schema.json", import.meta.url));
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(schemaPath, "utf8")) as object,
);
const source = { consoleId: CONSOLE_ID, sessionId: "tab-1" };

function factory<G extends GameId>(game: G, now = Date.parse("2026-11-06T20:00:00.000Z")) {
  const ctx = new MatchContext(game, { now: () => now });
  return { ctx, events: new EventFactory(ctx, source) };
}

describe("EventFactory", () => {
  it("builds the GameStats envelope in its order", () => {
    const { ctx, events } = factory("trivia");
    const e = events.create("MATCH_STARTED", {
      players: ["p-ana"],
      mode: "CLASSIC",
      questions: 10,
    });
    expect(Object.keys(e)).toEqual([
      "schemaVersion",
      "eventId",
      "timestamp",
      "gameId",
      "gameVersion",
      "matchId",
      "seq",
      "playerId",
      "type",
      "source",
      "data",
    ]);
    expect(e).toMatchObject({
      schemaVersion: "1.0",
      timestamp: "2026-11-06T20:00:00.000Z",
      gameId: "trivia",
      gameVersion: "1.0",
      matchId: ctx.matchId,
      seq: 1,
      playerId: null,
      source,
    });
  });

  it("creates events that validate against schemas/event.schema.json", () => {
    const { events } = factory("blackjack");
    const created = [
      events.create("MATCH_STARTED", {
        players: ["p-andres", "cpu-1"],
        mode: "TABLE",
        startingChips: 1000,
        rounds: 10,
        bots: ["cpu-1"],
      }),
      events.create("PLAYER_JOINED", {}, { playerId: "p-andres" }),
      events.create(
        "DECISION",
        { round: 1, handValue: 11 },
        { playerId: "p-andres", action: "DOUBLE" },
      ),
      events.create(
        "AI_DECISION",
        { round: 1, decision: "STAND", handValue: 17, evStand: 0.12, fallback: false },
        { playerId: "cpu-1" },
      ),
      events.create("MATCH_FINISHED", {
        durationMs: 60000,
        results: [
          { playerId: "cpu-1", placement: 1 },
          { playerId: "p-andres", placement: 2 },
        ],
      }),
    ];
    for (const e of created) {
      expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(created.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(created[2]?.action).toBe("DOUBLE");
    expect(new Set(created.map((e) => e.eventId)).size).toBe(created.length);
  });

  it("drops undefined keys at any depth", () => {
    const { events } = factory("snake");
    events.create("MATCH_STARTED", { players: ["p-kev"], mode: "CLASSIC", lives: 3 });
    // A value built at runtime can carry undefined even if the type says it cannot.
    const results = [{ playerId: "p-kev", placement: 1, teamId: undefined as unknown as string }];
    const e = events.create("MATCH_FINISHED", { durationMs: 1, results, finalScore: 40 });
    expect(e.data).toEqual({
      durationMs: 1,
      results: [{ playerId: "p-kev", placement: 1 }],
      finalScore: 40,
    });
    expect("teamId" in (e.data.results[0] ?? {})).toBe(false);
    expect(withoutUndefined({ a: 1, b: undefined, c: [{ d: undefined }] })).toEqual({
      a: 1,
      c: [{}],
    });
  });

  it("refuses events out of order or without their player", () => {
    const { ctx, events } = factory("snake");
    expect(() => events.create("FOOD_EATEN", { foodType: "APPLE", length: 4, points: 10 })).toThrow(
      /must be the first event/,
    );
    events.create("MATCH_STARTED", { players: ["p-kev"], mode: "CLASSIC", lives: 3 });
    expect(() =>
      events.create("MATCH_STARTED", { players: ["p-kev"], mode: "CLASSIC", lives: 3 }),
    ).toThrow(/must be the first event/);
    expect(() => events.create("FOOD_EATEN", { foodType: "APPLE", length: 4, points: 10 })).toThrow(
      /needs a playerId/,
    );
    events.create("MATCH_FINISHED", {
      durationMs: 10,
      results: [{ playerId: "p-kev", placement: 1 }],
    });
    expect(ctx.finished).toBe(true);
    expect(() => events.create("PLAYER_LEFT", { reason: "QUIT" }, { playerId: "p-kev" })).toThrow(
      /finished/,
    );
  });
});
