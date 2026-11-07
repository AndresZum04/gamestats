import type { GameDefinition } from "../../console/GameRegistry.js";
import type { AiClient } from "./AiClient.js";
import { BlackjackGame } from "./BlackjackGame.js";
import { BlackjackView } from "./BlackjackView.js";

/** Blackjack, with its CPU played by `ai` (the Prolog service) when there is one. */
export function blackjackDefinition(ai?: AiClient): GameDefinition<"blackjack"> {
  return {
    id: "blackjack",
    title: "Blackjack",
    description: "Diez rondas contra la casa, con 1 a 3 jugadores CPU que deciden en Prolog.",
    create: (setup) =>
      new BlackjackGame(setup.human, setup, {
        autoplay: setup.autoplay,
        ...(ai === undefined ? {} : { ai }),
      }),
    createView: (game) => {
      if (!(game instanceof BlackjackGame)) {
        throw new Error("the blackjack view needs a BlackjackGame");
      }
      return new BlackjackView(game);
    },
  };
}
