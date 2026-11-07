import "./styles.css";
import { ConsoleApp } from "./console/ConsoleApp.js";
import { createRegistry } from "./games/index.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) new ConsoleApp(root, createRegistry()).start();
