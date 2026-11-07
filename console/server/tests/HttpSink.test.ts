import { describe, expect, it } from "vitest";
import { HttpSink } from "../src/events/HttpSink.js";
import { event } from "./helpers.js";

/** A fetch that answers each call with the next status of `statuses`. */
function fakeFetch(...statuses: number[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const status = statuses[Math.min(calls.length, statuses.length) - 1] ?? 500;
    const body = status === 202 ? JSON.stringify({ accepted: 1, rejected: 0, errors: [] }) : null;
    return new Response(body, { status });
  };
  return { fn: fn as typeof fetch, calls };
}

const events = [event("trivia", "tv-1", 1)];

describe("HttpSink", () => {
  it("posts the events to the ingestor and retries 503 until a 202", async () => {
    const f = fakeFetch(503, 503, 202);
    const sink = new HttpSink("http://ingestor:8080", { fetch: f.fn, backoffMs: [1, 1, 1] });
    await sink.write("trivia", "tv-1", events);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]?.url).toBe("http://ingestor:8080/api/v1/events");
    expect(f.calls[0]?.body).toEqual(events);
  });

  it("fails after its retries, and at once on a 400", async () => {
    const down = fakeFetch(503);
    const sink = new HttpSink("http://i", { fetch: down.fn, backoffMs: [1, 1, 1] });
    await expect(sink.write("trivia", "tv-1", events)).rejects.toThrow(/503/);
    expect(down.calls).toHaveLength(4);

    const bad = fakeFetch(400);
    await expect(
      new HttpSink("http://i", { fetch: bad.fn, backoffMs: [1, 1, 1] }).write(
        "trivia",
        "tv-1",
        events,
      ),
    ).rejects.toThrow(/400/);
    expect(bad.calls).toHaveLength(1);
  });

  it("retries a network error", async () => {
    let n = 0;
    const flaky = (async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), {
        status: 202,
      });
    }) as typeof fetch;
    await new HttpSink("http://i", { fetch: flaky, backoffMs: [1] }).write(
      "trivia",
      "tv-1",
      events,
    );
    expect(n).toBe(2);
  });
});
