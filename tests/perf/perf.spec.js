// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { expect, test } from "@playwright/test";
import { openHarness } from "../e2e/support/page.js";

/**
 * Timed performance budgets on the 1,000-task / 1,500-link fixture (spec #16):
 * first render under 250 ms, scrolling at 55 fps or more, a drag frame under
 * 16 ms and a full schedule() under 30 ms on a mid-range laptop. CI machines
 * vary, so the assertions are twice those budgets and run only with SG_PERF=1:
 * the nightly performance job sets it and runs this spec alone, because the
 * full browser matrix runs tests in parallel and would time contended frames.
 * The measured numbers are printed for the job summary.
 */

const timed = process.env.SG_PERF === "1";
const BUDGET = { firstRender: 500, scrollFrame: 1000 / 27.5, dragFrame: 32, schedule: 60 };

test.describe("performance budgets (1,000 tasks, 1,500 links)", () => {
  test.skip(!timed, "timed budgets run in the nightly performance job; set SG_PERF=1 to run");

  test("first render, scroll, drag and reschedule", async ({ page }) => {
    await openHarness(page, { fixture: "perf", height: "800px" });
    const firstRender = await page.evaluate(() => window.firstRenderMs);

    const scrollFrame = await page.evaluate(async () => {
      const scroller = window.gantt.scroller;
      const frames = [];
      let previous = performance.now();
      for (let step = 0; step < 90; step += 1) {
        scroller.scrollTop += 96;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
      }
      frames.sort((first, second) => first - second);
      return frames[Math.floor(frames.length * 0.9)];
    });

    const dragFrame = await page.evaluate(async () => {
      const gantt = window.gantt;
      gantt.scroller.scrollTop = 0;
      gantt.render();
      const hit = gantt.root.querySelector(".sg-task:not(.sg-locked) .sg-hit");
      const box = hit.getBoundingClientRect();
      const base = {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      };
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      hit.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y }));
      const svg = hit.closest("svg");
      const times = [];
      for (let step = 1; step <= 30; step += 1) {
        const started = performance.now();
        svg.dispatchEvent(
          new PointerEvent("pointermove", { ...base, clientX: x + step * 4, clientY: y }),
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
        times.push(performance.now() - started);
      }
      svg.dispatchEvent(
        new PointerEvent("pointerup", { ...base, buttons: 0, clientX: x + 120, clientY: y }),
      );
      times.sort((first, second) => first - second);
      return times[Math.floor(times.length * 0.9)] - 1000 / 60;
    });

    const schedule = await page.evaluate(() => {
      window.gantt.schedule();
      const runs = [];
      for (let run = 0; run < 10; run += 1) {
        const started = performance.now();
        window.gantt.schedule();
        runs.push(performance.now() - started);
      }
      runs.sort((first, second) => first - second);
      return runs[Math.floor(runs.length / 2)];
    });

    const measured = { firstRender, scrollFrame, dragFrame: Math.max(dragFrame, 0), schedule };
    console.log(
      `perf: ${JSON.stringify(Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, Number(value.toFixed(1))])))}`,
    );
    for (const [key, value] of Object.entries(measured)) {
      expect
        .soft(value, `${key} ${value.toFixed(1)} ms (budget ${BUDGET[key].toFixed(0)} ms)`)
        .toBeLessThan(BUDGET[key]);
    }
  });
});
