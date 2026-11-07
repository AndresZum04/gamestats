import { describe, expect, it } from "vitest";
import { MatchContext } from "../../src/core/MatchContext.js";

const at = (ms: number) => ({ now: () => ms });

describe("MatchContext", () => {
  it("builds the matchId from the game prefix, the start time and a random part", () => {
    const ctx = new MatchContext("blackjack", at(1_700_000_000_000), () => "x81fq2");
    expect(ctx.matchId).toBe(`bj-${(1_700_000_000_000).toString(36)}-x81fq2`);
    expect(new MatchContext("trivia").matchId).toMatch(/^tv-[0-9a-z]+-[0-9a-z]{6}$/);
    expect(new MatchContext("snake").matchId).toMatch(/^sn-[0-9a-z]+-[0-9a-z]{6}$/);
  });

  it("gives two matches started at the same time different ids", () => {
    const ids = new Set(
      Array.from({ length: 200 }, () => new MatchContext("snake", at(0)).matchId),
    );
    expect(ids.size).toBe(200);
  });

  it("numbers events from 1 and stops after finish()", () => {
    const ctx = new MatchContext("trivia");
    expect(ctx.lastSeq).toBe(0);
    expect([ctx.nextSeq(), ctx.nextSeq(), ctx.nextSeq()]).toEqual([1, 2, 3]);
    ctx.finish();
    expect(ctx.finished).toBe(true);
    expect(() => ctx.nextSeq()).toThrow(/finished/);
    expect(ctx.lastSeq).toBe(3);
  });

  it("measures the time since the start", () => {
    let now = 1000;
    const ctx = new MatchContext("snake", { now: () => now });
    now = 4500;
    expect(ctx.elapsedMs()).toBe(3500);
  });
});
