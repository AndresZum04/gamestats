import type { GameId } from "@gameconsole/shared";

/** What the lobby shows of each game, registered or not yet. */
export const GAME_CATALOG: readonly { id: GameId; title: string; description: string }[] = [
  {
    id: "trivia",
    title: "Trivia",
    description:
      "Diez preguntas de cultura general por turnos, de 2 a 6 jugadores entre personas y CPU.",
  },
  {
    id: "snake",
    title: "Snake",
    description: "Comé frutas, crecé y evitá chocar. Tres vidas.",
  },
  {
    id: "blackjack",
    title: "Blackjack",
    description: "Diez rondas contra la casa, con jugadores CPU que deciden en Prolog.",
  },
];
