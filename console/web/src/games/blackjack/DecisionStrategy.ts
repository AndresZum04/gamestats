import type { BlackjackAction } from "@gameconsole/shared";
import type { Card } from "./Card.js";
import type { Hand } from "./Hand.js";
import type { ShoeComposition } from "./Shoe.js";

export interface BetContext {
  round: number;
  chips: number;
  minBet: number;
  maxBet: number;
  shoe: ShoeComposition;
}

export interface DecisionContext {
  round: number;
  hand: Hand;
  dealerUpcard: Card;
  canDouble: boolean;
  shoe: ShoeComposition;
}

/**
 * Who decides for a seat. Both methods are asynchronous because a person
 * answers with buttons and the Prolog AI (C14) answers over the network; the
 * table waits for the seat on turn without blocking other instances.
 */
export interface DecisionStrategy {
  /** Bet of the round, between minBet and maxBet; the table adjusts it to the rules. */
  bet(context: BetContext): Promise<number>;
  decide(context: DecisionContext): Promise<BlackjackAction>;
  /** True if a person decides (the view shows buttons for this seat). */
  readonly human: boolean;
}

/** Waits for the buttons of the view: the person on turn bets and decides. */
export class HumanDecision implements DecisionStrategy {
  readonly human = true;
  #pendingBet: ((amount: number) => void) | null = null;
  #pendingAction: ((action: BlackjackAction) => void) | null = null;

  /** What the person must do now: "BET", "DECIDE" or nothing. */
  get waitingFor(): "BET" | "DECIDE" | null {
    if (this.#pendingBet) return "BET";
    if (this.#pendingAction) return "DECIDE";
    return null;
  }

  bet(): Promise<number> {
    return new Promise((resolve) => (this.#pendingBet = resolve));
  }

  decide(): Promise<BlackjackAction> {
    return new Promise((resolve) => (this.#pendingAction = resolve));
  }

  submitBet(amount: number): boolean {
    const resolve = this.#pendingBet;
    if (resolve === null) return false;
    this.#pendingBet = null;
    resolve(amount);
    return true;
  }

  submit(action: BlackjackAction): boolean {
    const resolve = this.#pendingAction;
    if (resolve === null) return false;
    this.#pendingAction = null;
    resolve(action);
    return true;
  }
}

/**
 * Temporary CPU strategy of C12, a simplified basic strategy; C14 replaces it
 * with the Prolog AI. Bets the minimum twice (20). Doubles 10 or 11 against a
 * dealer card of 2 to 9; with a hard hand hits under 12, hits 12 to 16 against
 * 7 or more, and stands otherwise; with a soft hand hits up to 17.
 */
export class BasicStrategy implements DecisionStrategy {
  readonly human = false;

  bet({ minBet }: BetContext): Promise<number> {
    return Promise.resolve(minBet * 2);
  }

  decide(context: DecisionContext): Promise<BlackjackAction> {
    return Promise.resolve(BasicStrategy.choose(context));
  }

  static choose({ hand, dealerUpcard, canDouble }: DecisionContext): BlackjackAction {
    const value = hand.value;
    const up = dealerUpcard.points;
    if (canDouble && (value === 10 || value === 11) && up <= 9) return "DOUBLE";
    if (hand.soft) return value <= 17 ? "HIT" : "STAND";
    if (value < 12) return "HIT";
    if (value <= 16) return up >= 7 ? "HIT" : "STAND";
    return "STAND";
  }
}
