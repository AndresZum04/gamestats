import type { BlackjackAction } from "@gameconsole/shared";
import type { ShoeComposition } from "./Shoe.js";

export interface AiDecisionQuery {
  hand: string[];
  dealerUpcard: string;
  shoe: ShoeComposition;
  canDouble: boolean;
}

/** What prolog/server.pl answers to a decision. */
export interface AiDecisionAnswer {
  decision: BlackjackAction;
  evHit: number;
  evStand: number;
  evDouble: number | null;
  reason: string;
}

export interface AiBetQuery {
  shoe: ShoeComposition;
  chips: number;
  minBet: number;
  maxBet: number;
}

export interface AiBetAnswer {
  amount: number;
  trueCount: number;
  reason: string;
}

/** Asks the blackjack AI. Rejects when there is no valid answer (the caller falls back). */
export interface AiClient {
  decision(query: AiDecisionQuery): Promise<AiDecisionAnswer>;
  bet(query: AiBetQuery): Promise<AiBetAnswer>;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The AI through the console server (POST /api/ai/blackjack/...), which
 * forwards to Prolog with its own timeout and retries. This is the only part
 * of blackjack that touches the network; the game logic only sees AiClient.
 */
export class HttpAiClient implements AiClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: { base?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.#base = options.base ?? "/api/ai/blackjack";
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    // The server tries Prolog up to 3 times of 2 s; past that it is down.
    this.#timeoutMs = options.timeoutMs ?? 8000;
  }

  async decision(query: AiDecisionQuery): Promise<AiDecisionAnswer> {
    const a = await this.#post("decision", query);
    const ok =
      (a.decision === "HIT" || a.decision === "STAND" || a.decision === "DOUBLE") &&
      isNumber(a.evHit) &&
      isNumber(a.evStand) &&
      (a.evDouble === null || isNumber(a.evDouble));
    if (!ok) throw new Error("unexpected answer of the AI");
    return {
      decision: a.decision as BlackjackAction,
      evHit: a.evHit as number,
      evStand: a.evStand as number,
      evDouble: a.evDouble as number | null,
      reason: typeof a.reason === "string" ? a.reason : "",
    };
  }

  async bet(query: AiBetQuery): Promise<AiBetAnswer> {
    const a = await this.#post("bet", query);
    if (!isNumber(a.amount) || !isNumber(a.trueCount))
      throw new Error("unexpected answer of the AI");
    return {
      amount: a.amount,
      trueCount: a.trueCount,
      reason: typeof a.reason === "string" ? a.reason : "",
    };
  }

  async #post(path: string, query: unknown): Promise<Record<string, unknown>> {
    const res = await this.#fetch(`${this.#base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res.ok) throw new Error(`AI answered ${res.status}`);
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) throw new Error("unexpected answer of the AI");
    return body as Record<string, unknown>;
  }
}
