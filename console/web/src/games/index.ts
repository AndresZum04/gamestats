import { GameRegistry } from "../console/GameRegistry.js";

/** The games of the console. Trivia (C10), Snake (C11) and Blackjack (C12) register here. */
export function createRegistry(): GameRegistry {
  return new GameRegistry();
}
