import type { Card } from "./Card.js";
import { Hand } from "./Hand.js";

/** The house: hits up to 17 and stands on any 17, soft 17 included. */
export class Dealer {
  #hand = new Hand();
  #revealed = false;

  get hand(): Hand {
    return this.#hand;
  }
  /** The face-up card, the one players see. */
  get upcard(): Card | undefined {
    return this.#hand.cards[0];
  }
  /** False while the second card is face down (until the house's turn). */
  get revealed(): boolean {
    return this.#revealed;
  }

  newRound(): void {
    this.#hand = new Hand();
    this.#revealed = false;
  }

  take(card: Card): void {
    this.#hand.add(card);
  }

  reveal(): void {
    this.#revealed = true;
  }

  /** Below 17 it hits; on 17 or more, soft or hard, it stands. */
  get mustHit(): boolean {
    return this.#hand.value < 17;
  }
}
