import type { GameId } from "@gameconsole/shared";
import type { Game, GameDeps } from "../core/Game.js";
import type { HumanPlayer } from "../core/Player.js";

/** Draws a game and turns the person's input into calls to its methods. */
export interface GameView {
  mount(el: HTMLElement): void;
  render(): void;
  dispose(): void;
  /** A key pressed while this instance has the focus; true if it was used. */
  handleKey?(event: KeyboardEvent): boolean;
}

/** What a game needs to create a match. */
export interface GameSetup extends GameDeps {
  human: HumanPlayer;
  /** ?autoplay=1: a bot plays in the human's seat (tests and demo). */
  autoplay: boolean;
}

export interface GameDefinition<G extends GameId = GameId> {
  id: G;
  title: string;
  description: string;
  create(setup: GameSetup): Game<G>;
  createView(game: Game<G>): GameView;
}

/** gameId → how to create the game and its view. Adding a game is registering it here. */
export class GameRegistry {
  readonly #games = new Map<GameId, GameDefinition>();

  register<G extends GameId>(definition: GameDefinition<G>): this {
    if (this.#games.has(definition.id)) throw new Error(`${definition.id} is already registered`);
    this.#games.set(definition.id, definition as unknown as GameDefinition);
    return this;
  }

  get(id: GameId): GameDefinition | undefined {
    return this.#games.get(id);
  }

  has(id: string): id is GameId {
    return this.#games.has(id as GameId);
  }

  list(): GameDefinition[] {
    return [...this.#games.values()];
  }
}
