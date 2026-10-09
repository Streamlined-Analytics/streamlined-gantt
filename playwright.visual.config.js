// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Visual regression tests. Run ONLY inside mcr.microsoft.com/playwright:v1.63.0-noble
 * (npm run test:visual), so baselines never depend on the host's fonts or GPU.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SG_PORT || 4174);

export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/London",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } }],
  webServer: {
    command: `node examples/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/examples/index.html`,
    reuseExistingServer: false,
  },
});
