import type { HandOutcome } from "@gameconsole/shared";
import type { Player } from "../../core/Player.js";
import type { DecisionStrategy } from "./DecisionStrategy.js";
import { Hand } from "./Hand.js";

/** PLAYING: still deciding. STOOD: waits for the house. BUST and BLACKJACK end the turn. */
export type SeatState = "WAITING" | "PLAYING" | "STOOD" | "BUST" | "BLACKJACK";

export interface SeatResult {
  result: HandOutcome;
  payout: number;
}

/** A place at the table: a player, who decides for them, their chips and this round's hand. */
export class Seat {
  readonly player: Player;
  readonly strategy: DecisionStrategy;
  #chips: number;
  #bet = 0;
  #hand = new Hand();
  #doubled = false;
  #state: SeatState = "WAITING";
  #out = false;
  #last: SeatResult | null = null;

  constructor(player: Player, strategy: DecisionStrategy, chips: number) {
    this.player = player;
    this.strategy = strategy;
    this.#chips = chips;
  }

  get chips(): number {
    return this.#chips;
  }
  get bet(): number {
    return this.#bet;
  }
  get hand(): Hand {
    return this.#hand;
  }
  get doubled(): boolean {
    return this.#doubled;
  }
  get state(): SeatState {
    return this.#state;
  }
  /** Left the table (no chips, or the person left). */
  get out(): boolean {
    return this.#out;
  }
  /** Result of the last hand played, for the view. */
  get lastResult(): SeatResult | null {
    return this.#last;
  }
  /** Doubling: only with the first two cards and enough chips for a second bet. */
  get canDouble(): boolean {
    return this.#state === "PLAYING" && this.#hand.size === 2 && this.#chips >= this.#bet * 2;
  }

  newRound(): void {
    this.#hand = new Hand();
    this.#bet = 0;
    this.#doubled = false;
    this.#state = "WAITING";
    this.#last = null;
  }

  placeBet(amount: number): void {
    this.#bet = amount;
  }

  setState(state: SeatState): void {
    this.#state = state;
  }

  double(): void {
    this.#bet *= 2;
    this.#doubled = true;
  }

  settle(result: SeatResult): void {
    this.#chips += result.payout;
    this.#last = result;
  }

  leave(): void {
    this.#out = true;
  }
}
