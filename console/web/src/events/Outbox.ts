import type { AnyGameEvent } from "@gameconsole/shared";

/** The part of the Web Storage API the outbox uses; tests pass a Map-based one. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIX = "outbox:";

/** What is stored under outbox:<matchId>. */
export interface OutboxEntry {
  /** sessionId of the tab that is sending these events. */
  owner: string;
  /** Last time the owner saved or tried to send (ms). */
  updatedAt: number;
  events: AnyGameEvent[];
}

/**
 * Copy in localStorage of the events of one match that the server has not
 * confirmed yet, so a network failure or a closed tab loses nothing. The key
 * exists only while there are pending events.
 */
export class Outbox {
  readonly matchId: string;
  readonly #store: KeyValueStore;

  constructor(matchId: string, store: KeyValueStore) {
    this.matchId = matchId;
    this.#store = store;
  }

  get key(): string {
    return PREFIX + this.matchId;
  }

  /** The stored entry, or null if there is none or it cannot be read. */
  load(): OutboxEntry | null {
    return Outbox.read(this.#store, this.key);
  }

  /**
   * Saves the pending events, or removes the key when there are none. A full
   * or blocked storage is not fatal: the events stay in memory and are still
   * sent; only the copy for a closed tab is lost.
   */
  save(owner: string, updatedAt: number, events: readonly AnyGameEvent[]): void {
    try {
      if (events.length === 0) this.#store.removeItem(this.key);
      else this.#store.setItem(this.key, JSON.stringify({ owner, updatedAt, events }));
    } catch {
      // QuotaExceededError or storage disabled: keep going without the copy.
    }
  }

  clear(): void {
    try {
      this.#store.removeItem(this.key);
    } catch {
      // nothing to clear
    }
  }

  /** matchIds of every outbox in the store. */
  static matchIds(store: KeyValueStore): string[] {
    const ids: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
    }
    return ids;
  }

  private static read(store: KeyValueStore, key: string): OutboxEntry | null {
    try {
      const raw = store.getItem(key);
      if (raw === null) return null;
      const entry = JSON.parse(raw) as Partial<OutboxEntry>;
      if (typeof entry.owner !== "string" || !Array.isArray(entry.events)) return null;
      return { owner: entry.owner, updatedAt: Number(entry.updatedAt) || 0, events: entry.events };
    } catch {
      return null;
    }
  }
}
