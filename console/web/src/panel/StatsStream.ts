import type { StatsSnapshot } from "./types.js";

type Listener = (snapshot: StatsSnapshot | null, connected: boolean) => void;

/**
 * The connection to GET /api/stats/stream (Server-Sent Events). The browser
 * reconnects by itself when the stream drops; meanwhile `connected` is false
 * and the panel keeps the last snapshot.
 */
export class StatsStream {
  readonly #source: EventSource;
  readonly #listeners = new Set<Listener>();
  #latest: StatsSnapshot | null = null;
  #connected = false;

  constructor(url = "/api/stats/stream") {
    this.#source = new EventSource(url);
    this.#source.onopen = () => this.#set(true);
    this.#source.onerror = () => this.#set(false);
    this.#source.onmessage = (e: MessageEvent<string>) => {
      try {
        this.#latest = JSON.parse(e.data) as StatsSnapshot;
        this.#set(true);
      } catch {
        // a broken line is ignored; the next one comes in 2 s
      }
    };
  }

  get latest(): StatsSnapshot | null {
    return this.#latest;
  }
  get connected(): boolean {
    return this.#connected;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#latest, this.#connected);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    this.#source.close();
    this.#listeners.clear();
  }

  #set(connected: boolean): void {
    this.#connected = connected;
    for (const l of this.#listeners) l(this.#latest, connected);
  }
}
