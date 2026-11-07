import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// In development Vite serves the page on 5173 and passes /api to the console
// server on 3000. In production the server serves the built files itself.
// @gameconsole/shared is read from its sources, so neither the build nor the
// tests need shared/dist first.
export default defineConfig({
  resolve: {
    alias: {
      "@gameconsole/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "node" },
});
