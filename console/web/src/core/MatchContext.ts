import { MATCH_PREFIX, type GameId } from "@gameconsole/shared";
import { systemClock, type Clock } from "./Clock.js";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Six random lowercase letters or digits, from the browser's crypto. */
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

/**
 * Identity and counter of one match. It is the only place that assigns `seq`,
 * so two events of the same match never share a number. Once the match is
 * finished it hands out no more numbers: GameStats would reject any event after
 * MATCH_FINISHED as LATE_EVENT.
 */
export class MatchContext<G extends GameId = GameId> {
  readonly gameId: G;
  readonly matchId: string;
  readonly clock: Clock;
  readonly startedAt: number;
  #seq = 0;
  #finished = false;

  constructor(gameId: G, clock: Clock = systemClock, suffix: () => string = randomSuffix) {
    this.gameId = gameId;
    this.clock = clock;
    this.startedAt = clock.now();
    // For example bj-lz3k9a-x81fq2: game prefix, start time in base 36, random part.
    this.matchId = `${MATCH_PREFIX[gameId]}-${this.startedAt.toString(36)}-${suffix()}`;
  }

  /** The seq of the last event, 0 before the first one. */
  get lastSeq(): number {
    return this.#seq;
  }

  get finished(): boolean {
    return this.#finished;
  }

  /** The seq of the next event: 1, 2, 3... */
  nextSeq(): number {
    if (this.#finished) throw new Error(`match ${this.matchId} is finished`);
    this.#seq += 1;
    return this.#seq;
  }

  /** Called after MATCH_FINISHED; nextSeq fails from then on. */
  finish(): void {
    this.#finished = true;
  }

  /** Milliseconds since the match started (durationMs of MATCH_FINISHED). */
  elapsedMs(): number {
    return this.clock.now() - this.startedAt;
  }
}
