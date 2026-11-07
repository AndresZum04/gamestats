import type { Card } from "./Card.js";

/**
 * The cards of a player or of the house. Its value counts every ace as 11 and
 * lowers aces to 1 one by one while the total is over 21. A hand is soft when
 * an ace still counts 11.
 */
export class Hand {
  readonly #cards: Card[] = [];

  add(card: Card): void {
    this.#cards.push(card);
  }

  get cards(): readonly Card[] {
    return this.#cards;
  }
  get size(): number {
    return this.#cards.length;
  }

  #total(): { value: number; soft: boolean } {
    let value = 0;
    let aces = 0;
    for (const card of this.#cards) {
      value += card.points;
      if (card.rank === "A") aces += 1;
    }
    while (value > 21 && aces > 0) {
      value -= 10;
      aces -= 1;
    }
    return { value, soft: aces > 0 };
  }

  get value(): number {
    return this.#total().value;
  }
  get soft(): boolean {
    return this.#total().soft;
  }
  /** 21 with the first two cards. */
  get blackjack(): boolean {
    return this.#cards.length === 2 && this.value === 21;
  }
  get bust(): boolean {
    return this.value > 21;
  }
}
