export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUITS = ["S", "H", "D", "C"] as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

/** The keys of the shoe's composition: J, Q and K count as "10" (what Prolog needs). */
export const VALUE_KEYS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

const SUIT_SYMBOL: Readonly<Record<Suit, string>> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** A playing card. Its code is the one GameStats uses: "10H", "KS", "AD". */
export class Card {
  readonly rank: Rank;
  readonly suit: Suit;

  constructor(rank: Rank, suit: Suit) {
    this.rank = rank;
    this.suit = suit;
  }

  /** "10H": rank and suit letter (S spades, H hearts, D diamonds, C clubs). */
  get code(): string {
    return `${this.rank}${this.suit}`;
  }

  /** What the card adds: an ace 11 (Hand lowers it to 1 if needed), figures 10. */
  get points(): number {
    if (this.rank === "A") return 11;
    if (this.rank === "J" || this.rank === "Q" || this.rank === "K") return 10;
    return Number(this.rank);
  }

  get valueKey(): ValueKey {
    return this.points === 11 ? "A" : (String(this.points) as ValueKey);
  }

  /** For the view: "10♥". */
  get label(): string {
    return `${this.rank}${SUIT_SYMBOL[this.suit]}`;
  }

  get red(): boolean {
    return this.suit === "H" || this.suit === "D";
  }

  static parse(code: string): Card {
    const rank = code.slice(0, -1) as Rank;
    const suit = code.slice(-1) as Suit;
    if (!RANKS.includes(rank) || !SUITS.includes(suit)) throw new Error(`bad card ${code}`);
    return new Card(rank, suit);
  }
}
