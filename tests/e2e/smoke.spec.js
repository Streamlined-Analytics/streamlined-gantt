// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { test, expect } from "@playwright/test";

test("the ESM bundle loads in the browser and reports its version", async ({ page }) => {
  await page.goto("/examples/index.html");
  await expect(page.locator("#version")).toHaveText(/^Version \d+\.\d+\.\d+/);
});
