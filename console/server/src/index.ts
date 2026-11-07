import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config, { logger: true });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    {
      sink: config.eventSink,
      eventsDir: config.eventSink === "file" ? config.eventsDir : undefined,
      ingestorUrl: config.eventSink === "http" ? config.ingestorUrl : undefined,
    },
    "console server ready",
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// docker stop and Ctrl+C: finish the requests in progress before exiting.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
