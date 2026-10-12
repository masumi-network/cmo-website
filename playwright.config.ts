import { defineConfig, devices } from "@playwright/test";

// E2E runs against the production build (`pnpm build` first; `pnpm verify` does both).
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  // Headless Chrome renders WebGL on the CPU (SwiftShader): frames and smooth
  // scrolling are slow, so give assertions room and keep workers few.
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Headless Chrome only renders WebGL with SwiftShader when asked to.
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
