import { defineConfig, devices } from "@playwright/test";

// Each worktree can run its own: two on one machine must not share (and reuse) a server.
const port = Number(process.env["PLAYWRIGHT_PORT"] ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: "desk",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 600 } },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
