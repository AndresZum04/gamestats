// npm run dev: starts the console server (3000) and Vite (5173) together and
// stops both on Ctrl+C. A small script instead of an extra dependency, and it
// works the same on Windows, macOS and Linux.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = ["server", "web"].map((ws) =>
  spawn(npm, ["run", "dev", "-w", ws], { stdio: "inherit", shell: process.platform === "win32" }),
);

const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) =>
  c.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  }),
);
