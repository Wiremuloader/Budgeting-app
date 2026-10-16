import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`next build && next start`) on port
 * 3100 with a dedicated embedded database (./.data/e2e) that is wiped before the server
 * starts. Stop `npm run dev` first: both use the project's .next directory.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: `node e2e/reset-db.mjs && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 420_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "pglite:./.data/e2e",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-for-production-0123456789",
      DISABLE_AUTH_RATE_LIMIT: "true",
      ANTHROPIC_API_KEY: "",
    },
  },
});
