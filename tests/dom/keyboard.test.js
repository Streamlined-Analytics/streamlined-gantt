// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { cleanup, frame, mount } from "./support.js";

afterEach(cleanup);

const press = (key, init = {}) =>
  document.activeElement.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );

function focusRow(host, gantt, id, column = 1) {
  gantt.focusTask(id, { column });
  return host.querySelector(`[data-task-id="${id}"] [aria-colindex="${column + 1}"]`);
}

describe("keyboard", () => {
  test("the chart is one tab stop and arrow keys move between rows and cells", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    focusRow(host, gantt, "t2");
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t2");
    press("ArrowDown");
    expect(gantt.focus.taskId).toBe("t3");
    press("ArrowRight");
    expect(gantt.focus.column).toBe(2);
    press("Home");
    expect(gantt.focus.column).toBe(0);
    press("End", { ctrlKey: true });
    expect(gantt.focus.taskId).toBe("p3");
    press("Home", { ctrlKey: true });
    expect(gantt.focus.taskId).toBe("s1");
    expect(document.activeElement.getAttribute("tabindex")).toBe("0");
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  test("left and right collapse, expand and go to the parent on the tree column", () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    focusRow(host, gantt, "s2", 1);
    press("ArrowLeft");
    expect(gantt.rowById("t5")).toBeUndefined();
    press("ArrowRight");
    expect(gantt.rowById("t5")).toBeDefined();
    focusRow(host, gantt, "t5", 1);
    press("ArrowLeft");
    expect(gantt.focus.taskId).toBe("s2");
  });

  test("Alt+arrow moves a task one working day and announces it; Ctrl+Z undoes", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    focusRow(host, gantt, "t6");
    press("ArrowRight", { altKey: true });
    await gantt.whenIdle();
    await frame();
    expect(gantt.getTask("t6").start).toBe("2026-11-24");
    const live = host.querySelector('[aria-live="polite"]').textContent;
    expect(live).toMatch(
      /^Edge trims and outlets moved to Tuesday 24 November; 3 other tasks rescheduled; finish now Monday 30 November$/,
    );
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t6");
    press("z", { ctrlKey: true });
    await frame();
    expect(gantt.getTask("t6").start).toBe("2026-11-23");
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe("Undone: Update task");
    press("y", { ctrlKey: true });
    expect(gantt.getTask("t6").start).toBe("2026-11-24");
  });

  test("Alt+Shift+arrow changes the duration", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    focusRow(host, gantt, "t5");
    press("ArrowRight", { altKey: true, shiftKey: true });
    await gantt.whenIdle();
    expect(gantt.getTask("t5").duration).toBe(7);
    press("ArrowLeft", { altKey: true, shiftKey: true });
    press("ArrowLeft", { altKey: true, shiftKey: true });
    await gantt.whenIdle();
    expect(gantt.getTask("t5").duration).toBe(5);
  });

  test("locked and read-only tasks refuse keyboard moves with an announcement", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    focusRow(host, gantt, "a1");
    press("ArrowRight", { altKey: true });
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe(
      "MC access to roof is locked",
    );
    gantt.setReadOnly(true);
    focusRow(host, gantt, "t5");
    press("ArrowRight", { altKey: true });
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe(
      "This programme is read-only",
    );
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
  });

  test("Space selects, Ctrl+Enter asks to open the editor, Delete removes", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const opened = [];
    gantt.on("before-editor-open", (event) => opened.push(event.taskId));
    focusRow(host, gantt, "t5");
    press(" ");
    expect(gantt.getSelection()).toEqual(["t5"]);
    press("Enter", { ctrlKey: true });
    expect(opened).toEqual(["t5"]);
    press("Delete");
    await gantt.whenIdle();
    expect(gantt.getTask("t5")).toBeUndefined();
  });

  test("focus survives scrolling the focused row out of view and back", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { height: "200px", overscan: 0 });
    focusRow(host, gantt, "s1");
    gantt.scroller.scrollTop = 400;
    gantt.render();
    expect(host.querySelector('[data-task-id="s1"][role=row]')).toBeNull();
    const grid = host.querySelector("[role=treegrid]");
    expect(grid.getAttribute("tabindex")).toBe("0");
    grid.focus();
    await frame();
    expect(document.activeElement.closest("[data-task-id]")?.dataset.taskId).toBe("s1");
  });
});
