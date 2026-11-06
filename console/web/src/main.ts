import { CONSOLE_ID } from "@gameconsole/shared";

// Entry point. The lobby and the router replace this in C11.
const root = document.querySelector<HTMLElement>("#app");
if (root) {
  root.textContent = `GameConsole (${CONSOLE_ID})`;
}
