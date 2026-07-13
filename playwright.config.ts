import { defineConfig, devices } from "@playwright/test";

/** E2E — arranca la app en dev y prueba flujos críticos (login, etc.). */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Tests comparten BD; correr en serie evita flakiness.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000, // PDF puede tardar hasta 90s en el worker.
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
