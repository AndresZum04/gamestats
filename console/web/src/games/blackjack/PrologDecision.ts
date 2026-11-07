import type { BlackjackAction } from "@gameconsole/shared";
import { systemClock, type Clock } from "../../core/Clock.js";
import { BotPlayer } from "../../core/Player.js";
import type { AiClient } from "./AiClient.js";
import type {
  BetContext,
  Decision,
  DecisionContext,
  DecisionStrategy,
} from "./DecisionStrategy.js";

/** The last decision of a CPU, for AI_DECISION and the "Por qué jugó así" panel. */
export interface AiDecisionInfo {
  round: number;
  action: BlackjackAction;
  handValue: number;
  dealerUpcard: string;
  evHit?: number;
  evStand?: number;
  evDouble?: number;
  reason: string;
  elapsedMs: number;
  /** True when Prolog did not answer and the CPU stood as a fallback. */
  fallback: boolean;
}

export interface AiBetInfo {
  round: number;
  amount: number;
  trueCount?: number;
  reason: string;
  fallback: boolean;
}

/**
 * A CPU that decides with the Prolog AI. It sends its hand, the house's face
 * up card and what is left in the shoe; if Prolog does not answer it stands
 * (and bets the minimum), so the match always goes on.
 */
export class PrologDecision implements DecisionStrategy {
  readonly human = false;
  readonly #ai: AiClient;
  readonly #clock: Clock;
  #lastDecision: AiDecisionInfo | null = null;
  #lastBet: AiBetInfo | null = null;

  constructor(ai: AiClient, clock: Clock = systemClock) {
    this.#ai = ai;
    this.#clock = clock;
  }

  get lastDecision(): AiDecisionInfo | null {
    return this.#lastDecision;
  }
  get lastBet(): AiBetInfo | null {
    return this.#lastBet;
  }

  async bet({ round, chips, minBet, maxBet, shoe }: BetContext): Promise<number> {
    try {
      const a = await this.#ai.bet({ shoe, chips, minBet, maxBet });
      this.#lastBet = {
        round,
        amount: a.amount,
        trueCount: a.trueCount,
        reason: a.reason,
        fallback: false,
      };
      return a.amount;
    } catch {
      this.#lastBet = {
        round,
        amount: minBet,
        reason: "La IA no respondió: apuesta mínima de respaldo",
        fallback: true,
      };
      return minBet;
    }
  }

  async decide({ round, hand, dealerUpcard, canDouble, shoe }: DecisionContext): Promise<Decision> {
    const started = this.#clock.now();
    const base = { round, handValue: hand.value, dealerUpcard: dealerUpcard.code };
    let info: AiDecisionInfo;
    try {
      const a = await this.#ai.decision({
        hand: hand.cards.map((c) => c.code),
        dealerUpcard: dealerUpcard.code,
        shoe,
        canDouble,
      });
      // Prolog never doubles when it may not; if it did, hitting is the closest move.
      const action = a.decision === "DOUBLE" && !canDouble ? "HIT" : a.decision;
      info = {
        ...base,
        action,
        evHit: a.evHit,
        evStand: a.evStand,
        ...(a.evDouble === null ? {} : { evDouble: a.evDouble }),
        reason: a.reason,
        elapsedMs: this.#clock.now() - started,
        fallback: false,
      };
    } catch {
      info = {
        ...base,
        action: "STAND",
        reason: "La IA de Prolog no respondió: se planta como respaldo",
        elapsedMs: this.#clock.now() - started,
        fallback: true,
      };
    }
    this.#lastDecision = info;
    return { action: info.action, ai: info };
  }
}

/** A CPU seat played by Prolog: cpu-1, cpu-2, cpu-3. */
export class PrologBlackjackPlayer extends BotPlayer {
  readonly strategy: PrologDecision;

  constructor(n: number, ai: AiClient, clock?: Clock) {
    super(`cpu-${n}`, `CPU ${n}`);
    this.strategy = new PrologDecision(ai, clock);
  }
}
