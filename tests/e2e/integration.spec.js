// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { watchErrors } from "./support/page.js";

/**
 * The two save-back integrations against the mock backend
 * (examples/mock-backend.mjs): approve, reject (revert) and correct.
 * Each test uses its own job id, so server state never leaks between tests.
 */

const status = (page) => page.locator("#save-status");

/** Moves a task through the public API and waits for the chart to settle. */
async function move(page, getGantt, id, start) {
  await page.evaluate(
    async ([source, taskId, date]) => {
      const gantt = new Function(`return ${source}`)();
      await gantt.updateTask(taskId, { start: date });
      await gantt.whenIdle();
    },
    [getGantt, id, start],
  );
}

const taskStart = (page, getGantt, id) =>
  page.evaluate(
    ([source, taskId]) => new Function(`return ${source}`)().getTask(taskId).start,
    [getGantt, id],
  );

test.describe("htmx save-back", () => {
  const getGantt = 'document.querySelector("streamlined-gantt").gantt';

  test.beforeEach(async ({ page }, testInfo) => {
    await page.route("**/api/jobs/htmx-demo/**", (route) =>
      route.continue({
        url: route.request().url().replace("htmx-demo", `htmx-${testInfo.testId}`),
      }),
    );
    await page.goto("/examples/htmx-save-back.html");
    await expect(page.locator(".sg-root")).toBeVisible();
    await expect(page.locator("[role=toolbar]")).toBeVisible();
  });

  test("an allowed edit is posted and saved", async ({ page }) => {
    const { assertClean } = watchErrors(page);
    const request = page.waitForRequest((candidate) => candidate.url().includes("/changes"));
    await move(page, getGantt, "t8", "2026-11-30");
    expect(new URLSearchParams((await request).postData()).get("target")).toBe("#job");
    await expect(status(page)).toHaveText("Saved");
    expect(await taskStart(page, getGantt, "t8")).toBe("2026-11-30");
    assertClean();
  });

  test("a Friday start is corrected to Monday by the server's patch", async ({ page }) => {
    await move(page, getGantt, "t8", "2026-12-04");
    await expect(status(page)).toHaveAttribute("data-outcome", "corrected");
    await expect.poll(() => taskStart(page, getGantt, "t8")).toBe("2026-12-07");
  });

  test("an edit past the shutdown is reverted by the server's patch", async ({ page }) => {
    const before = await taskStart(page, getGantt, "t8");
    await move(page, getGantt, "t8", "2026-12-21");
    await expect(status(page)).toHaveAttribute("data-outcome", "rejected");
    await expect.poll(() => taskStart(page, getGantt, "t8")).toBe(before);
  });
});

test.describe("fetch approval", () => {
  const getGantt = "window.gantt";

  test.beforeEach(async ({ page }, testInfo) => {
    await page.route("**/api/jobs/fetch-demo/**", (route) =>
      route.continue({
        url: route.request().url().replace("fetch-demo", `fetch-${testInfo.testId}`),
      }),
    );
    await page.goto("/examples/fetch-approval.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  });

  test("approved: the edit commits as made", async ({ page }) => {
    await move(page, getGantt, "t8", "2026-11-30");
    await expect(status(page)).toHaveText("Saved");
    expect(await taskStart(page, getGantt, "t8")).toBe("2026-11-30");
  });

  test("corrected: the server's changeset replaces the local result", async ({ page }) => {
    await move(page, getGantt, "t8", "2026-12-04");
    await expect(status(page)).toHaveAttribute("data-outcome", "corrected");
    expect(await taskStart(page, getGantt, "t8")).toBe("2026-12-07");
  });

  test("rejected: the edit is undone and nothing is committed", async ({ page }) => {
    const before = await taskStart(page, getGantt, "t8");
    const canUndoBefore = await page.evaluate(() => window.gantt.canUndo());
    await move(page, getGantt, "t8", "2026-12-21");
    await expect(status(page)).toHaveAttribute("data-outcome", "rejected");
    expect(await taskStart(page, getGantt, "t8")).toBe(before);
    expect(await page.evaluate(() => window.gantt.canUndo())).toBe(canUndoBefore);
  });
});
