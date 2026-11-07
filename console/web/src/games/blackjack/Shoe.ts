import type { Rng } from "../../core/Rng.js";
import { Card, RANKS, SUITS, VALUE_KEYS, type ValueKey } from "./Card.js";

/** How many cards of each value are left in the shoe. */
export type ShoeComposition = Record<ValueKey, number>;

/**
 * The shoe: 6 decks shuffled together. When less than 25 % is left it is
 * rebuilt and shuffled again, between rounds. It knows how many cards of
 * each value remain, which the Prolog AI uses to compute probabilities (C14).
 */
export class Shoe {
  readonly decks: number;
  readonly reshuffleAt: number;
  readonly #rng: Rng;
  #cards: Card[] = [];
  #shuffles = 0;

  constructor(rng: Rng, decks = 6, reshuffleAt = 0.25) {
    this.decks = decks;
    this.reshuffleAt = reshuffleAt;
    this.#rng = rng;
    this.shuffle();
  }

  get size(): number {
    return this.decks * 52;
  }
  get remaining(): number {
    return this.#cards.length;
  }
  /** Times the shoe has been rebuilt (1 after the first shuffle). */
  get shuffles(): number {
    return this.#shuffles;
  }

  /** True when less than 25 % of the cards are left. */
  get needsShuffle(): boolean {
    return this.#cards.length < this.size * this.reshuffleAt;
  }

  /** All the decks back in, shuffled. */
  shuffle(): void {
    const cards: Card[] = [];
    for (let d = 0; d < this.decks; d++) {
      for (const suit of SUITS) for (const rank of RANKS) cards.push(new Card(rank, suit));
    }
    this.#cards = this.#rng.shuffle(cards);
    this.#shuffles += 1;
  }

  /** The next card; an empty shoe is rebuilt first (it does not happen with 25 %). */
  draw(): Card {
    if (this.#cards.length === 0) this.shuffle();
    const card = this.#cards.pop();
    if (card === undefined) throw new Error("empty shoe");
    return card;
  }

  composition(): ShoeComposition {
    const counts = Object.fromEntries(VALUE_KEYS.map((k) => [k, 0])) as ShoeComposition;
    for (const card of this.#cards) counts[card.valueKey] += 1;
    return counts;
  }
}
