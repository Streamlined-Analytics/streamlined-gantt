// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { cleanup, frame, mount, pointerDrag } from "./support.js";

afterEach(cleanup);

const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
const dialog = () => document.querySelector("dialog[open]");
const press = (key, init = {}) =>
  document.activeElement.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );

/** Resolves after a ResizeObserver callback and the render it requests. */
async function settle() {
  await frame();
  await frame();
}

function timelineChart(options = {}) {
  return mount(structuredClone(flatRoof), {
    layout: "timeline",
    fit: "width",
    fields: FLAT_ROOF_FIELDS,
    ...options,
  });
}

describe("layout: timeline", () => {
  test("no visible grid: the timeline starts at the left edge and fills the width", () => {
    const { gantt, host } = timelineChart();
    expect(gantt.root.classList.contains("sg-layout-timeline")).toBe(true);
    expect(gantt.gridWidth()).toBe(0);
    const grid = host.querySelector("[role=treegrid]");
    expect(grid.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const svg = host.querySelector(".sg-svg").getBoundingClientRect();
    const scroller = gantt.scroller.getBoundingClientRect();
    expect(svg.left - scroller.left).toBeLessThan(1);
    expect(gantt.scroller.scrollWidth).toBeLessThanOrEqual(gantt.scroller.clientWidth);
    expect(gantt.scale.width).toBeGreaterThan(gantt.scroller.clientWidth - 4);
  });

  test("every task and milestone carries its name as a label, never past the right edge", () => {
    const { gantt, host } = timelineChart();
    for (const task of flatRoof.tasks) {
      const label = host.querySelector(`.sg-svg [data-task-id="${task.id}"] .sg-bar-label`);
      expect(label?.textContent, task.id).toContain(task.name);
      const box = label.getBBox();
      expect(box.x, task.id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, task.id).toBeLessThanOrEqual(gantt.scale.width + 1);
    }
    expect(host.querySelector('[data-task-id="t5"] .sg-bar-label.sg-inside')).not.toBeNull();
    expect(host.querySelector('[data-task-id="p3"] .sg-bar-label.sg-before')).not.toBeNull();
  });

  test("on a narrow chart a label takes the roomier side and is shortened, not clipped", () => {
    const { gantt, host } = timelineChart({ width: "360px", minDayWidth: 1 });
    const labels = [...host.querySelectorAll(".sg-svg .sg-bar-label")];
    expect(labels.some((label) => label.textContent.endsWith("…"))).toBe(true);
    for (const label of labels) {
      const box = label.getBBox();
      expect(box.x, label.textContent).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, label.textContent).toBeLessThanOrEqual(gantt.scale.width + 1);
    }
  });

  test("the hidden treegrid keeps its rows, positions and spoken names", () => {
    const { host } = timelineChart();
    const grid = host.querySelector("[role=treegrid]");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(flatRoof.tasks.length + 1));
    expect(grid.getAttribute("aria-colcount")).toBe("1");
    expect(grid.querySelector('[data-task-id="t5"] .sg-tree-cell').getAttribute("aria-label")).toBe(
      "Insulation and membrane, Friday 13 November 2026 to Friday 20 November 2026, 6 working days",
    );
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  test("the keyboard model is unchanged: Alt+arrow moves, undo restores, Ctrl+Enter edits", async () => {
    const { gantt, host } = timelineChart();
    gantt.focusTask("t5");
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t5");
    expect(host.querySelector('.sg-svg [data-task-id="t5"]').classList).toContain("sg-focused");
    press("ArrowRight", { altKey: true });
    await gantt.whenIdle();
    expect(gantt.getTask("t5").start).toBe("2026-11-16");
    press("z", { ctrlKey: true });
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
    press("Enter", { ctrlKey: true });
    expect(dialog()).not.toBeNull();
    dialog().querySelector(".sg-button:not(.sg-button-primary)").click();
    await frame();
    gantt.focusTask("t5");
    press("Enter");
    expect(dialog()).not.toBeNull();
  });

  test("a task added below keeps keyboard focus on its row (one hidden column)", async () => {
    const { gantt } = timelineChart();
    gantt.focusTask("t5");
    await gantt.addBelow("t5", "task");
    const added = gantt.lastChange.changes.tasks.added[0].id;
    expect(gantt.focus).toEqual({ taskId: added, column: 0 });
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe(added);
  });

  test("clicking a bar selects it and moves keyboard focus to its row", () => {
    const { gantt, host } = timelineChart();
    host
      .querySelector('[data-task-id="t3"] .sg-hit')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(gantt.getSelection()).toEqual(["t3"]);
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t3");
  });

  test("dragging a bar commits one change and fires drag-end", async () => {
    const { gantt, host } = timelineChart();
    const seen = [];
    gantt.on("drag-end", () => seen.push("drag-end"));
    gantt.on("change", () => seen.push("change"));
    const shift = gantt.scale.dayWidth * 3;
    await pointerDrag(host.querySelector('[data-task-id="t8"] .sg-hit'), { dx: shift });
    await gantt.whenIdle();
    expect(gantt.getTask("t8").start).not.toBe("2026-11-26");
    expect(seen.filter((name) => name === "change")).toHaveLength(1);
    expect(seen).toContain("drag-end");
  });
});

describe("fit: width", () => {
  test("the whole programme fits, starting just before the first task", () => {
    const { gantt } = timelineChart();
    const scale = gantt.scale;
    const first = day("2026-11-02");
    expect(scale.start).toBeLessThan(first);
    expect(first - scale.start).toBeLessThanOrEqual(2);
    expect(scale.end).toBeGreaterThan(day("2026-12-05"));
    expect(gantt.scroller.scrollLeft).toBe(0);
  });

  test("refits when the chart is resized", async () => {
    const { gantt, host } = timelineChart();
    const wide = gantt.scale.dayWidth;
    host.style.width = "700px";
    await settle();
    expect(gantt.scale.dayWidth).toBeLessThan(wide);
    expect(gantt.scroller.scrollWidth).toBeLessThanOrEqual(gantt.scroller.clientWidth);
  });

  test("below the minimum day width the timeline scrolls instead", async () => {
    const { gantt } = timelineChart({ width: "200px", minDayWidth: 6 });
    await settle();
    expect(gantt.scale.dayWidth).toBe(6);
    expect(gantt.scroller.scrollWidth).toBeGreaterThan(gantt.scroller.clientWidth);
  });

  test("refits after a drop that lengthens the programme, but not during the drag", async () => {
    const { gantt, host } = timelineChart();
    const before = gantt.scale;
    const scalesDuringDrag = new Set();
    gantt.on("drag-move", () => scalesDuringDrag.add(gantt.scale));
    await pointerDrag(host.querySelector('[data-task-id="t8"] .sg-hit'), {
      dx: before.dayWidth * 10,
    });
    await gantt.whenIdle();
    await frame();
    expect([...scalesDuringDrag]).toEqual([before]);
    expect(gantt.scale).not.toBe(before);
    expect(gantt.scale.dayWidth).toBeLessThan(before.dayWidth);
  });

  test("works with the grid too, and setZoom switches fitting off", () => {
    const { gantt } = mount(structuredClone(flatRoof), { fit: "width" });
    expect(gantt.gridWidth()).toBeGreaterThan(0);
    expect(gantt.scroller.scrollWidth).toBeLessThanOrEqual(gantt.scroller.clientWidth);
    gantt.setZoom("day");
    expect(gantt.fitWidth).toBe(false);
    expect(gantt.scale.dayWidth).toBe(32);
    gantt.setFit("width");
    expect(gantt.scroller.scrollWidth).toBeLessThanOrEqual(gantt.scroller.clientWidth);
  });
});

describe("initial view", () => {
  test.each(["day", "week", "month", "quarter"])(
    "at %s zoom the grid layout opens at the first task, not weeks earlier",
    (zoom) => {
      const { gantt } = mount(structuredClone(flatRoof), { zoom });
      const visibleFrom = gantt.scale.dayAt(gantt.scroller.scrollLeft);
      const first = day("2026-11-02");
      expect(visibleFrom).toBeLessThanOrEqual(first);
      expect(first - visibleFrom).toBeLessThanOrEqual(
        Math.max(2, Math.ceil(24 / gantt.scale.dayWidth)),
      );
    },
  );
});
