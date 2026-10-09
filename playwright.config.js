// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SG_PORT || 4173);
const onlyChromium = process.env.SG_BROWSERS === "chromium";
const nightly = process.env.SG_NIGHTLY === "1";
const touchSpecs = /drag-touch\.spec\.js/;

export default defineConfig({
  testDir: "tests",
  testMatch: [
    "e2e/**/*.spec.js",
    "a11y/**/*.spec.js",
    "memory/**/*.spec.js",
    "print/**/*.spec.js",
    "perf/**/*.spec.js",
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: touchSpecs },
    ...(onlyChromium
      ? []
      : [
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
            testIgnore: [touchSpecs, /memory\//, /perf\//],
          },
        ]),
    { name: "pixel", use: { ...devices["Pixel 7"] }, testMatch: touchSpecs },
    ...(onlyChromium
      ? []
      : [{ name: "ipad", use: { ...devices["iPad (gen 7)"] }, testMatch: touchSpecs }]),
    ...(nightly
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
            testIgnore: [touchSpecs, /memory\//, /perf\//],
          },
          {
            name: "los-angeles",
            use: { ...devices["Desktop Chrome"], timezoneId: "America/Los_Angeles" },
            testMatch: /dates\.spec\.js/,
          },
        ]
      : []),
  ],
  webServer: {
    command: `node examples/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/examples/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
