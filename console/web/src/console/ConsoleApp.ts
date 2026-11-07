import { CONSOLE_ID, type GameId } from "@gameconsole/shared";
import { HumanPlayer } from "../core/Player.js";
import { EventPublisher } from "../events/EventPublisher.js";
import { Outbox } from "../events/Outbox.js";
import { OutboxRecovery } from "../events/OutboxRecovery.js";
import { HttpTransport } from "../events/Transport.js";
import { GAME_CATALOG } from "./catalog.js";
import { h, safeStorage } from "./dom.js";
import type { GameRegistry } from "./GameRegistry.js";
import { InstanceArea } from "./InstanceArea.js";
import { InstanceManager } from "./InstanceManager.js";
import { Router, type Route } from "./router.js";

const NAME_KEY = "gameconsole.playerName";
const SESSION_KEY = "gameconsole.sessionId";

/** One id per tab: sessionStorage survives a reload but not a new tab. */
function tabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `tab-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `tab-${crypto.randomUUID().slice(0, 8)}`;
  }
}

/** ?autoplay=1&seed=N */
function autoplayFrom(search: string): { seed: number } | null {
  const params = new URLSearchParams(search);
  if (params.get("autoplay") !== "1") return null;
  const seed = Number(params.get("seed") ?? "1");
  return { seed: Number.isFinite(seed) ? seed : 1 };
}

/**
 * Wires the console of one tab: events go out through one EventPublisher per
 * match, orphan outboxes are recovered, and the tab's visibility, closing and
 * inactivity reach the InstanceManager. Then it draws the page of each route.
 */
export class ConsoleApp {
  readonly #root: HTMLElement;
  readonly #registry: GameRegistry;
  readonly #manager: InstanceManager;
  readonly #router: Router;
  #page: { dispose(): void } | null = null;

  constructor(root: HTMLElement, registry: GameRegistry) {
    this.#root = root;
    this.#registry = registry;
    const sessionId = tabSessionId();
    const transport = new HttpTransport();
    const store = localStorage;

    new OutboxRecovery(store, transport, { owner: sessionId }).start();

    this.#manager = new InstanceManager({
      registry,
      source: { consoleId: CONSOLE_ID, sessionId },
      outlet: (matchId) =>
        new EventPublisher(transport, new Outbox(matchId, store), { owner: sessionId }),
      human: () => HumanPlayer.named(this.#playerName()),
      autoplay: autoplayFrom(location.search),
    });

    document.addEventListener("visibilitychange", () =>
      this.#manager.setVisible(document.visibilityState === "visible"),
    );
    window.addEventListener("pagehide", () => this.#manager.closeTab());
    setInterval(() => this.#manager.checkIdle(), 10_000);
    document.addEventListener("keydown", (e) => this.#onKey(e));

    this.#router = new Router((route) => this.#show(route));
  }

  start(): void {
    this.#router.start();
  }

  #playerName(): string {
    return safeStorage.get(NAME_KEY) ?? "Jugador";
  }

  /** Only the focused instance gets the keyboard, and never while typing in a field. */
  #onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select")) return;
    const view = this.#focusedView?.();
    if (view?.(e)) e.preventDefault();
  }

  /** Set by the page that shows the instances. */
  #focusedView: (() => ((e: KeyboardEvent) => boolean) | undefined) | null = null;

  #show(route: Route): void {
    this.#page?.dispose();
    this.#root.replaceChildren();
    const nav = h(
      "nav",
      { class: "top" },
      h("a", { href: "/", "data-link": true, class: "brand" }, "GameConsole"),
      h("a", { href: "/", "data-link": true }, "Juegos"),
      h("a", { href: "/panel", "data-link": true }, "Panel"),
    );
    const main = h("main", {});
    this.#root.append(nav, main);

    switch (route.name) {
      case "lobby":
        this.#lobby(main);
        break;
      case "play":
        this.#play(main, route.gameId);
        break;
      case "panel":
        main.append(
          h("h1", {}, "Panel"),
          h("p", {}, "Las estadísticas de GameStats llegan en C15."),
        );
        this.#page = null;
        break;
      case "notFound":
        main.append(
          h("h1", {}, "Página no encontrada"),
          h("p", {}, h("a", { href: "/", "data-link": true }, "Volver a los juegos")),
        );
        this.#page = null;
    }
  }

  #lobby(main: HTMLElement): void {
    const name = h("input", {
      id: "player-name",
      value: this.#playerName(),
      maxlength: 24,
      autocomplete: "nickname",
      oninput: (e: Event) => safeStorage.set(NAME_KEY, (e.target as HTMLInputElement).value.trim()),
    });
    const cards = GAME_CATALOG.map(({ id, title, description }) => {
      const ready = this.#registry.has(id);
      return h(
        "article",
        { class: "card", "data-game": id },
        h("h2", {}, title),
        h("p", {}, description),
        ready
          ? h(
              "div",
              { class: "actions" },
              h(
                "button",
                { type: "button", class: "primary", onclick: () => this.#open(id) },
                "Jugar aquí",
              ),
              h(
                "a",
                {
                  href: `/play/${id}${location.search}`,
                  target: "_blank",
                  rel: "noopener",
                  class: "button",
                },
                "Abrir en pestaña nueva",
              ),
            )
          : h("p", { class: "muted" }, "Disponible pronto"),
      );
    });
    main.append(
      h("h1", {}, "Juegos"),
      h("label", { for: "player-name", class: "name" }, "Tu nombre ", name),
      h("section", { class: "cards" }, ...cards),
      h("h2", {}, "Partidas en esta pestaña"),
    );
    this.#mountInstances(main);
  }

  #play(main: HTMLElement, gameId: string): void {
    if (!this.#registry.has(gameId)) {
      main.append(h("h1", {}, "Juego no disponible"), h("p", {}, `No hay un juego "${gameId}".`));
      this.#page = null;
      return;
    }
    this.#mountInstances(main);
    if (!this.#manager.instances.some((i) => i.definition.id === gameId)) this.#open(gameId);
  }

  #open(gameId: GameId): void {
    this.#manager.open(gameId);
  }

  #mountInstances(main: HTMLElement): void {
    const area = new InstanceArea(this.#manager);
    area.mount(main);
    this.#focusedView = () => area.focusedKeyHandler();
    this.#page = {
      dispose: () => {
        area.dispose();
        this.#focusedView = null;
      },
    };
  }
}
