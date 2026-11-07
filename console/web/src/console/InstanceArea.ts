import { h } from "./dom.js";
import type { GameView } from "./GameRegistry.js";
import type { Instance, InstanceManager } from "./InstanceManager.js";

const STATUS: Record<string, string> = {
  READY: "Lista",
  RUNNING: "En curso",
  FINISHED: "Terminada",
};

interface GameWindow {
  el: HTMLElement;
  status: HTMLElement;
  view: GameView;
  unsubscribe: () => void;
}

/**
 * The grid of game windows. Each one has its title (game · matchId), focus and
 * close buttons and the game's view. It only presents: opening, focusing and
 * closing go through the InstanceManager.
 */
export class InstanceArea {
  readonly #manager: InstanceManager;
  readonly #windows = new Map<number, GameWindow>();
  readonly #grid = h("section", { class: "instances", "aria-label": "Partidas abiertas" });
  #unsubscribe: (() => void) | null = null;

  constructor(manager: InstanceManager) {
    this.#manager = manager;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.#grid);
    this.#unsubscribe = this.#manager.subscribe(() => this.render());
    this.render();
  }

  dispose(): void {
    this.#unsubscribe?.();
    for (const id of [...this.#windows.keys()]) this.#remove(id);
    this.#grid.remove();
  }

  /** The key handler of the focused instance's view, if it has one. */
  focusedKeyHandler(): ((e: KeyboardEvent) => boolean) | undefined {
    const id = this.#manager.focused?.id;
    const view = id === undefined ? undefined : this.#windows.get(id)?.view;
    return view?.handleKey?.bind(view);
  }

  render(): void {
    const instances = this.#manager.instances;
    const open = new Set(instances.map((i) => i.id));
    for (const id of this.#windows.keys()) if (!open.has(id)) this.#remove(id);
    for (const instance of instances) {
      const win = this.#windows.get(instance.id) ?? this.#add(instance);
      const focused = this.#manager.focused?.id === instance.id;
      win.el.classList.toggle("focused", focused);
      win.status.textContent = STATUS[instance.game.status] ?? instance.game.status;
    }
    this.#grid.classList.toggle("empty", instances.length === 0);
  }

  #add(instance: Instance): GameWindow {
    const { game, definition } = instance;
    const body = h("div", { class: "instance-body" });
    const status = h("span", { class: "badge" });
    const el = h(
      "article",
      {
        class: "instance",
        "data-match-id": game.matchId,
        onpointerdown: () => this.#manager.focus(instance.id),
      },
      h(
        "header",
        {},
        h("h3", {}, `${definition.title} · `, h("code", {}, game.matchId)),
        status,
        // A new tab, so the match keeps running on screen while the panel is open.
        h(
          "a",
          {
            href: `/panel?game=${definition.id}`,
            target: "_blank",
            rel: "noopener",
            class: "button",
          },
          "Estadísticas",
        ),
        h("button", { type: "button", onclick: () => this.#manager.focus(instance.id) }, "Enfocar"),
        h(
          "button",
          { type: "button", class: "danger", onclick: () => this.#manager.close(instance.id) },
          "Cerrar",
        ),
      ),
      body,
    );
    this.#grid.append(el);
    const view = definition.createView(game);
    view.mount(body);
    const unsubscribe = game.subscribe(() => {
      view.render();
      this.render();
    });
    const win = { el, status, view, unsubscribe };
    this.#windows.set(instance.id, win);
    return win;
  }

  #remove(id: number): void {
    const win = this.#windows.get(id);
    if (!win) return;
    win.unsubscribe();
    win.view.dispose();
    win.el.remove();
    this.#windows.delete(id);
  }
}
