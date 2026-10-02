import { defineConfig, devices } from "@playwright/test";

/* End-to-end tests run against a real Chromium serving index.html via
 * http-server (file:// would block the deferred script CSP behaviour
 * we want to exercise). Webkit / Firefox are intentionally skipped —
 * single browser is enough to catch the DOM/CSS bugs we're after. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // CI also emits GitHub annotations: failing tests show up on the run
  // (and via the public API) without needing the raw logs.
  reporter: process.env.CI ? [["list"], ["github"]] : "list",

  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "pnpm exec http-server -p 8765 -s -c-1",
    url: "http://127.0.0.1:8765/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
