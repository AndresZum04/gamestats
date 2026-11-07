import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EventSink } from "./EventSink.js";

/**
 * Appends one line per event to EVENTS_DIR/<gameId>/<matchId>.jsonl, the
 * contract of GameStats' file source: one file per match, only appended, one
 * event per line ending in \n, UTF-8 without BOM. The whole batch goes in one
 * appendFile, so the ingestor never reads half of it as complete lines.
 */
export class FileSink implements EventSink {
  readonly kind = "file";
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async write(gameId: string, matchId: string, events: readonly unknown[]): Promise<void> {
    if (events.length === 0) return;
    const folder = join(this.#dir, gameId);
    await mkdir(folder, { recursive: true });
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(join(folder, `${matchId}.jsonl`), lines, "utf8");
  }
}
