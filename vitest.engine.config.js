// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { defineConfig } from "vitest/config";

/** Engine-only configuration (Node, no DOM), used by the engine CI job and Stryker. */
export default defineConfig({
  test: {
    name: "engine",
    environment: "node",
    include: ["tests/unit/**/*.test.js", "tests/property/**/*.test.js", "tests/io/**/*.test.js"],
    exclude: ["tests/io/**/*.browser.test.js"],
    setupFiles: ["tests/setup/no-dom.js"],
    retry: 0,
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.js", "src/model/**/*.js", "src/io/**/*.js"],
      exclude: ["src/engine/types.js"],
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: {
        "src/engine/**": { lines: 98, branches: 95, functions: 100, statements: 98 },
        "src/model/**": { lines: 95, branches: 90, functions: 95, statements: 95 },
        "src/io/**": { lines: 98, branches: 90, functions: 100, statements: 98 },
      },
    },
  },
});
