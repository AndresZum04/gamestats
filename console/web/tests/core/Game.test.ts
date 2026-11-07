import { describe, expect, it } from "vitest";
import { CONSOLE_ID } from "@gameconsole/shared";
import { HumanPlayer } from "../../src/core/Player.js";
import { Rng } from "../../src/core/Rng.js";
import { FakeOutlet, TestBot, TestGame, ana, types } from "./testGame.js";

const source = { consoleId: CONSOLE_ID, sessionId: "tab-1" };

function game() {
  const outlet = new FakeOutlet();
  let now = 1000;
  const clock = { now: () => now };
  const g = new TestGame([ana(), new TestBot("cpu-1", "CPU 1")], {
    outlet: () => outlet,
    source,
    clock,
    rng: new Rng(7),
  });
  return { g, outlet, advance: (ms: number) => (now += ms) };
}

describe("Game", () => {
  it("starts with MATCH_STARTED and one PLAYER_JOINED per player", () => {
    const { g, outlet } = game();
    expect(g.status).toBe("READY");
    g.start();
    expect(g.status).toBe("RUNNING");
    expect(types(outlet.events)).toEqual(["MATCH_STARTED", "PLAYER_JOINED", "PLAYER_JOINED"]);
    expect(outlet.events[0]).toMatchObject({
      seq: 1,
      matchId: g.matchId,
      data: { players: ["p-ana", "cpu-1"], mode: "CLASSIC", questions: 3 },
    });
    expect(outlet.events.map((e) => e.playerId)).toEqual([null, "p-ana", "cpu-1"]);
  });

  it("finishes with the results and closes the outlet", () => {
    const { g, outlet, advance } = game();
    g.start();
    g.answer("cpu-1");
    advance(5000);
    g.finish();
    const last = outlet.events.at(-1);
    expect(last?.type).toBe("MATCH_FINISHED");
    expect(last?.data).toEqual({
      durationMs: 5000,
      results: [
        { playerId: "cpu-1", placement: 1 },
        { playerId: "p-ana", placement: 2 },
      ],
    });
    expect(outlet.closed).toBe(true);
    g.answer("p-ana"); // nothing after MATCH_FINISHED
    expect(outlet.events.at(-1)?.type).toBe("MATCH_FINISHED");
  });

  it("abandon: PLAYER_LEFT for each person (not the bots), then MATCH_FINISHED", () => {
    const { g, outlet } = game();
    g.start();
    g.abandon("QUIT");
    expect(types(outlet.events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
    expect(outlet.events.at(-2)).toMatchObject({ playerId: "p-ana", data: { reason: "QUIT" } });
    expect(g.status).toBe("FINISHED");
    g.abandon("QUIT");
    expect(types(outlet.events).filter((t) => t === "MATCH_FINISHED")).toHaveLength(1);
  });

  it("abandoning before the start sends nothing", () => {
    const { g, outlet } = game();
    g.abandon("QUIT");
    expect(outlet.events).toEqual([]);
    expect(outlet.closed).toBe(true);
  });

  it("disconnects and reconnects the people once, with awayMs", () => {
    const { g, outlet } = game();
    g.start();
    g.reconnect(100); // not disconnected: nothing
    g.disconnect();
    g.disconnect();
    g.reconnect(12_000);
    expect(types(outlet.events).slice(3)).toEqual(["PLAYER_DISCONNECTED", "PLAYER_RECONNECTED"]);
    expect(outlet.events.at(-1)).toMatchObject({ playerId: "p-ana", data: { awayMs: 12_000 } });
  });

  it("counts inactivity from the last action", () => {
    const { g, advance } = game();
    g.start();
    advance(4000);
    expect(g.idleMs).toBe(4000);
    g.answer("p-ana");
    expect(g.idleMs).toBe(0);
  });
});

describe("HumanPlayer", () => {
  it("builds the GameStats id from the name", () => {
    expect(HumanPlayer.idFor("Andrés Zumbado")).toBe("p-andreszumbado");
    expect(HumanPlayer.idFor("  ")).toBe("p-jugador");
    expect(HumanPlayer.named("Sofí").id).toBe("p-sofi");
  });
});

describe("Rng", () => {
  it("repeats the sequence of a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it("int stays in range and shuffle keeps the items", () => {
    const rng = new Rng(3);
    const ints = Array.from({ length: 500 }, () => rng.int(1, 6));
    expect(Math.min(...ints)).toBe(1);
    expect(Math.max(...ints)).toBe(6);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...rng.shuffle(items)].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
