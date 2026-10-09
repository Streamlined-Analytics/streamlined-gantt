// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SG_PORT || 4173);
const onlyChromium = process.env.SG_BROWSERS === "chromium";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(onlyChromium ? [] : [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]),
  ],
  webServer: {
    command: `node examples/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/examples/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
