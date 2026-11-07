import { GameRegistry } from "../console/GameRegistry.js";
import type { AiClient } from "./blackjack/AiClient.js";
import { blackjackDefinition } from "./blackjack/index.js";
import { snakeDefinition } from "./snake/index.js";
import { triviaDefinition } from "./trivia/index.js";

export interface RegistryOptions {
  /** The blackjack AI; without it the CPU play a basic strategy. */
  ai?: AiClient;
}

/** The games of the console. Adding a game is registering it here. */
export function createRegistry(options: RegistryOptions = {}): GameRegistry {
  return new GameRegistry()
    .register(triviaDefinition)
    .register(snakeDefinition)
    .register(blackjackDefinition(options.ai));
}
