import type { BlackjackAction, MatchStartedData, Placement } from "@gameconsole/shared";
import { systemClock } from "../../core/Clock.js";
import { Game, type GameDeps } from "../../core/Game.js";
import { BotPlayer, type HumanPlayer, type Player } from "../../core/Player.js";
import { BlackjackTable, MAX_BET, MIN_BET, ROUNDS, STARTING_CHIPS } from "./BlackjackTable.js";
import type { AiClient } from "./AiClient.js";
import { BasicStrategy, HumanDecision, type DecisionStrategy } from "./DecisionStrategy.js";
import { PrologBlackjackPlayer } from "./PrologDecision.js";
import { Seat } from "./Seat.js";

export const MIN_CPUS = 1;
export const MAX_CPUS = 3;

export type BlackjackPhase = "SETUP" | "BETTING" | "PLAYING" | "DEALER" | "RESULTS" | "DONE";

/** A CPU player of blackjack (cpu-1, cpu-2, cpu-3). */
export class BlackjackBot extends BotPlayer {
  static numbered(n: number): BlackjackBot {
    return new BlackjackBot(`cpu-${n}`, `CPU ${n}`);
  }
}

export interface BlackjackOptions {
  /** ?autoplay=1: the person's seat plays alone, with 3 CPU and no start screen. */
  autoplay?: boolean;
  /** The Prolog AI: with it the CPU are PrologBlackjackPlayer; without it they use cpuStrategy. */
  ai?: AiClient;
  /** Who decides for each CPU when there is no AI (tests); BasicStrategy by default. */
  cpuStrategy?: (bot: Player) => DecisionStrategy;
  /** Visual pause before each CPU decision (400 to 800 ms in the plan). */
  thinkMs?: readonly [number, number];
  /** Pause between the house's cards. */
  dealerPauseMs?: number;
  /** How long the results of a round stay on screen. */
  resultsPauseMs?: number;
}

export interface Standing {
  playerId: string;
  chips: number;
  placement: number;
}

/**
 * A blackjack match: the person and 1 to 3 CPU against the house, 1000 chips,
 * 10 rounds, bets from 10 to 200. Rules in BlackjackTable; this class plays the
 * rounds in order and emits their events:
 *
 * ROUND_STARTED, a BET_PLACED per seat, two CARD_DEALT per seat and two
 * DEALER_CARD (the second one hidden), BLACKJACK where there is one, then each
 * seat's DECISION (with HIT, STAND or DOUBLE in `action`), CARD_DEALT and BUST,
 * the house's DEALER_CARD, a HAND_RESULT per seat and PLAYER_LEFT (NO_CHIPS)
 * for a seat left with less than the minimum bet. The table goes on without it.
 *
 * Seats decide through a DecisionStrategy, which may take time (a person, or
 * Prolog). The round awaits it; other instances keep running. Each move of a
 * Prolog CPU emits AI_DECISION (what the AI computed) before its DECISION.
 */
export class BlackjackGame extends Game<"blackjack"> {
  readonly #host: HumanPlayer;
  readonly #autoplay: boolean;
  readonly #cpuStrategy: (bot: Player) => DecisionStrategy;
  readonly #cpu: (n: number) => BotPlayer;
  readonly #thinkMs: readonly [number, number];
  readonly #dealerPauseMs: number;
  readonly #resultsPauseMs: number;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #needsSetup: boolean;
  #table: BlackjackTable | null = null;
  #phase: BlackjackPhase = "SETUP";
  #round = 0;
  #turn: Seat | null = null;

  constructor(host: HumanPlayer, deps: GameDeps, options: BlackjackOptions = {}) {
    const autoplay = options.autoplay ?? false;
    const ai = options.ai;
    const clock = deps.clock ?? systemClock;
    const cpu = (n: number): BotPlayer =>
      ai ? new PrologBlackjackPlayer(n, ai, clock) : BlackjackBot.numbered(n);
    const bots = autoplay ? [1, 2, 3].map(cpu) : [];
    super("blackjack", [host, ...bots], deps);
    this.#cpu = cpu;
    this.#host = host;
    this.#autoplay = autoplay;
    this.#cpuStrategy = options.cpuStrategy ?? (() => new BasicStrategy());
    this.#thinkMs = options.thinkMs ?? [400, 800];
    this.#dealerPauseMs = options.dealerPauseMs ?? (autoplay ? 200 : 600);
    this.#resultsPauseMs = options.resultsPauseMs ?? (autoplay ? 600 : 2500);
    this.#needsSetup = !autoplay;
  }

  /** The start screen's choice: how many CPU sit with the person. */
  startWith(cpus: number): void {
    if (!Number.isInteger(cpus) || cpus < MIN_CPUS || cpus > MAX_CPUS) {
      throw new Error(`from ${MIN_CPUS} to ${MAX_CPUS} CPU`);
    }
    const bots = Array.from({ length: cpus }, (_, i) => this.#cpu(i + 1));
    this.setPlayers([this.#host, ...bots]);
    this.#needsSetup = false;
    this.start();
  }

  override get awaitingSetup(): boolean {
    return this.#needsSetup;
  }

  // ---- What the view reads ------------------------------------------------

  get host(): HumanPlayer {
    return this.#host;
  }
  get phase(): BlackjackPhase {
    return this.#phase;
  }
  get round(): number {
    return this.#round;
  }
  get rounds(): number {
    return ROUNDS;
  }
  get table(): BlackjackTable | null {
    return this.#table;
  }
  /** The seat whose bet or decision the round is waiting for. */
  get turn(): Seat | null {
    return this.#turn;
  }
  /** What the person must do now, if anything. */
  get waitingFor(): "BET" | "DECIDE" | null {
    const strategy = this.#turn?.strategy;
    return strategy instanceof HumanDecision ? strategy.waitingFor : null;
  }
  get limits(): { minBet: number; maxBet: number } {
    return { minBet: MIN_BET, maxBet: MAX_BET };
  }

  standings(): Standing[] {
    const seats = this.#table?.seats ?? [];
    const chips = (id: string) => seats.find((s) => s.player.id === id)?.chips ?? STARTING_CHIPS;
    const sorted = this.players.map((p) => p.id).sort((a, b) => chips(b) - chips(a));
    return sorted.map((playerId) => ({
      playerId,
      chips: chips(playerId),
      placement: 1 + sorted.filter((o) => chips(o) > chips(playerId)).length,
    }));
  }

  // ---- What the view calls ------------------------------------------------

  placeBet(amount: number): boolean {
    const strategy = this.#turn?.strategy;
    return strategy instanceof HumanDecision && strategy.submitBet(amount);
  }

  act(action: BlackjackAction): boolean {
    const seat = this.#turn;
    const strategy = seat?.strategy;
    if (!(strategy instanceof HumanDecision) || seat === null) return false;
    if (action === "DOUBLE" && !seat.canDouble) return false;
    return strategy.submit(action);
  }

  // ---- Game ---------------------------------------------------------------

  protected startData(): MatchStartedData<"blackjack"> {
    const bots = this.players.filter((p) => p.isBot).map((p) => p.id);
    return {
      players: this.players.map((p) => p.id),
      mode: "TABLE",
      startingChips: STARTING_CHIPS,
      rounds: ROUNDS,
      ...(bots.length > 0 ? { bots } : {}),
    };
  }

  protected onStart(): void {
    const seats = this.players.map((p) => new Seat(p, this.#strategyFor(p), STARTING_CHIPS));
    this.#table = new BlackjackTable(seats, this.rng.fork());
    this.#run().catch((error: unknown) => console.error("blackjack match stopped", error));
  }

  protected buildResults(): Placement[] {
    return this.standings().map(({ playerId, placement }) => ({ playerId, placement }));
  }

  protected override onFinish(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#phase = "DONE";
    this.#turn = null;
  }

  // ---- The rounds ---------------------------------------------------------

  #strategyFor(player: Player): DecisionStrategy {
    if (player instanceof PrologBlackjackPlayer) return player.strategy;
    if (player.isBot) return this.#cpuStrategy(player);
    return this.#autoplay ? new BasicStrategy() : new HumanDecision();
  }

  /** Still running: a closed window stops the round at its next step. */
  #alive(): boolean {
    return this.status === "RUNNING";
  }

  async #run(): Promise<void> {
    const table = this.#table;
    if (table === null) return;
    for (let round = 1; round <= ROUNDS; round++) {
      if (!this.#alive() || table.active.length === 0) break;
      await this.#playRound(table, round);
    }
    if (this.#alive()) this.finish();
  }

  async #playRound(table: BlackjackTable, round: number): Promise<void> {
    table.newRound();
    this.#round = round;
    this.#phase = "BETTING";
    this.emit("ROUND_STARTED", { round });
    const seats = table.active;

    for (const seat of seats) {
      this.#turn = seat;
      this.changed();
      const asked = await seat.strategy.bet({
        round,
        chips: seat.chips,
        minBet: MIN_BET,
        maxBet: MAX_BET,
        shoe: table.shoe.composition(),
      });
      if (!this.#alive()) return;
      this.#acted(seat);
      const amount = BlackjackTable.adjustBet(asked, seat.chips);
      seat.placeBet(amount);
      this.emit(
        "BET_PLACED",
        { round, amount, chipsBefore: seat.chips },
        { playerId: seat.player.id },
      );
    }
    this.#turn = null;

    // Deal: one card each, the house's face up, a second each, the house's face down.
    for (const seat of seats) this.#deal(table, seat, round);
    this.#dealHouse(table, round, false);
    for (const seat of seats) this.#deal(table, seat, round);
    this.#dealHouse(table, round, true);
    for (const seat of seats) {
      if (seat.hand.blackjack) {
        seat.setState("BLACKJACK");
        this.emit("BLACKJACK", { round }, { playerId: seat.player.id });
      } else {
        seat.setState("PLAYING");
      }
    }

    this.#phase = "PLAYING";
    for (const seat of seats) {
      if (seat.state !== "PLAYING") continue;
      this.#turn = seat;
      this.changed();
      await this.#playSeat(table, seat, round);
      if (!this.#alive()) return;
    }
    this.#turn = null;

    // The house plays only if someone is still waiting for it.
    this.#phase = "DEALER";
    table.dealer.reveal();
    this.changed();
    if (seats.some((s) => s.state === "STOOD")) {
      while (table.dealer.mustHit) {
        await this.#sleep(this.#dealerPauseMs);
        if (!this.#alive()) return;
        this.#dealHouse(table, round, false);
        this.changed();
      }
    }

    this.#phase = "RESULTS";
    for (const seat of seats) {
      const result = BlackjackTable.settle(seat.hand, seat.bet, table.dealer.hand);
      seat.settle(result);
      this.emit(
        "HAND_RESULT",
        { round, result: result.result, payout: result.payout, chips: seat.chips },
        { playerId: seat.player.id },
      );
    }
    for (const seat of seats) {
      if (BlackjackTable.canPlay(seat.chips)) continue;
      seat.leave();
      this.playerLeft(seat.player.id, "NO_CHIPS");
    }
    this.changed();
    await this.#sleep(this.#resultsPauseMs);
  }

  /** One seat's turn: decisions until it stands, busts, doubles or reaches 21. */
  async #playSeat(table: BlackjackTable, seat: Seat, round: number): Promise<void> {
    const upcard = table.dealer.upcard;
    if (upcard === undefined) return;
    const playerId = seat.player.id;
    while (seat.state === "PLAYING") {
      if (seat.hand.value === 21) {
        seat.setState("STOOD"); // nothing to decide with 21
        break;
      }
      const asking = seat.strategy.decide({
        round,
        hand: seat.hand,
        dealerUpcard: upcard,
        canDouble: seat.canDouble,
        shoe: table.shoe.composition(),
      });
      // A CPU shows its move after 400 to 800 ms; the question to Prolog runs meanwhile.
      const pause = seat.strategy.human ? null : this.#sleep(this.rng.int(...this.#thinkMs));
      const [decision] = await Promise.all([asking, pause]);
      if (!this.#alive()) return;
      this.#acted(seat);
      let action = decision.action;
      if (action === "DOUBLE" && !seat.canDouble) action = "HIT";
      if (decision.ai) {
        // What Prolog computed, then the normal DECISION (so B1 to B5 do not change).
        const { evHit, evStand, evDouble, elapsedMs, fallback } = decision.ai;
        this.emit(
          "AI_DECISION",
          {
            round,
            decision: action,
            handValue: seat.hand.value,
            dealerUpcard: upcard.code,
            ...(evHit === undefined ? {} : { evHit }),
            ...(evStand === undefined ? {} : { evStand }),
            ...(evDouble === undefined ? {} : { evDouble }),
            elapsedMs,
            fallback,
          },
          { playerId },
        );
      }
      this.emit("DECISION", { round, handValue: seat.hand.value }, { playerId, action });

      if (action === "STAND") {
        seat.setState("STOOD");
      } else {
        if (action === "DOUBLE") seat.double();
        this.#deal(table, seat, round);
        if (seat.hand.bust) {
          seat.setState("BUST");
          this.emit("BUST", { round, handValue: seat.hand.value }, { playerId });
        } else if (action === "DOUBLE") {
          seat.setState("STOOD"); // doubling takes exactly one card
        }
      }
      this.changed();
    }
  }

  #deal(table: BlackjackTable, seat: Seat, round: number): void {
    const card = table.dealTo(seat.hand);
    this.emit(
      "CARD_DEALT",
      { round, card: card.code, handValue: seat.hand.value },
      { playerId: seat.player.id },
    );
  }

  /**
   * A card for the house. Like the GameStats simulator, the event carries the
   * real card and total even when it is face down: the log is for analysis and
   * the view is what hides it.
   */
  #dealHouse(table: BlackjackTable, round: number, hidden: boolean): void {
    const card = table.dealTo(table.dealer.hand);
    this.emit("DEALER_CARD", {
      round,
      card: card.code,
      hidden,
      dealerValue: table.dealer.hand.value,
    });
  }

  /** A person's bet or decision (or the autoplay bot in their seat) is activity. */
  #acted(seat: Seat): void {
    if (!seat.player.isBot) this.markActivity();
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        resolve();
      }, ms);
      this.#timers.add(timer);
    });
  }
}
