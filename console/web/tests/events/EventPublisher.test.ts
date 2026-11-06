import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPublisher } from "../../src/events/EventPublisher.js";
import { Outbox } from "../../src/events/Outbox.js";
import { OutboxRecovery } from "../../src/events/OutboxRecovery.js";
import { FakeTransport, MemoryStore, range, seqs, triviaMatch } from "./fakes.js";

const clock = { now: () => Date.now() };

function setup(store = new MemoryStore(), transport = new FakeTransport(), owner = "tab-a") {
  const match = triviaMatch();
  const outbox = new Outbox(match.matchId, store);
  const publisher = new EventPublisher(transport, outbox, { owner, clock });
  publisher.publish(match.started);
  return { match, outbox, publisher, store, transport };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-06T20:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("EventPublisher", () => {
  it("with the transport failing 3 times, every event arrives once and in order", async () => {
    const { match, publisher, transport, store, outbox } = setup();
    transport.failNext = 3;
    for (let i = 0; i < 44; i++) {
      publisher.publish(match.next());
      await vi.advanceTimersByTimeAsync(250); // the game keeps playing while it fails
    }
    const done = publisher.close();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(seqs(transport.delivered)).toEqual(range(1, 45));
    // the failed attempts: one at once, then after 1 s and 2 s; the 4th one works
    const times = transport.calls.slice(0, 4).map((c) => c.at - (transport.calls[0]?.at ?? 0));
    expect(times).toEqual([0, 1000, 3000, 7000]);
    expect(publisher.failures).toBe(0);
    expect(store.getItem(outbox.key)).toBeNull();
  });

  it("never has two requests of the same match in flight", async () => {
    const { match, publisher, transport } = setup();
    transport.delayMs = 300;
    for (let i = 0; i < 80; i++) {
      publisher.publish(match.next());
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(transport.maxByMatch.get(match.matchId)).toBe(1);
    expect(transport.calls.length).toBeGreaterThan(1);
    expect(seqs(transport.delivered)).toEqual(range(1, 81));
  });

  it("two publishers of different matches send in parallel", async () => {
    const transport = new FakeTransport();
    transport.delayMs = 300;
    const store = new MemoryStore();
    const a = setup(store, transport);
    const b = setup(store, transport);
    await vi.advanceTimersByTimeAsync(600); // both sent at 500 ms, both still in flight
    expect(transport.inFlight).toBe(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(transport.maxInFlight).toBe(2);
    expect(transport.maxByMatch.get(a.match.matchId)).toBe(1);
    expect(transport.maxByMatch.get(b.match.matchId)).toBe(1);
    expect(transport.delivered.map((e) => e.matchId).sort()).toEqual(
      [a.match.matchId, b.match.matchId].sort(),
    );
  });

  it("sends after 500 ms, or right away once 20 events are waiting", async () => {
    const { match, publisher, transport } = setup();
    for (let i = 0; i < 18; i++) publisher.publish(match.next());
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.calls.map((c) => c.events.length)).toEqual([19]);

    for (let i = 0; i < 20; i++) publisher.publish(match.next());
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.calls.map((c) => c.events.length)).toEqual([19, 20]);
  });

  it("waits 1, 2, 4, 8 and 16 s after each failure and then every 30 s", async () => {
    const { publisher, transport } = setup();
    transport.failNext = 100;
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000 + 8000 + 16000 + 30000 + 30000);
    const at = transport.calls.map((c) => c.at);
    const gaps = at.slice(1).map((t, i) => t - (at[i] ?? 0));
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(publisher.failures).toBe(8);
    expect(publisher.pending).toBe(1);
  });

  it("keeps the pending events in the outbox, owned by its tab", async () => {
    const { match, publisher, transport, store, outbox } = setup();
    transport.failNext = 1;
    publisher.publish(match.next());
    const entry = outbox.load();
    expect(entry?.owner).toBe("tab-a");
    expect(seqs(entry?.events ?? [])).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(seqs(transport.delivered)).toEqual([1, 2]);
    expect(store.getItem(outbox.key)).toBeNull();
  });

  it("hands the pending events to sendBeacon and keeps them in the outbox", () => {
    const { match, publisher, transport, outbox } = setup();
    publisher.publish(match.next());
    expect(publisher.beacon()).toBe(true);
    expect(seqs(transport.beacons[0] ?? [])).toEqual([1, 2]);
    expect(outbox.load()?.events).toHaveLength(2);
  });

  it("refuses events after close() and events of another match", () => {
    const { match, publisher } = setup();
    expect(() => publisher.publish(triviaMatch().next())).toThrow(/sent to the publisher/);
    void publisher.close();
    expect(() => publisher.publish(match.next())).toThrow(/closed/);
  });
});

describe("OutboxRecovery", () => {
  it("after a reload, sends the events a closed tab left, once and in order", async () => {
    const store = new MemoryStore();
    const down = new FakeTransport();
    down.failNext = 1000;
    const tab = setup(store, down, "tab-a");
    for (let i = 0; i < 9; i++) tab.publisher.publish(tab.match.next());
    await vi.advanceTimersByTimeAsync(3000);
    tab.publisher.dispose(); // the tab closes with 10 events unconfirmed
    expect(tab.outbox.load()?.events).toHaveLength(10);

    const up = new FakeTransport();
    const recovery = new OutboxRecovery(store, up, { owner: "tab-b", clock });
    expect(recovery.recover()).toHaveLength(0); // too recent: the tab could still be open

    await vi.advanceTimersByTimeAsync(120_000);
    const resumed = recovery.recover();
    expect(resumed.map((p) => p.matchId)).toEqual([tab.match.matchId]);
    expect(recovery.recover()).toHaveLength(0); // already being sent
    await vi.advanceTimersByTimeAsync(1000);

    expect(seqs(up.delivered)).toEqual(range(1, 10));
    expect(store.getItem(tab.outbox.key)).toBeNull();
  });

  it("leaves the outboxes of its own tab and drops unreadable ones", async () => {
    const store = new MemoryStore();
    const transport = new FakeTransport();
    transport.failNext = 1000;
    const own = setup(store, transport, "tab-b");
    store.setItem("outbox:bj-broken", "{not json");
    await vi.advanceTimersByTimeAsync(300_000);

    const recovery = new OutboxRecovery(store, new FakeTransport(), { owner: "tab-b", clock });
    expect(recovery.recover()).toHaveLength(0);
    expect(store.getItem(own.outbox.key)).not.toBeNull();
    expect(store.getItem("outbox:bj-broken")).toBeNull();
  });
});
