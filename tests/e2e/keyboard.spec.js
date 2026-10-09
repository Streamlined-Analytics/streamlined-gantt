// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { openHarness } from "./support/page.js";

test("keyboard-only flow: tab in, navigate, move a task, undo (WCAG 2.5.7)", async ({ page }) => {
  await openHarness(page);
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-task-id="s1"] [tabindex="0"]')).toBeFocused();
  for (let index = 0; index < 8; index += 1) await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-task-id="t6"] [tabindex="0"]')).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => page.evaluate(() => window.gantt.getTask("t6").start)).toBe("2026-11-24");
  await expect(page.locator(".sg-root > [aria-live=polite]")).toHaveText(
    /Edge trims and outlets moved to Tuesday 24 November/,
  );
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.gantt.getTask("t6").start)).toBe("2026-11-23");
  await expect(page.locator('[data-task-id="t6"] [tabindex="0"]')).toBeFocused();
});
