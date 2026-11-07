import type { GameDefinition } from "../../console/GameRegistry.js";
import { TriviaGame } from "./TriviaGame.js";
import { TriviaView } from "./TriviaView.js";

export const triviaDefinition: GameDefinition<"trivia"> = {
  id: "trivia",
  title: "Trivia",
  description: "Diez preguntas por turnos, de 2 a 6 jugadores entre personas y CPU.",
  create: (setup) => new TriviaGame(setup.human, setup, { autoplay: setup.autoplay }),
  createView: (game) => {
    if (!(game instanceof TriviaGame)) throw new Error("the trivia view needs a TriviaGame");
    return new TriviaView(game);
  },
};
