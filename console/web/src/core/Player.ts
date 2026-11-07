/** Someone sitting at a game: a person or the computer. */
export abstract class Player {
  readonly id: string;
  readonly name: string;
  abstract readonly isBot: boolean;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
}

export class HumanPlayer extends Player {
  readonly isBot = false;

  /** The player id GameStats sees: p- and the name in lowercase without spaces or accents. */
  static idFor(name: string): string {
    const slug = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    return `p-${slug || "jugador"}`;
  }

  static named(name: string): HumanPlayer {
    return new HumanPlayer(HumanPlayer.idFor(name), name.trim() || "Jugador");
  }
}

/**
 * A player the computer controls. Each game has its own (TriviaBot,
 * PrologBlackjackPlayer...); the autoplay mode puts one in the human's seat.
 */
export abstract class BotPlayer extends Player {
  readonly isBot = true;
}
