import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the whole system already running: the console
 * (CONSOLE_URL, http://localhost:3000 by default), GameStats and Prolog. They
 * do not start anything themselves; install.sh (or docker compose up) does.
 * The specs run one after the other because each one counts what GameStats
 * received; inside a spec the matches run at the same time.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.CONSOLE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
