import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ID } from "@gameconsole/shared";
import { GameRegistry } from "../../src/console/GameRegistry.js";
import { InstanceManager } from "../../src/console/InstanceManager.js";
import { parseRoute } from "../../src/console/router.js";
import { TestGame, ana, outlets, testDefinition, types } from "../core/testGame.js";

function manager(autoplay: { seed: number } | null = null) {
  const out = outlets();
  const m = new InstanceManager({
    registry: new GameRegistry().register(testDefinition),
    outlet: out.create,
    source: { consoleId: CONSOLE_ID, sessionId: "tab-1" },
    human: ana,
    clock: { now: () => Date.now() },
    autoplay,
  });
  const sent = (i: number) => {
    const instance = m.instances[i];
    return instance ? (out.byMatch.get(instance.game.matchId)?.events ?? []) : [];
  };
  return { m, out, sent };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("InstanceManager", () => {
  it("opens three instances of the same game, each with its own matchId", () => {
    const { m, out } = manager();
    const opened = [m.open("trivia"), m.open("trivia"), m.open("trivia")];
    const ids = opened.map((i) => i.game.matchId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^tv-/);
      expect(out.byMatch.get(id)?.events[0]?.type).toBe("MATCH_STARTED");
    }
    expect(m.focused?.id).toBe(opened[2]?.id);
  });

  it("closing a window mid-game sends PLAYER_LEFT and MATCH_FINISHED", () => {
    const { m, out } = manager();
    const first = m.open("trivia");
    const second = m.open("trivia");
    m.close(second.id);
    const events = out.byMatch.get(second.game.matchId)?.events ?? [];
    expect(types(events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
    expect(events.at(-2)?.data).toEqual({ reason: "QUIT" });
    expect(m.instances.map((i) => i.id)).toEqual([first.id]);
    expect(m.focused?.id).toBe(first.id); // the keyboard moves to the one left
    expect(types(out.byMatch.get(first.game.matchId)?.events ?? [])).not.toContain("PLAYER_LEFT");
  });

  it("gives the keyboard to one instance at a time", () => {
    const { m } = manager();
    const a = m.open("trivia");
    const b = m.open("trivia");
    m.focus(a.id);
    expect((a.game as TestGame).focusLog.at(-1)).toBe(true);
    expect((b.game as TestGame).focusLog.at(-1)).toBe(false);
  });

  it("ends a match after 5 minutes without action, with PLAYER_LEFT (IDLE)", () => {
    const { m, sent } = manager();
    const idle = m.open("trivia");
    const busy = m.open("trivia");
    vi.advanceTimersByTime(4 * 60_000);
    (busy.game as TestGame).answer("p-ana");
    vi.advanceTimersByTime(60_000);
    m.checkIdle();
    expect(idle.game.status).toBe("FINISHED");
    expect(sent(0).at(-2)?.data).toEqual({ reason: "IDLE" });
    expect(busy.game.status).toBe("RUNNING");
  });

  it("a tab hidden for more than 10 s disconnects its players; a short look away does not", () => {
    const { m, sent } = manager();
    m.open("trivia");
    m.setVisible(false);
    vi.advanceTimersByTime(5000);
    m.setVisible(true);
    expect(types(sent(0))).not.toContain("PLAYER_DISCONNECTED");

    m.setVisible(false);
    vi.advanceTimersByTime(12_000);
    expect(types(sent(0)).at(-1)).toBe("PLAYER_DISCONNECTED");
    m.setVisible(true);
    expect(sent(0).at(-1)).toMatchObject({ type: "PLAYER_RECONNECTED", data: { awayMs: 12_000 } });
  });

  it("closing the tab ends every match (CLOSED_TAB) and hands it to sendBeacon", () => {
    const { m, out } = manager();
    m.open("trivia");
    m.open("trivia");
    m.closeTab();
    for (const outlet of out.byMatch.values()) {
      expect(types(outlet.events).slice(-2)).toEqual(["PLAYER_LEFT", "MATCH_FINISHED"]);
      expect(outlet.events.at(-2)?.data).toEqual({ reason: "CLOSED_TAB" });
      expect(outlet.beacons).toBe(1);
    }
  });

  it("autoplay gives each instance its own seed, the same on every run", () => {
    const run = () => {
      const { m } = manager({ seed: 9 });
      return [m.open("trivia"), m.open("trivia")].map((i) => (i.game as TestGame).firstRandom);
    };
    const [a, b] = run();
    expect(run()).toEqual([a, b]);
    expect(a).not.toBe(b);
  });

  it("refuses a game that is not registered", () => {
    expect(() => manager().m.open("snake")).toThrow(/not registered/);
  });
});

describe("parseRoute", () => {
  it("knows the lobby, a game and the panel", () => {
    expect(parseRoute("/")).toEqual({ name: "lobby" });
    expect(parseRoute("/play/snake")).toEqual({ name: "play", gameId: "snake" });
    expect(parseRoute("/play/snake/")).toEqual({ name: "play", gameId: "snake" });
    expect(parseRoute("/panel")).toEqual({ name: "panel" });
    expect(parseRoute("/play/../x")).toEqual({ name: "notFound", path: "/play/../x" });
  });
});
