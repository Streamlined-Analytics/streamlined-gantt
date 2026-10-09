// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { cleanup, frame, mount, pointerDrag } from "./support.js";

afterEach(cleanup);

/** Week zoom: 12 px per calendar day. */
const DAY = 12;

function record(gantt, names) {
  const seen = [];
  for (const name of names) gantt.on(name, (event) => seen.push(event));
  return seen;
}

const handle = (host, taskId, name) =>
  host.querySelector(`[data-task-id="${taskId}"] [data-handle="${name}"]`);

describe("drag editing with a mouse", () => {
  test("move: the documented event sequence, one change, successors cascade on working days", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const seen = record(gantt, [
      "drag-start",
      "drag-move",
      "drag-end",
      "before-task-update",
      "task-update",
      "change",
      "schedule",
    ]);
    await pointerDrag(handle(host, "t3", "move"), { dx: 7 * DAY });
    const order = seen.map((event) => event.type);
    expect(order[0]).toBe("drag-start");
    expect(order.filter((type) => type === "drag-move").length).toBeGreaterThan(0);
    expect(order.indexOf("drag-end")).toBeLessThan(order.indexOf("before-task-update"));
    expect(order.filter((type) => type === "change")).toHaveLength(1);
    expect(order.at(-1)).toBe("schedule");
    const change = seen.find((event) => event.type === "change");
    expect(change.cause).toBe("drag");
    expect(change.changes.tasks.updated.find((entry) => entry.id === "t3").cause).toBe("drag");
    expect(gantt.getTask("t3")).toMatchObject({ start: "2026-11-17", finish: "2026-11-19" });
    expect(gantt.getTask("t5").start).toBe("2026-11-20");
    expect(gantt.getTask("p1").start).toBe("2026-11-19");
    const end = seen.find((event) => event.type === "drag-end");
    expect(end).toMatchObject({
      kind: "move",
      taskId: "t3",
      cancelled: false,
      from: { start: "2026-11-10" },
      to: { start: "2026-11-17" },
    });
  });

  test("drag-move carries the live cascade preview and the bar follows the pointer", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const moves = record(gantt, ["drag-move"]);
    await pointerDrag(handle(host, "t3", "move"), { dx: 7 * DAY, release: false });
    const last = moves.at(-1);
    expect(last.preview.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["t3", "t5", "t6"]),
    );
    expect(gantt.getProjectSummary({ preview: true }).finish).toBe("2026-12-04");
    expect(gantt.getProjectSummary().finish).toBe("2026-11-27");
    const x = Number(host.querySelector('[data-task-id="t3"] .sg-bar').getAttribute("x"));
    expect(x).toBeCloseTo(gantt.scale.x(Date.UTC(2026, 10, 17) / 86400000), 0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frame();
    expect(gantt.getTask("t3").start).toBe("2026-11-10");
  });

  test("Escape before the first drag frame cancels cleanly (no move processed yet)", () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const ends = record(gantt, ["drag-end"]);
    const target = handle(host, "t5", "move");
    const box = target.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      pointerId: 9,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    };
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    target.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y }));
    target
      .closest("svg")
      .dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x + 40, clientY: y }));
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    ).not.toThrow();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ cancelled: true, kind: "move", taskId: "t5" });
    expect(ends[0].to).toEqual(ends[0].from);
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
  });

  test("resize-end gives the inclusive finish under the pointer (Frappe #73)", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    await pointerDrag(handle(host, "t5", "resize-end"), { dx: 32 * 3 });
    expect(gantt.getTask("t5")).toMatchObject({
      start: "2026-11-13",
      finish: "2026-11-25",
      duration: 9,
    });
  });

  test("resize-start keeps the finish", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    await pointerDrag(handle(host, "t5", "resize-start"), { dx: 32 * 3 });
    expect(gantt.getTask("t5")).toMatchObject({
      start: "2026-11-16",
      finish: "2026-11-20",
      duration: 5,
    });
  });

  test("resizing past the other end clamps to one day, never finish before start (Frappe #485)", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    await pointerDrag(handle(host, "t3", "resize-end"), { dx: -32 * 10 });
    expect(gantt.getTask("t3")).toMatchObject({
      start: "2026-11-10",
      finish: "2026-11-10",
      duration: 1,
    });
  });

  test("progress snaps to 5% steps", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    const bar = host.querySelector('[data-task-id="t5"] .sg-bar');
    const width = Number(bar.getAttribute("width"));
    await pointerDrag(handle(host, "t5", "progress"), { dx: width / 2 });
    expect(gantt.getTask("t5").progress).toBe(0.5);
  });

  test("link creation from an end handle to another bar's start makes an FS link", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    const source = handle(host, "t1", "link-end");
    const target = host.querySelector('[data-task-id="t3"] .sg-bar').getBoundingClientRect();
    const box = source.getBoundingClientRect();
    await pointerDrag(source, {
      dx: target.left + 4 - (box.left + box.width / 2),
      dy: target.top + target.height / 2 - (box.top + box.height / 2),
    });
    const added = gantt.getLinks("t3").find((link) => link.from === "t1");
    expect(added).toMatchObject({ from: "t1", to: "t3", type: "FS" });
  });

  test("a link that would close a cycle is refused", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    const rejected = record(gantt, ["edit-rejected"]);
    const source = handle(host, "t8", "link-end");
    const target = host.querySelector('[data-task-id="t3"] .sg-bar').getBoundingClientRect();
    const box = source.getBoundingClientRect();
    await pointerDrag(source, {
      dx: target.left + 4 - (box.left + box.width / 2),
      dy: target.top + target.height / 2 - (box.top + box.height / 2),
    });
    expect(rejected[0]?.reason).toBe("cycle");
    expect(gantt.getLinks().length).toBe(flatRoof.links.length);
  });

  test("movement under the 6 px threshold is a click, not a drag", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const starts = record(gantt, ["drag-start"]);
    await pointerDrag(handle(host, "t5", "move"), { dx: 4 });
    expect(starts).toHaveLength(0);
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
  });

  test("pointercancel cancels without committing", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const seen = record(gantt, ["drag-end", "before-task-update"]);
    const bar = handle(host, "t5", "move");
    await pointerDrag(bar, { dx: 60, release: false });
    host
      .querySelector(".sg-svg")
      .dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
    await frame();
    expect(seen.map((event) => event.type)).toEqual(["drag-end"]);
    expect(seen[0].cancelled).toBe(true);
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
  });

  test("a vetoed drag snaps back to the original geometry", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    gantt.on("before-task-update", (event) => event.preventDefault());
    const before = host.querySelector('[data-task-id="t5"] .sg-bar').getAttribute("x");
    await pointerDrag(handle(host, "t5", "move"), { dx: 60 });
    expect(host.querySelector('[data-task-id="t5"] .sg-bar').getAttribute("x")).toBe(before);
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
  });

  test("optimistic approval shows the pending state, then commits", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    let approve;
    gantt.on("before-task-update", (event) =>
      event.waitUntil(new Promise((resolve) => (approve = resolve))),
    );
    await pointerDrag(handle(host, "t5", "move"), { dx: 7 * DAY });
    expect(host.querySelector('[data-task-id="t5"].sg-pending')).not.toBeNull();
    expect(host.querySelector('.sg-grid-body [data-task-id="t5"]').getAttribute("aria-busy")).toBe(
      "true",
    );
    approve(true);
    await gantt.whenIdle();
    expect(host.querySelector(".sg-pending")).toBeNull();
    expect(gantt.getTask("t5").start).toBe("2026-11-20");
  });

  test("confirm mode keeps the old position and sets aria-busy until approved", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { editMode: "confirm" });
    let approve;
    gantt.on("before-task-update", (event) =>
      event.waitUntil(new Promise((resolve) => (approve = resolve))),
    );
    await pointerDrag(handle(host, "t5", "move"), { dx: 7 * DAY });
    expect(host.querySelector(".sg-root").getAttribute("aria-busy")).toBe("true");
    expect(gantt.getTask("t5").start).toBe("2026-11-13");
    approve(true);
    await gantt.whenIdle();
    expect(host.querySelector(".sg-root").hasAttribute("aria-busy")).toBe(false);
    expect(gantt.getTask("t5").start).toBe("2026-11-20");
  });
});

describe("refusals", () => {
  test("locked tasks have no handles; read-only produces no drag events", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { readOnly: true });
    expect(host.querySelector('[data-task-id="a1"] [data-handle]')).toBeNull();
    const seen = record(gantt, ["drag-start", "before-task-update"]);
    const bar = host.querySelector('[data-task-id="t5"] .sg-bar');
    await pointerDrag(bar, { dx: 60 });
    expect(seen).toHaveLength(0);
  });
});

describe("touch", () => {
  test("a touch drag on an unselected bar is left to the browser (scrolling)", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const starts = record(gantt, ["drag-start"]);
    await pointerDrag(handle(host, "t5", "move"), { dx: 60, pointerType: "touch" });
    expect(starts).toHaveLength(0);
  });

  test("tap to select, then drag moves the task", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    host
      .querySelector('[data-task-id="t5"] .sg-hit')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(gantt.getSelection()).toEqual(["t5"]);
    await pointerDrag(handle(host, "t5", "move"), { dx: 7 * DAY, pointerType: "touch" });
    expect(gantt.getTask("t5").start).toBe("2026-11-20");
  });

  test("a long press opens the context menu event", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const menus = record(gantt, ["task-contextmenu"]);
    const bar = handle(host, "t5", "move");
    const box = bar.getBoundingClientRect();
    bar.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 3,
        pointerType: "touch",
        clientX: box.left + 5,
        clientY: box.top + 5,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(menus).toHaveLength(1);
    host
      .querySelector(".sg-svg")
      .dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 3, pointerType: "touch" }),
      );
  });
});
