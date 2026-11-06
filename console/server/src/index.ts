import { buildApp } from "./app.js";

// The port and the rest of the settings move to config.ts in a later task.
const port = Number(process.env["PORT"] ?? 3000);
const app = buildApp({ logger: true });

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
