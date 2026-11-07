import type { FoodType, PowerUpKind } from "@gameconsole/shared";
import { h } from "../../console/dom.js";
import type { GameView } from "../../console/GameRegistry.js";
import type { Direction } from "./Point.js";
import type { SnakeGame } from "./SnakeGame.js";

const KEYS: Readonly<Record<string, Direction>> = {
  arrowup: "UP",
  arrowdown: "DOWN",
  arrowleft: "LEFT",
  arrowright: "RIGHT",
  w: "UP",
  s: "DOWN",
  a: "LEFT",
  d: "RIGHT",
};

const POWER_NAME: Readonly<Record<PowerUpKind, string>> = {
  SPEED: "Velocidad",
  SLOW: "Lentitud",
  SHIELD: "Escudo",
  DOUBLE_POINTS: "Puntos dobles",
};
const POWER_LETTER: Readonly<Record<PowerUpKind, string>> = {
  SPEED: "V",
  SLOW: "L",
  SHIELD: "E",
  DOUBLE_POINTS: "2",
};

const CELL = 20;

/** Colors from the page's CSS variables, so the board follows the light or dark theme. */
function palette(el: Element) {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const food: Record<FoodType, string> = {
    APPLE: v("--danger", "#c23b3b"),
    GOLDEN: v("--focus", "#f0a400"),
    BONUS: v("--accent", "#2f6fed"),
  };
  return {
    board: v("--bg", "#f6f7f9"),
    grid: v("--border", "#d9dde5"),
    snake: v("--ok", "#1f8a4c"),
    head: v("--text", "#1c2230"),
    obstacle: v("--muted", "#5d6677"),
    shield: v("--accent", "#2f6fed"),
    text: v("--text", "#1c2230"),
    food,
  };
}

/**
 * Draws a snake match on a canvas and turns keys and on-screen buttons into
 * turns. It never moves the snake itself: it calls SnakeGame.turn and redraws
 * when the game says something changed.
 */
export class SnakeCanvasView implements GameView {
  readonly #game: SnakeGame;
  #el: HTMLElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #hud: HTMLElement | null = null;
  #message: HTMLElement | null = null;

  constructor(game: SnakeGame) {
    this.#game = game;
  }

  mount(el: HTMLElement): void {
    this.#el = el;
    const { grid } = this.#game;
    this.#canvas = h("canvas", {
      width: grid.width * CELL,
      height: grid.height * CELL,
      class: "snake-board",
      "aria-label": "Tablero de Snake",
    });
    this.#hud = h("p", { class: "snake-hud" });
    this.#message = h("p", { class: "snake-message", role: "status" });
    const pad = (label: string, direction: Direction, text: string) =>
      h(
        "button",
        {
          type: "button",
          "aria-label": label,
          class: `pad-${direction.toLowerCase()}`,
          onpointerdown: (e: Event) => {
            e.preventDefault();
            this.#game.turn(direction);
          },
        },
        text,
      );
    el.append(
      h(
        "div",
        { class: "snake" },
        this.#hud,
        h("div", { class: "snake-stage" }, this.#canvas, this.#message),
        h(
          "div",
          { class: "snake-pad", "aria-label": "Controles" },
          pad("Arriba", "UP", "▲"),
          pad("Izquierda", "LEFT", "◀"),
          pad("Abajo", "DOWN", "▼"),
          pad("Derecha", "RIGHT", "▶"),
        ),
        h("p", { class: "muted" }, "Flechas o WASD para moverte."),
      ),
    );
    this.render();
  }

  dispose(): void {
    this.#el?.replaceChildren();
    this.#el = null;
    this.#canvas = null;
  }

  handleKey(event: KeyboardEvent): boolean {
    const direction = KEYS[event.key.toLowerCase()];
    if (direction === undefined) return false;
    this.#game.turn(direction);
    return true; // keep the arrows from scrolling the page
  }

  render(): void {
    const game = this.#game;
    if (this.#hud) {
      const powers = game.effects
        .map((e) => `${POWER_NAME[e.kind]} ${Math.ceil(e.leftMs / 1000)} s`)
        .join(", ");
      this.#hud.textContent =
        `Puntos ${game.score} · Vidas ${game.livesLeft} · Nivel ${game.level} · Largo ${game.snake.length}` +
        (powers ? ` · ${powers}` : "");
    }
    if (this.#message) this.#message.textContent = this.#messageText();
    this.#draw();
  }

  #messageText(): string {
    const game = this.#game;
    if (game.status === "FINISHED") return `Partida terminada: ${game.score} puntos.`;
    if (game.dead) return `Perdiste una vida. Te quedan ${game.livesLeft}.`;
    if (game.paused) return "En pausa: tocá el tablero o «Enfocar» para seguir.";
    return "";
  }

  #draw(): void {
    const canvas = this.#canvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const game = this.#game;
    const c = palette(canvas);
    const cell = (x: number, y: number, inset = 1) =>
      ctx.fillRect(x * CELL + inset, y * CELL + inset, CELL - 2 * inset, CELL - 2 * inset);

    ctx.fillStyle = c.board;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    ctx.fillStyle = c.obstacle;
    for (const o of game.obstacles) cell(o.x, o.y, 0);

    const food = game.food;
    if (food) {
      ctx.fillStyle = c.food[food.type];
      ctx.beginPath();
      ctx.arc(
        food.at.x * CELL + CELL / 2,
        food.at.y * CELL + CELL / 2,
        CELL / 2 - 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    const power = game.powerUp;
    if (power) {
      ctx.fillStyle = c.text;
      ctx.font = `bold ${CELL - 4}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        POWER_LETTER[power.kind],
        power.at.x * CELL + CELL / 2,
        power.at.y * CELL + CELL / 2 + 1,
      );
    }

    const shielded = game.effects.some((e) => e.kind === "SHIELD");
    game.snake.body.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? c.head : c.snake;
      cell(p.x, p.y);
    });
    if (shielded) {
      const head = game.snake.head;
      ctx.strokeStyle = c.shield;
      ctx.lineWidth = 2;
      ctx.strokeRect(head.x * CELL + 1, head.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }
}
