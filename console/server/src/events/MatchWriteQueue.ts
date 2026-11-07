/**
 * One chain of promises per match. Each write of a match starts after the
 * previous write of that same match ended (well or badly), so its lines never
 * interleave; writes of different matches run in parallel.
 */
export class MatchWriteQueue {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(matchId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(matchId) ?? Promise.resolve();
    // A failed write must not block the next one of the match.
    const next = previous.catch(() => undefined).then(task);
    this.#tails.set(matchId, next);
    // Forget the match once its chain is empty, so the map does not grow forever.
    void next
      .catch(() => undefined)
      .then(() => {
        if (this.#tails.get(matchId) === next) this.#tails.delete(matchId);
      });
    return next;
  }

  /** Matches with a write in progress or waiting. */
  get size(): number {
    return this.#tails.size;
  }
}
