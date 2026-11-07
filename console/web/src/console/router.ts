export type Route =
  | { name: "lobby" }
  | { name: "play"; gameId: string }
  | { name: "panel" }
  | { name: "notFound"; path: string };

/** /, /play/:gameId and /panel; anything else is notFound. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "lobby" };
  if (path === "/panel") return { name: "panel" };
  const play = /^\/play\/([a-z0-9-]+)$/.exec(path);
  if (play?.[1]) return { name: "play", gameId: play[1] };
  return { name: "notFound", path };
}

/**
 * Navigation with the History API. Links with data-link change the page
 * without reloading, so the matches of the tab keep running.
 */
export class Router {
  readonly #onChange: (route: Route) => void;

  constructor(onChange: (route: Route) => void) {
    this.#onChange = onChange;
  }

  start(): void {
    window.addEventListener("popstate", () => this.#emit());
    document.addEventListener("click", (e) => {
      const link = (e.target as Element | null)?.closest?.("a[data-link]");
      if (!(link instanceof HTMLAnchorElement) || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      this.navigate(link.pathname + link.search);
    });
    this.#emit();
  }

  navigate(path: string): void {
    if (path !== location.pathname + location.search) history.pushState(null, "", path);
    this.#emit();
  }

  #emit(): void {
    this.#onChange(parseRoute(location.pathname));
  }
}
