import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_ID, type AnyGameEvent } from "@gameconsole/shared";
import { HumanPlayer } from "../../../src/core/Player.js";
import { Rng } from "../../../src/core/Rng.js";
import {
  HttpAiClient,
  type AiBetQuery,
  type AiClient,
  type AiDecisionQuery,
} from "../../../src/games/blackjack/AiClient.js";
import { BlackjackGame } from "../../../src/games/blackjack/BlackjackGame.js";
import { BasicStrategy } from "../../../src/games/blackjack/DecisionStrategy.js";
import { Card } from "../../../src/games/blackjack/Card.js";
import { Hand } from "../../../src/games/blackjack/Hand.js";
import { PrologBlackjackPlayer } from "../../../src/games/blackjack/PrologDecision.js";
import { FakeOutlet } from "../../core/testGame.js";

/** An AI that plays the basic strategy, with made-up EVs, and records the queries. */
class FakeAi implements AiClient {
  decisions: AiDecisionQuery[] = [];
  bets: AiBetQuery[] = [];
  decision(q: AiDecisionQuery) {
    this.decisions.push(q);
    const hand = new Hand();
    for (const c of q.hand) hand.add(Card.parse(c));
    const action = BasicStrategy.choose({
      round: 1,
      hand,
      dealerUpcard: Card.parse(q.dealerUpcard),
      canDouble: q.canDouble,
      shoe: q.shoe,
    });
    return Promise.resolve({
      decision: action,
      evHit: -0.1,
      evStand: -0.2,
      evDouble: q.canDouble ? -0.3 : null,
      reason: "fake",
    });
  }
  bet(q: AiBetQuery) {
    this.bets.push(q);
    return Promise.resolve({ amount: 40, trueCount: 2.1, reason: "conteo verdadero +2.1" });
  }
}

/** Prolog switched off: every query fails. */
const downAi: AiClient = {
  decision: () => Promise.reject(new Error("AI answered 503")),
  bet: () => Promise.reject(new Error("AI answered 503")),
};

function table(ai: AiClient) {
  const outlet = new FakeOutlet();
  const game = new BlackjackGame(
    HumanPlayer.named("Mari"),
    {
      outlet: () => outlet,
      source: { consoleId: CONSOLE_ID, sessionId: "tab-1" },
      clock: { now: () => Date.now() },
      rng: new Rng(8),
    },
    { autoplay: true, ai },
  );
  return { game, outlet };
}

const cpu = (e: AnyGameEvent) => e.playerId?.startsWith("cpu-") ?? false;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CPU with Prolog", () => {
  it("each CPU move is an AI_DECISION followed by its DECISION, and the bet comes from the AI", async () => {
    const ai = new FakeAi();
    const { game, outlet } = table(ai);
    expect(game.players.slice(1).every((p) => p instanceof PrologBlackjackPlayer)).toBe(true);
    game.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(game.status).toBe("FINISHED");
    const events = outlet.events;

    const decisions = events.filter((e) => e.type === "DECISION" && cpu(e));
    const ai_ = events.filter((e) => e.type === "AI_DECISION");
    expect(ai_.length).toBe(decisions.length);
    expect(ai_.length).toBeGreaterThan(0);
    for (const e of ai_) {
      const next = events[events.indexOf(e) + 1];
      expect(next).toMatchObject({ type: "DECISION", playerId: e.playerId });
      const data = e.data as Record<string, unknown>;
      expect(data.decision).toBe(next?.action);
      expect(data.handValue).toBe((next?.data as { handValue: number }).handValue);
      expect(data).toMatchObject({ evHit: -0.1, evStand: -0.2, fallback: false });
      expect(typeof data.dealerUpcard).toBe("string");
      expect(typeof data.elapsedMs).toBe("number");
    }
    // The person's seat (autoplay bot) does not ask Prolog.
    expect(events.filter((e) => e.type === "AI_DECISION" && !cpu(e))).toEqual([]);

    const cpuBets = events.filter((e) => e.type === "BET_PLACED" && cpu(e));
    expect(cpuBets.every((e) => (e.data as { amount: number }).amount === 40)).toBe(true);
    // The queries carry the hand, the face-up card and the shoe.
    const q = ai.decisions[0];
    expect(q?.hand.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(q?.shoe ?? {}).sort()).toEqual([
      "10",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
    ]);
    expect(ai.bets[0]).toMatchObject({ chips: 1000, minBet: 10, maxBet: 200 });
  });

  it("with Prolog off the match goes on: the CPU stand and AI_DECISION has fallback: true", async () => {
    const { game, outlet } = table(downAi);
    game.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(game.status).toBe("FINISHED");
    const events = outlet.events;
    expect(events.filter((e) => e.type === "ROUND_STARTED")).toHaveLength(10);
    const ai_ = events.filter((e) => e.type === "AI_DECISION");
    expect(ai_.length).toBeGreaterThan(0);
    for (const e of ai_) {
      expect(e.data).toMatchObject({ decision: "STAND", fallback: true });
      expect(e.data).not.toHaveProperty("evHit");
    }
    const cpuBets = events.filter((e) => e.type === "BET_PLACED" && cpu(e));
    expect(cpuBets.every((e) => (e.data as { amount: number }).amount === 10)).toBe(true);
    const seat = game.table?.seats[1];
    const strategy = seat?.player instanceof PrologBlackjackPlayer ? seat.player.strategy : null;
    expect(strategy?.lastDecision?.fallback).toBe(true);
  });
});

describe("HttpAiClient", () => {
  const reply = (status: number, body: unknown) =>
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  const query: AiDecisionQuery = {
    hand: ["10H", "6S"],
    dealerUpcard: "9D",
    shoe: {
      A: 24,
      "2": 24,
      "3": 24,
      "4": 24,
      "5": 24,
      "6": 24,
      "7": 24,
      "8": 24,
      "9": 24,
      "10": 96,
    },
    canDouble: false,
  };

  it("posts to the console server and reads Prolog's answer", async () => {
    const f = reply(200, {
      decision: "HIT",
      evHit: -0.51,
      evStand: -0.54,
      evDouble: null,
      reason: "r",
    });
    const client = new HttpAiClient({ fetch: f as unknown as typeof fetch });
    await expect(client.decision(query)).resolves.toEqual({
      decision: "HIT",
      evHit: -0.51,
      evStand: -0.54,
      evDouble: null,
      reason: "r",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/blackjack/decision");
    expect(JSON.parse(String(init.body))).toEqual(query);
  });

  it("rejects a 503 and an answer that is not a decision", async () => {
    const down = new HttpAiClient({ fetch: reply(503, { error: "x" }) as unknown as typeof fetch });
    await expect(down.decision(query)).rejects.toThrow(/503/);
    const odd = new HttpAiClient({
      fetch: reply(200, { decision: "SPLIT" }) as unknown as typeof fetch,
    });
    await expect(odd.decision(query)).rejects.toThrow(/unexpected/);
  });
});
