import type { GameDefinition } from "../../console/GameRegistry.js";
import { SnakeCanvasView } from "./SnakeCanvasView.js";
import { SnakeGame } from "./SnakeGame.js";

export const snakeDefinition: GameDefinition<"snake"> = {
  id: "snake",
  title: "Snake",
  description: "Comé frutas, crecé y evitá chocar. Tres vidas.",
  create: (setup) => new SnakeGame(setup.human, setup, { autoplay: setup.autoplay }),
  createView: (game) => {
    if (!(game instanceof SnakeGame)) throw new Error("the snake view needs a SnakeGame");
    return new SnakeCanvasView(game);
  },
};
