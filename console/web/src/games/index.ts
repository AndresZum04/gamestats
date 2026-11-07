import { GameRegistry } from "../console/GameRegistry.js";
import { blackjackDefinition } from "./blackjack/index.js";
import { snakeDefinition } from "./snake/index.js";
import { triviaDefinition } from "./trivia/index.js";

/** The games of the console. Adding a game is registering it here. */
export function createRegistry(): GameRegistry {
  return new GameRegistry()
    .register(triviaDefinition)
    .register(snakeDefinition)
    .register(blackjackDefinition);
}
