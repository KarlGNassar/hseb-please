import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "pnpm exec next start --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      env: { HSEB_REQUIRE_REGISTERED_RESTAURANT: "false" },
    },
    {
      command: "pnpm exec next start --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      env: {
        HSEB_REQUIRE_REGISTERED_RESTAURANT: "true",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      },
    },
  ],
});
