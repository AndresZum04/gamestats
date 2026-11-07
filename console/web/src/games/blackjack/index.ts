import type { GameDefinition } from "../../console/GameRegistry.js";
import { BlackjackGame } from "./BlackjackGame.js";
import { BlackjackView } from "./BlackjackView.js";

export const blackjackDefinition: GameDefinition<"blackjack"> = {
  id: "blackjack",
  title: "Blackjack",
  description: "Diez rondas contra la casa, con 1 a 3 jugadores CPU.",
  create: (setup) => new BlackjackGame(setup.human, setup, { autoplay: setup.autoplay }),
  createView: (game) => {
    if (!(game instanceof BlackjackGame))
      throw new Error("the blackjack view needs a BlackjackGame");
    return new BlackjackView(game);
  },
};
