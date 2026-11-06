import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests read @gameconsole/shared from its sources, so they run without
// building shared first. The compiled server uses shared/dist.
export default defineConfig({
  resolve: {
    alias: {
      "@gameconsole/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
});
