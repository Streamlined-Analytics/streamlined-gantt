// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { watchErrors } from "./support/page.js";

test("custom editor: the host's dialog opens instead of the built-in one and saves through updateTask", async ({
  page,
}) => {
  const { assertClean } = watchErrors(page);
  await page.goto("/examples/custom-editor.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.locator('g[data-task-id="t3"] .sg-hit').dblclick();
  const dialog = page.locator("#task-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".sg-dialog")).toHaveCount(0);
  await dialog.getByLabel("Name").fill("Deck repairs (revised)");
  await dialog.getByLabel("Working days").fill("4");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const task = await page.evaluate(() => window.gantt.getTask("t3"));
  expect(task).toMatchObject({ name: "Deck repairs (revised)", duration: 4 });
  expect(await page.evaluate(() => window.gantt.canUndo())).toBe(true);
  assertClean();
});

test("read-only share view: no drag handles, edits by pointer or keyboard are ignored", async ({
  page,
}) => {
  const { assertClean } = watchErrors(page);
  await page.goto("/examples/read-only.html");
  const root = page.locator(".sg-root");
  await expect(root).toHaveClass(/sg-readonly/);
  await expect(page.locator("[data-handle=resize-end]")).toHaveCount(0);
  const before = await page.evaluate(
    () => document.querySelector("streamlined-gantt").gantt.getTask("t3").start,
  );
  const bar = page.locator('g[data-task-id="t3"] .sg-bar');
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("row", { name: /Deck repairs/ }).click();
  await page.keyboard.press("Alt+ArrowRight");
  const after = await page.evaluate(
    () => document.querySelector("streamlined-gantt").gantt.getTask("t3").start,
  );
  expect(after).toBe(before);
  await expect(page.locator("[role=toolbar]")).toBeVisible();
  assertClean();
});
