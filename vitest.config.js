// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const nightly = process.env.SG_NIGHTLY === "1";
const browsers = nightly
  ? [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }]
  : [{ browser: "chromium" }];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "engine",
          environment: "node",
          include: [
            "tests/unit/**/*.test.js",
            "tests/property/**/*.test.js",
            "tests/io/**/*.test.js",
          ],
          exclude: ["tests/io/**/*.browser.test.js"],
          setupFiles: ["tests/setup/no-dom.js"],
          retry: 0,
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "dom",
          include: ["tests/dom/**/*.test.js", "tests/io/**/*.browser.test.js"],
          setupFiles: ["tests/setup/dom.js"],
          retry: 0,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              contextOptions: {
                locale: "en-GB",
                timezoneId: "Europe/London",
                reducedMotion: "reduce",
              },
            }),
            instances: browsers,
            viewport: { width: 1280, height: 800 },
          },
        },
      },
    ],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      exclude: ["src/iife.js", "src/engine/types.js"],
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: {
        "src/ui/**": { lines: 85, branches: 75, functions: 85, statements: 85 },
      },
    },
  },
});
