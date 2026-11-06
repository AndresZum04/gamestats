import { defineConfig } from "vite";

// In development Vite serves the page on 5173 and passes /api to the console
// server on 3000. In production the server serves the built files itself.
export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
