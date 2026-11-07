import { describe, expect, it } from "vitest";
import { PrologClient } from "../src/ai/PrologClient.js";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

type Step = number | "timeout" | "network";

/** A fetch that answers each call with the next step: a status, a hang or a network error. */
function fakeProlog(...steps: Step[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const step = steps[Math.min(calls.length, steps.length) - 1] ?? 500;
    if (step === "network") throw new TypeError("fetch failed");
    if (step === "timeout") {
      // Waits until the AbortSignal of the client fires.
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("timeout"))),
      );
    }
    const body = step === 200 ? { decision: "HIT", evHit: -0.4 } : { error: "bad card" };
    return new Response(JSON.stringify(body), {
      status: step,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn: fn as typeof fetch, calls };
}

const query = { hand: ["10H", "6S"], dealerUpcard: "9D", shoe: { A: 24 }, canDouble: false };

describe("PrologClient", () => {
  it("retries twice after a timeout, a network error or a 5xx", async () => {
    const f = fakeProlog("timeout", "network", 200);
    const client = new PrologClient("http://prolog:4000/", { fetch: f.fn, timeoutMs: 20 });
    await expect(client.decision(query)).resolves.toEqual({
      status: 200,
      body: { decision: "HIT", evHit: -0.4 },
    });
    expect(f.calls.map((c) => c.url)).toEqual(
      Array(3).fill("http://prolog:4000/blackjack/decision"),
    );
    expect(f.calls[0]?.body).toEqual(query);
  });

  it("gives up after three attempts, and does not retry a 400", async () => {
    const down = fakeProlog(503);
    await expect(
      new PrologClient("http://p", { fetch: down.fn, timeoutMs: 20 }).bet({}),
    ).rejects.toThrow(/blackjack\/bet failed: status 503/);
    expect(down.calls).toHaveLength(3);

    const bad = fakeProlog(400);
    await expect(new PrologClient("http://p", { fetch: bad.fn }).decision({})).resolves.toEqual({
      status: 400,
      body: { error: "bad card" },
    });
    expect(bad.calls).toHaveLength(1);
  });
});

describe("POST /api/ai/blackjack/*", () => {
  const app = (...steps: Step[]) => {
    const f = fakeProlog(...steps);
    const prolog = new PrologClient("http://prolog:4000", { fetch: f.fn, timeoutMs: 20 });
    return { app: buildApp(testConfig(), { prolog }), calls: f.calls };
  };

  it("forwards the decision to Prolog and returns its answer", async () => {
    const { app: a, calls } = app(200);
    const res = await a.inject({
      method: "POST",
      url: "/api/ai/blackjack/decision",
      payload: query,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ decision: "HIT", evHit: -0.4 });
    expect(calls[0]?.body).toEqual(query);
  });

  it("passes Prolog's 400 through and refuses a body that is not an object", async () => {
    const { app: a } = app(400);
    const res = await a.inject({ method: "POST", url: "/api/ai/blackjack/bet", payload: query });
    expect(res.statusCode).toBe(400);
    const notObject = await a.inject({
      method: "POST",
      url: "/api/ai/blackjack/bet",
      payload: [1, 2],
    });
    expect(notObject.statusCode).toBe(400);
  });

  it("answers 503 when Prolog is down, so the browser uses its fallback", async () => {
    const { app: a, calls } = app("network");
    const res = await a.inject({
      method: "POST",
      url: "/api/ai/blackjack/decision",
      payload: query,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "prolog unavailable" });
    expect(calls).toHaveLength(3);
  });
});
