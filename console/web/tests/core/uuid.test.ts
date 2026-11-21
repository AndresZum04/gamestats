import { afterEach, describe, expect, it, vi } from "vitest";
import { uuidV4 } from "../../src/core/uuid.js";

// The eventId pattern of schemas/event.schema.json.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uuidV4", () => {
  it("gives the UUID v4 that GameStats expects, never the same twice", () => {
    const ids = Array.from({ length: 2000 }, () => uuidV4());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("works without crypto.randomUUID, as over plain HTTP on the Azure VM", () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    expect(uuidV4()).toMatch(UUID_V4);
  });
});
