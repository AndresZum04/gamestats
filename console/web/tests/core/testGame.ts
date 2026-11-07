import type { AnyGameEvent, Placement } from "@gameconsole/shared";
import { Game, type EventOutlet, type GameDeps } from "../../src/core/Game.js";
import { BotPlayer, HumanPlayer, type Player } from "../../src/core/Player.js";
import type { GameDefinition, GameView } from "../../src/console/GameRegistry.js";

/** Records what a game sends. */
export class FakeOutlet implements EventOutlet {
  events: AnyGameEvent[] = [];
  closed = false;
  beacons = 0;
  publish(event: AnyGameEvent): void {
    if (this.closed) throw new Error("publish after close");
    this.events.push(event);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  beacon(): boolean {
    this.beacons += 1;
    return true;
  }
}

export class TestBot extends BotPlayer {}

/** The smallest real game: a trivia match where each answer() is worth 10 points. */
export class TestGame extends Game<"trivia"> {
  readonly scores = new Map<string, number>();
  focusLog: boolean[] = [];
  readonly firstRandom: number;

  constructor(players: Player[], deps: GameDeps) {
    super("trivia", players, deps);
    this.firstRandom = this.rng.next();
  }

  answer(playerId: string): void {
    const total = (this.scores.get(playerId) ?? 0) + 10;
    this.scores.set(playerId, total);
    this.scoreChanged(playerId, { delta: 10, total });
    this.markActivity();
  }

  override setFocused(focused: boolean): void {
    this.focusLog.push(focused);
  }

  protected startData() {
    return { players: this.players.map((p) => p.id), mode: "CLASSIC" as const, questions: 3 };
  }
  protected onStart(): void {}
  protected buildResults(): Placement[] {
    return [...this.players]
      .sort((a, b) => (this.scores.get(b.id) ?? 0) - (this.scores.get(a.id) ?? 0))
      .map((p, i) => ({ playerId: p.id, placement: i + 1 }));
  }
}

/** Outlets by matchId, to read what each instance sent. */
export function outlets() {
  const byMatch = new Map<string, FakeOutlet>();
  return {
    byMatch,
    create: (matchId: string) => {
      const outlet = new FakeOutlet();
      byMatch.set(matchId, outlet);
      return outlet;
    },
  };
}

const noView: GameView = { mount() {}, render() {}, dispose() {} };

export const testDefinition: GameDefinition<"trivia"> = {
  id: "trivia",
  title: "Trivia",
  description: "test",
  create: (setup) => new TestGame([setup.human, new TestBot("cpu-1", "CPU 1")], setup),
  createView: () => noView,
};

export const types = (events: readonly AnyGameEvent[]) => events.map((e) => e.type);
export const ana = () => HumanPlayer.named("Ana");
