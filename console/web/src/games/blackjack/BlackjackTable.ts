import type { Rng } from "../../core/Rng.js";
import type { Card } from "./Card.js";
import { Dealer } from "./Dealer.js";
import type { Hand } from "./Hand.js";
import type { Seat, SeatResult } from "./Seat.js";
import { Shoe } from "./Shoe.js";

export const STARTING_CHIPS = 1000;
export const ROUNDS = 10;
export const MIN_BET = 10;
export const MAX_BET = 200;

/**
 * The table: a shoe, the house and the seats, by composition. It knows the
 * rules (bets, payouts) but not the order of a round or the events; that is in
 * BlackjackGame.
 */
export class BlackjackTable {
  readonly shoe: Shoe;
  readonly dealer = new Dealer();
  readonly seats: readonly Seat[];

  constructor(seats: readonly Seat[], rng: Rng) {
    this.seats = seats;
    this.shoe = new Shoe(rng);
  }

  /** Seats still at the table. */
  get active(): Seat[] {
    return this.seats.filter((s) => !s.out);
  }

  /** Between rounds: clears the hands and rebuilds the shoe if under 25 %. */
  newRound(): void {
    if (this.shoe.needsShuffle) this.shoe.shuffle();
    this.dealer.newRound();
    for (const seat of this.seats) seat.newRound();
  }

  /**
   * A valid bet: a multiple of 10 between 10 and 200 and never more than the
   * chips. With multiples of 10 a blackjack pays a whole number (3:2).
   */
  static adjustBet(amount: number, chips: number): number {
    const top = Math.min(MAX_BET, Math.floor(chips / MIN_BET) * MIN_BET);
    const rounded = Math.round(amount / MIN_BET) * MIN_BET;
    return Math.max(MIN_BET, Math.min(top, rounded));
  }

  /** A seat can play another round if it has at least the minimum bet. */
  static canPlay(chips: number): boolean {
    return chips >= MIN_BET;
  }

  dealTo(hand: Hand): Card {
    const card = this.shoe.draw();
    hand.add(card);
    return card;
  }

  /**
   * Result and net payout of one hand against the house:
   * a bust loses; a blackjack pays 3:2 unless the house also has one (push);
   * if the house has blackjack every other hand loses; otherwise the higher
   * total wins, the house going over 21 pays every hand still standing, and a
   * tie is a push.
   */
  static settle(hand: Hand, bet: number, house: Hand): SeatResult {
    if (hand.bust) return { result: "LOSE", payout: -bet };
    if (hand.blackjack) {
      return house.blackjack
        ? { result: "PUSH", payout: 0 }
        : { result: "WIN", payout: (bet * 3) / 2 };
    }
    if (house.blackjack) return { result: "LOSE", payout: -bet };
    if (house.bust || hand.value > house.value) return { result: "WIN", payout: bet };
    if (hand.value < house.value) return { result: "LOSE", payout: -bet };
    return { result: "PUSH", payout: 0 };
  }
}
