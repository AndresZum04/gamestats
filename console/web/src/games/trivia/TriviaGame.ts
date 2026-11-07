import type { AnswerOption, MatchStartedData, Placement } from "@gameconsole/shared";
import { Game, type GameDeps } from "../../core/Game.js";
import { HumanPlayer, type Player } from "../../core/Player.js";
import type { Question } from "./Question.js";
import { defaultBank, QUESTIONS_PER_MATCH, type QuestionBank } from "./QuestionBank.js";
import { Scoreboard, type Standing } from "./Scoreboard.js";
import { botAnswer, TriviaBot } from "./TriviaBot.js";
import { TriviaRound } from "./TriviaRound.js";

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

/** A seat of the start screen after the host's: another person or a CPU. */
export type SeatChoice = { kind: "person"; name: string } | { kind: "cpu" };

/** SETUP: start screen. TURN: someone must answer. REVEAL: the answer is shown. DONE: the end. */
export type TriviaPhase = "SETUP" | "TURN" | "REVEAL" | "DONE";

export interface TriviaOptions {
  bank?: QuestionBank;
  questions?: number;
  timeLimitMs?: number;
  /** How long the right answer stays on screen before the next question. */
  revealMs?: number;
  /** A bot answers after a random time in this range. */
  thinkMs?: readonly [number, number];
  /** ?autoplay=1: the host's seat answers alone, with two CPU, and no start screen. */
  autoplay?: boolean;
}

/** Accuracy of the bot that plays for the host in autoplay mode. */
const AUTOPLAY_ACCURACY = 0.7;

/**
 * A trivia match in hot seat mode: 2 to 6 players on the same screen, people
 * or CPU. Every question is answered by each player in turn, 15 s each; the
 * first player changes with each question so nobody always goes first.
 *
 * Events per question: QUESTION_SHOWN, then for each player ANSWER_SUBMITTED
 * and SCORE_CHANGED (or ANSWER_TIMEOUT), then QUESTION_CLOSED.
 */
export class TriviaGame extends Game<"trivia"> {
  readonly #host: HumanPlayer;
  readonly #questions: readonly Question[];
  readonly #timeLimitMs: number;
  readonly #revealMs: number;
  readonly #thinkMs: readonly [number, number];
  /** Players whose answers the computer chooses, with their accuracy. */
  readonly #auto = new Map<string, number>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #needsSetup: boolean;
  #phase: TriviaPhase = "SETUP";
  #scoreboard = new Scoreboard([]);
  #round: TriviaRound | null = null;
  #index = -1;
  #turnStartedAt = 0;

  constructor(host: HumanPlayer, deps: GameDeps, options: TriviaOptions = {}) {
    const autoplay = options.autoplay ?? false;
    const bots = autoplay ? [TriviaBot.numbered(1), TriviaBot.numbered(2)] : [];
    super("trivia", [host, ...bots], deps);
    this.#host = host;
    this.#questions = (options.bank ?? defaultBank).draw(
      options.questions ?? QUESTIONS_PER_MATCH,
      this.rng,
    );
    this.#timeLimitMs = options.timeLimitMs ?? 15_000;
    this.#revealMs = options.revealMs ?? (autoplay ? 800 : 2500);
    this.#thinkMs = options.thinkMs ?? (autoplay ? [300, 1000] : [1500, 6000]);
    this.#needsSetup = !autoplay;
    if (autoplay) this.#auto.set(host.id, AUTOPLAY_ACCURACY);
    for (const bot of bots) this.#auto.set(bot.id, bot.accuracy);
  }

  /**
   * What is wrong with the seats of the start screen, in Spanish for the view,
   * or null if they are fine. The host always has the first seat.
   */
  static checkSeats(host: HumanPlayer, seats: readonly SeatChoice[]): string | null {
    const total = seats.length + 1;
    if (total < MIN_SEATS || total > MAX_SEATS) {
      return `La partida necesita de ${MIN_SEATS} a ${MAX_SEATS} jugadores.`;
    }
    const ids = new Set([host.id]);
    for (const seat of seats) {
      if (seat.kind === "cpu") continue;
      if (seat.name.trim() === "") return "Cada persona necesita un nombre.";
      const id = HumanPlayer.idFor(seat.name);
      if (ids.has(id)) return `Hay dos jugadores llamados "${seat.name.trim()}".`;
      ids.add(id);
    }
    return null;
  }

  /** Seats the players chosen on the start screen and starts the match. */
  startWith(seats: readonly SeatChoice[]): void {
    const problem = TriviaGame.checkSeats(this.#host, seats);
    if (problem !== null) throw new Error(problem);
    let cpu = 0;
    const players: Player[] = [this.#host];
    for (const seat of seats) {
      if (seat.kind === "person") {
        players.push(HumanPlayer.named(seat.name));
      } else {
        const bot = TriviaBot.numbered(++cpu);
        this.#auto.set(bot.id, bot.accuracy);
        players.push(bot);
      }
    }
    this.setPlayers(players);
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
  get phase(): TriviaPhase {
    return this.#phase;
  }
  get round(): TriviaRound | null {
    return this.#round;
  }
  get totalQuestions(): number {
    return this.#questions.length;
  }
  get timeLimitMs(): number {
    return this.#timeLimitMs;
  }
  /** Time left for the player on turn. */
  get timeLeftMs(): number {
    if (this.#phase !== "TURN") return 0;
    return Math.max(0, this.#timeLimitMs - (this.clock.now() - this.#turnStartedAt));
  }
  /** The player on turn, if any. */
  get currentPlayer(): Player | undefined {
    const id = this.#round?.current;
    return this.players.find((p) => p.id === id);
  }
  /** True when the player on turn is a person who must press a button. */
  get waitingForPerson(): boolean {
    const id = this.#round?.current;
    return this.#phase === "TURN" && id !== undefined && !this.#auto.has(id);
  }
  standings(): Standing[] {
    return this.#scoreboard.standings();
  }

  // ---- What the view calls ------------------------------------------------

  /** The person on turn picks an option; false if it is not a person's turn. */
  answer(option: AnswerOption): boolean {
    if (!this.waitingForPerson) return false;
    this.#submit(option);
    return true;
  }

  // ---- Game ---------------------------------------------------------------

  protected startData(): MatchStartedData<"trivia"> {
    return {
      players: this.players.map((p) => p.id),
      mode: "CLASSIC",
      questions: this.#questions.length,
    };
  }

  protected onStart(): void {
    this.#scoreboard = new Scoreboard(this.players.map((p) => p.id));
    this.#nextQuestion();
  }

  protected buildResults(): Placement[] {
    return this.#scoreboard.placements();
  }

  protected override onFinish(): void {
    this.#clearTimers();
    this.#phase = "DONE";
  }

  // ---- Flow of the match --------------------------------------------------

  #nextQuestion(): void {
    this.#index += 1;
    const question = this.#questions[this.#index];
    if (question === undefined) {
      this.finish();
      return;
    }
    const ids = this.players.map((p) => p.id);
    const first = this.#index % ids.length;
    const order = [...ids.slice(first), ...ids.slice(0, first)];
    this.#round = new TriviaRound(question, this.#index + 1, order);
    this.#phase = "TURN";
    this.emit("QUESTION_SHOWN", {
      questionId: question.id,
      number: this.#index + 1,
      category: question.category,
      difficulty: question.difficulty,
      timeLimitMs: this.#timeLimitMs,
    });
    this.#beginTurn();
  }

  /** The player on turn gets 15 s; a CPU answers after "thinking" a moment. */
  #beginTurn(): void {
    const round = this.#round;
    const id = round?.current;
    if (round === null || id === undefined) return;
    this.#clearTimers();
    this.#turnStartedAt = this.clock.now();
    this.#later(this.#timeLimitMs, () => this.#timeout());
    const accuracy = this.#auto.get(id);
    if (accuracy !== undefined) {
      const [min, max] = this.#thinkMs;
      const option = botAnswer(round.question, accuracy, this.rng);
      this.#later(this.rng.int(min, max), () => this.#submit(option));
    }
    this.changed();
  }

  #submit(option: AnswerOption): void {
    const round = this.#round;
    const id = round?.current;
    if (round === null || id === undefined || this.status !== "RUNNING") return;
    this.#clearTimers();
    const responseMs = Math.min(this.clock.now() - this.#turnStartedAt, this.#timeLimitMs);
    const correct = round.isCorrect(option);
    const award = this.#scoreboard.award(id, correct, responseMs, this.#timeLimitMs);
    round.answer(id, option, award.delta);
    // A person answered (or the autoplay bot in their seat): they are not idle.
    if (!this.#isBot(id)) this.markActivity();
    this.emit(
      "ANSWER_SUBMITTED",
      { questionId: round.question.id, option, correct, responseMs },
      { playerId: id },
    );
    this.scoreChanged(id, award);
    this.#afterTurn();
  }

  #timeout(): void {
    const round = this.#round;
    const id = round?.current;
    if (round === null || id === undefined) return;
    round.timeout(id);
    this.emit("ANSWER_TIMEOUT", { questionId: round.question.id }, { playerId: id });
    this.#afterTurn();
  }

  /** Next player, or close the question, show the answer and go on. */
  #afterTurn(): void {
    const round = this.#round;
    if (round === null) return;
    if (!round.complete) {
      this.#beginTurn();
      return;
    }
    this.#clearTimers();
    this.emit("QUESTION_CLOSED", {
      questionId: round.question.id,
      correctOption: round.question.answer,
      correctCount: round.correctCount,
    });
    this.#phase = "REVEAL";
    this.#later(this.#revealMs, () => this.#nextQuestion());
    this.changed();
  }

  #isBot(id: string): boolean {
    return this.players.find((p) => p.id === id)?.isBot ?? false;
  }

  #later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      run();
    }, ms);
    this.#timers.add(timer);
  }

  #clearTimers(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }
}
