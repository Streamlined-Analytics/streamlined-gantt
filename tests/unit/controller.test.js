// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test, vi } from "vitest";
import { ProgrammeController } from "../../src/model/controller.js";
import { GanttValidationError } from "../../src/engine/index.js";
import { ewCalendar, loadFixture, scheduledProgramme } from "../support/builders.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";

/** N1 with dates already scheduled, as a host would load it. */
const n1 = () => scheduledProgramme(loadFixture("programmes/cpm-n1.json"));

/** Records every emitted event name (and the event objects) on a controller. */
function record(controller, names) {
  const seen = [];
  for (const name of names) controller.on(name, (event) => seen.push(event));
  return seen;
}

const AFTER_EVENTS = [
  "before-task-update",
  "task-update",
  "field-change",
  "change",
  "edit-rejected",
  "schedule",
];

afterEach(() => {
  vi.useRealTimers();
});

describe("loading and reading", () => {
  test("load and toJSON round-trip the stored data", () => {
    const fixture = loadFixture("programmes/flat-roof.json");
    const controller = new ProgrammeController({ data: fixture, fields: FLAT_ROOF_FIELDS });
    expect(controller.toJSON()).toEqual(fixture);
    expect(controller.isDirty()).toBe(false);
  });

  test("invalid data throws GanttValidationError and keeps the previous programme", () => {
    const controller = new ProgrammeController({ data: n1() });
    expect(() => controller.load({ tasks: [{ id: "x" }] })).toThrow(GanttValidationError);
    expect(controller.getTask("A")).toBeDefined();
  });

  test("getTask returns a frozen snapshot with derived values", () => {
    const controller = new ProgrammeController({
      data: loadFixture("programmes/flat-roof.json"),
      fields: FLAT_ROOF_FIELDS,
    });
    const summary = controller.getTask("s2");
    expect(summary).toMatchObject({
      start: "2026-11-05",
      finish: "2026-11-25",
      duration: 15,
      summary: true,
      level: 1,
    });
    expect(summary.fields).toMatchObject({ cost: 1068000, charge: 1500000 });
    const task = controller.getTask("t5");
    expect(task.fields).toMatchObject({ cost: 600000, profit: 300000, margin: 1 / 3 });
    expect(task.float).toEqual({ total: 5, free: 0 });
    expect(Object.isFrozen(task)).toBe(true);
    expect(Object.isFrozen(task.fields)).toBe(true);
    expect(() => {
      task.name = "changed";
    }).toThrow(TypeError);
    expect(controller.getTask("missing")).toBeUndefined();
    expect(controller.getTasks((entry) => entry.summary).map((entry) => entry.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(controller.getLinks("t3").map((link) => link.id)).toEqual(["l3", "l4", "l5"]);
    expect(controller.getLink("l1")).toMatchObject({ from: "a1", to: "t1" });
    expect(controller.getLink("nope")).toBeUndefined();
    expect(controller.getDelayEvents()).toHaveLength(1);
  });

  test("handlers passed as options see the first load", () => {
    const loads = [];
    new ProgrammeController({
      data: n1(),
      on: { load: (event) => loads.push(event.programme.tasks.length) },
    });
    expect(loads).toEqual([10]);
  });
});

describe("drag cascade is one transaction (N1, move D three working days)", () => {
  test("D, G, I and J move; E, F and H absorb nothing; one change event", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const seen = record(controller, AFTER_EVENTS);
    const result = await controller.updateTask("D", { start: "2026-11-16" }, { cause: "drag" });
    expect(result.committed).toBe(true);
    const changes = seen.filter((event) => event.type === "change");
    expect(changes).toHaveLength(1);
    const updated = changes[0].changes.tasks.updated;
    expect(updated.map((entry) => entry.id).sort()).toEqual(["D", "G", "I", "J"]);
    expect(updated.find((entry) => entry.id === "D").cause).toBe("drag");
    expect(
      updated
        .filter((entry) => entry.cause === "schedule")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["G", "I", "J"]);
    expect(seen.filter((event) => event.type === "task-update")).toHaveLength(4);
    expect(controller.getTask("G")).toMatchObject({ start: "2026-11-23", finish: "2026-11-24" });
    expect(controller.getTask("I")).toMatchObject({ start: "2026-11-25", finish: "2026-11-27" });
    expect(controller.getTask("J")).toMatchObject({ start: "2026-11-30", finish: "2026-12-01" });
    expect(controller.getTask("E").start).toBe("2026-11-09");
    expect(controller.analysis.schedule.projectFinish).toBe("2026-12-01");
  });

  test("event order: before, task updates, field changes, exactly one change, then schedule", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const seen = record(controller, AFTER_EVENTS);
    await controller.updateTask("D", { start: "2026-11-16" }, { cause: "drag" });
    const order = seen.map((event) => event.type);
    expect(order[0]).toBe("before-task-update");
    expect(order.lastIndexOf("task-update")).toBeLessThan(order.indexOf("change"));
    expect(order.indexOf("change")).toBe(order.length - 2);
    expect(order.at(-1)).toBe("schedule");
    const before = seen[0];
    expect(before).toMatchObject({ id: "D", cause: "drag", changes: { start: "2026-11-16" } });
    expect(before.cascade.map((change) => change.id).sort()).toEqual(["G", "I", "J"]);
    expect(before.changedFields).toEqual(["start", "finish"]);
  });

  test("an FS chain moves together", async () => {
    const controller = new ProgrammeController({
      data: {
        calendars: [ewCalendar()],
        tasks: [
          { id: "B", name: "B", start: "2026-11-02", finish: "2026-11-04", duration: 3 },
          { id: "C", name: "C", start: "2026-11-05", finish: "2026-11-06", duration: 2 },
        ],
        links: [{ id: "l", from: "B", to: "C", type: "FS", lag: 0 }],
      },
    });
    const changes = record(controller, ["change"]);
    await controller.updateTask("B", { start: "2026-11-05" });
    expect(controller.getTask("C")).toMatchObject({ start: "2026-11-10", finish: "2026-11-11" });
    expect(changes).toHaveLength(1);
    expect(changes[0].changes.tasks.updated.map((entry) => entry.id)).toEqual(["B", "C"]);
  });

  test("the cascade honours bank holidays", async () => {
    const controller = new ProgrammeController({
      data: {
        calendars: [ewCalendar()],
        tasks: [
          { id: "B", name: "B", start: "2026-12-21", finish: "2026-12-23", duration: 3 },
          { id: "C", name: "C", start: "2026-12-24", finish: "2026-12-24", duration: 1 },
        ],
        links: [{ id: "l", from: "B", to: "C" }],
      },
    });
    await controller.updateTask("B", { start: "2026-12-22" });
    expect(controller.getTask("B").finish).toBe("2026-12-24");
    expect(controller.getTask("C").start).toBe("2026-12-29");
  });

  test("with autoSchedule off, nothing cascades", async () => {
    const controller = new ProgrammeController({ data: n1(), autoSchedule: "off" });
    await controller.updateTask("D", { start: "2026-11-16" });
    expect(controller.getTask("G").start).toBe("2026-11-18");
  });

  test("tight mode pulls successors back when a predecessor shortens", async () => {
    const controller = new ProgrammeController({ data: n1(), autoSchedule: "tight" });
    await controller.updateTask("H", { duration: 4 });
    expect(controller.getTask("I").start).toBe("2026-11-20");
  });
});

describe("vetoes and asynchronous approval", () => {
  test("preventDefault vetoes: nothing changes and edit-rejected explains why", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const seen = record(controller, AFTER_EVENTS);
    controller.on("before-task-update", (event) => event.preventDefault());
    const result = await controller.updateTask("D", { start: "2026-11-16" });
    expect(result).toMatchObject({ committed: false, reason: "vetoed" });
    expect(controller.getTask("D").start).toBe("2026-11-11");
    expect(controller.getTask("G").start).toBe("2026-11-18");
    expect(seen.map((event) => event.type)).toEqual(["before-task-update", "edit-rejected"]);
    expect(seen[1]).toMatchObject({
      reason: "vetoed",
      taskIds: expect.arrayContaining(["D", "G"]),
    });
    expect(controller.canUndo()).toBe(false);
    expect(controller.isDirty()).toBe(false);
  });

  test.each([[true], [undefined], ["ok"]])(
    "waitUntil(Promise.resolve(%j)) commits",
    async (value) => {
      const controller = new ProgrammeController({ data: n1() });
      controller.on("before-task-update", (event) => event.waitUntil(Promise.resolve(value)));
      const changes = record(controller, ["change"]);
      expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
        committed: true,
      });
      expect(changes).toHaveLength(1);
      expect(controller.canUndo()).toBe(true);
    },
  );

  test("waitUntil(false) restores the original dates with no change and no history", async () => {
    const controller = new ProgrammeController({ data: n1() });
    controller.on("before-task-update", (event) => event.waitUntil(Promise.resolve(false)));
    const seen = record(controller, ["change", "edit-rejected"]);
    const pending = controller.updateTask("D", { start: "2026-11-16" });
    expect(controller.getTask("D").start).toBe("2026-11-16");
    expect(controller.isIdle()).toBe(false);
    expect(await pending).toMatchObject({ committed: false, reason: "vetoed" });
    expect(controller.getTask("D").start).toBe("2026-11-11");
    expect(seen.map((event) => event.type)).toEqual(["edit-rejected"]);
    expect(controller.canUndo()).toBe(false);
  });

  test("a rejected approval promise restores and reports the error", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const failure = new Error("409");
    controller.on("before-task-update", (event) => event.waitUntil(Promise.reject(failure)));
    const rejections = record(controller, ["edit-rejected"]);
    expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
      reason: "error",
    });
    expect(rejections[0]).toMatchObject({ reason: "error", error: failure });
    expect(controller.getTask("D").start).toBe("2026-11-11");
  });

  test("a changeset from the server replaces the local result; one change carries the server version", async () => {
    const controller = new ProgrammeController({ data: n1() });
    controller.on("before-task-update", (event) =>
      event.waitUntil(
        Promise.resolve({
          tasks: { update: [{ id: "D", start: "2026-11-12", finish: "2026-11-18", duration: 5 }] },
        }),
      ),
    );
    const changes = record(controller, ["change"]);
    expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
      committed: true,
    });
    expect(controller.getTask("D")).toMatchObject({ start: "2026-11-12", finish: "2026-11-18" });
    expect(controller.getTask("G").start).toBe("2026-11-18");
    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe("server");
    expect(changes[0].changes.tasks.updated).toEqual([
      expect.objectContaining({ id: "D", new: expect.objectContaining({ start: "2026-11-12" }) }),
    ]);
  });

  test("an invalid server changeset is refused", async () => {
    const controller = new ProgrammeController({ data: n1() });
    controller.on("before-task-update", (event) =>
      event.waitUntil(
        Promise.resolve({ tasks: { update: [{ id: "ghost", start: "2026-11-12" }] } }),
      ),
    );
    expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
      committed: false,
      reason: "error",
    });
    expect(controller.getTask("D").start).toBe("2026-11-11");
  });

  test("a never-settling approval times out after 15 s, not before", async () => {
    vi.useFakeTimers();
    const controller = new ProgrammeController({ data: n1() });
    controller.on("before-task-update", (event) => event.waitUntil(new Promise(() => {})));
    const rejections = record(controller, ["edit-rejected"]);
    const pending = controller.updateTask("D", { start: "2026-11-16" });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(rejections).toHaveLength(0);
    expect(controller.getTask("D").start).toBe("2026-11-16");
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ reason: "timeout" });
    expect(rejections[0].reason).toBe("timeout");
    expect(controller.getTask("D").start).toBe("2026-11-11");
  });

  test("waitUntil after dispatch throws InvalidStateError", async () => {
    const controller = new ProgrammeController({ data: n1() });
    let captured;
    controller.on("before-task-update", (event) => {
      captured = event;
    });
    await controller.updateTask("D", { start: "2026-11-16" });
    expect(() => captured.waitUntil(Promise.resolve(true))).toThrow(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
  });

  test("several waitUntil calls must all accept", async () => {
    const controller = new ProgrammeController({ data: n1() });
    controller.on("before-task-update", (event) => event.waitUntil(Promise.resolve(true)));
    controller.on("before-task-update", (event) => event.waitUntil(Promise.resolve(false)));
    expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
      reason: "vetoed",
    });
  });

  test("confirm mode holds the old state until the server answers", async () => {
    const controller = new ProgrammeController({ data: n1(), editMode: "confirm" });
    let approve;
    controller.on("before-task-update", (event) =>
      event.waitUntil(new Promise((resolve) => (approve = resolve))),
    );
    const pending = controller.updateTask("D", { start: "2026-11-16" });
    expect(controller.getTask("D").start).toBe("2026-11-11");
    approve(true);
    await pending;
    expect(controller.getTask("D").start).toBe("2026-11-16");
    expect(controller.getTask("J").start).toBe("2026-11-30");
  });

  test("edits requested while one is pending are queued and settle in order", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const resolvers = [];
    controller.on("before-task-update", (event) =>
      event.waitUntil(new Promise((resolve) => resolvers.push(resolve))),
    );
    const changes = record(controller, ["change"]);
    const first = controller.updateTask("D", { start: "2026-11-16" });
    const second = controller.updateTask("E", { duration: 4 });
    expect(resolvers).toHaveLength(1);
    resolvers[0](true);
    await first;
    expect(resolvers).toHaveLength(2);
    resolvers[1](true);
    await second;
    await controller.whenIdle();
    expect(changes.map((event) => event.changes.tasks.updated[0].id)).toEqual(["D", "E"]);
  });

  test("handlers registered for the DOM mirror can veto through the event target", async () => {
    const target = new EventTarget();
    target.addEventListener("gantt:before-task-update", (event) => event.preventDefault());
    const seen = [];
    target.addEventListener("gantt:edit-rejected", (event) => seen.push(event));
    const controller = new ProgrammeController({ data: n1(), eventTarget: target });
    expect(await controller.updateTask("D", { start: "2026-11-16" })).toMatchObject({
      reason: "vetoed",
    });
    expect(seen[0].detail.reason).toBe("vetoed");
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].cancelable).toBe(false);
  });
});

describe("refusals before any before-event", () => {
  test("locked tasks refuse API updates and never reach integrator handlers", async () => {
    const controller = new ProgrammeController({ data: loadFixture("programmes/flat-roof.json") });
    const before = vi.fn();
    controller.on("before-task-update", before);
    const rejections = record(controller, ["edit-rejected"]);
    expect(await controller.updateTask("a1", { start: "2026-11-09" })).toMatchObject({
      reason: "locked",
    });
    expect(before).not.toHaveBeenCalled();
    expect(rejections[0]).toMatchObject({ reason: "locked", taskIds: ["a1"] });
  });

  test("a link that closes a cycle is refused and nothing changes", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const before = controller.toJSON();
    expect(await controller.addLink({ from: "J", to: "A" })).toMatchObject({ reason: "cycle" });
    expect(await controller.addLink({ from: "A", to: "A" })).toMatchObject({ reason: "cycle" });
    expect(controller.toJSON()).toEqual(before);
  });

  test("a cycle created inside a batch is refused as a whole", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const before = controller.toJSON();
    const result = await controller.batch(() => {
      controller.removeLink("l1");
      controller.addLink({ id: "x", from: "J", to: "B" });
      controller.addLink({ id: "y", from: "B", to: "J" });
    });
    expect(result).toMatchObject({ committed: false, reason: "cycle" });
    expect(controller.toJSON()).toEqual(before);
  });

  test("unknown ids are refused with not-found", async () => {
    const controller = new ProgrammeController({ data: n1() });
    expect(await controller.updateTask("nope", { name: "x" })).toMatchObject({
      reason: "not-found",
    });
    expect(await controller.removeTask("nope")).toMatchObject({ reason: "not-found" });
    expect(await controller.removeLink("nope")).toMatchObject({ reason: "not-found" });
    expect(await controller.updateLink("nope", { lag: 1 })).toMatchObject({ reason: "not-found" });
    expect(await controller.addLink({ from: "A", to: "nope" })).toMatchObject({
      reason: "not-found",
    });
    expect(await controller.addTask({ name: "x" }, { parent: "nope" })).toMatchObject({
      reason: "not-found",
    });
    expect(await controller.updateDelayEvent("nope", { title: "x" })).toMatchObject({
      reason: "not-found",
    });
  });

  test("an edit that changes nothing commits nothing", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const changes = record(controller, ["change"]);
    expect(await controller.updateTask("A", { name: "Task A" })).toMatchObject({
      committed: false,
      reason: "no-change",
    });
    expect(changes).toHaveLength(0);
  });
});

describe("custom fields", () => {
  const make = () =>
    new ProgrammeController({
      data: loadFixture("programmes/flat-roof.json"),
      fields: FLAT_ROOF_FIELDS,
    });

  test("field updates emit field-change and keep other fields", async () => {
    const controller = make();
    const changes = record(controller, ["field-change", "task-update"]);
    await controller.updateTask("t5", { fields: { cost: 650000 } });
    expect(changes.find((event) => event.type === "field-change")).toMatchObject({
      taskId: "t5",
      field: "fields.cost",
      old: 600000,
      new: 650000,
      cause: "api",
    });
    expect(changes.find((event) => event.type === "task-update").changedFields).toEqual([
      "fields.cost",
    ]);
    expect(controller.toJSON().tasks.find((task) => task.id === "t5").fields).toEqual({
      cost: 650000,
      charge: 900000,
      qty: 120,
      poRef: "PO-1182",
    });
    expect(controller.getTask("t5").fields.margin).toBeCloseTo(250000 / 900000);
  });

  test("a null field value removes the key", async () => {
    const controller = make();
    await controller.updateTask("t5", { fields: { poRef: null } });
    expect(controller.toJSON().tasks.find((task) => task.id === "t5").fields.poRef).toBeUndefined();
  });

  test("validation failures emit validation-error and block the edit", async () => {
    const controller = make();
    const seen = record(controller, ["validation-error", "edit-rejected", "change"]);
    expect(await controller.updateTask("t5", { fields: { cost: -5 } })).toMatchObject({
      reason: "validation",
    });
    expect(seen.map((event) => event.type)).toEqual(["validation-error", "edit-rejected"]);
    expect(seen[0]).toMatchObject({
      taskId: "t5",
      field: "fields.cost",
      value: -5,
      message: "Cost must be at least 0",
    });
    expect(await controller.updateTask("t5", { fields: { margin: 0.5 } })).toMatchObject({
      reason: "validation",
    });
    expect(await controller.updateTask("t5", { progress: 2 })).toMatchObject({
      reason: "validation",
    });
    expect(await controller.updateTask("t5", { name: 5 })).toMatchObject({ reason: "validation" });
  });

  test("project summaries recompute after edits", async () => {
    const controller = make();
    expect(controller.getProjectSummary().sums.cost).toBe(1268000);
    await controller.updateTask("t5", { fields: { cost: 650000 } });
    expect(controller.getProjectSummary({ bucket: "week" }).sums.cost).toBe(1318000);
    expect(controller.getPaymentSchedule()).toHaveLength(3);
    expect(controller.getFieldTotals(["charge"])).toEqual({ charge: 1800000 });
    expect(controller.getProjectSummary({ baselineId: "bl1" }).baseline.id).toBe("bl1");
    expect(controller.formatMoney(900000)).toBe("£9,000.00");
  });
});

describe("structural edits", () => {
  test("addTask places the task in the tree and fills in dates", async () => {
    const controller = new ProgrammeController({ data: loadFixture("programmes/flat-roof.json") });
    const added = record(controller, ["task-add"]);
    await controller.addTask({ id: "n1", name: "Skip hire" }, { parent: "s1", index: 1 });
    const tasks = controller.toJSON().tasks.map((task) => task.id);
    expect(tasks.slice(0, 4)).toEqual(["s1", "a1", "n1", "t1"]);
    expect(controller.getTask("n1")).toMatchObject({
      parent: "s1",
      start: "2026-11-09",
      finish: "2026-11-09",
      duration: 1,
    });
    expect(added[0]).toMatchObject({ id: "n1", cause: "api" });
    await controller.addTask({ id: "n2", name: "Last in s3" }, { parent: "s3" });
    expect(controller.toJSON().tasks.at(-1).id).toBe("n2");
    await controller.addTask({
      id: "n3",
      name: "Root milestone",
      type: "milestone",
      start: "2026-11-30",
    });
    expect(controller.getTask("n3")).toMatchObject({ duration: 0, finish: "2026-11-30" });
    await controller.addTask({ id: "n4", name: "Phase", type: "summary" });
    expect(controller.toJSON().tasks.at(-1)).toEqual({ id: "n4", name: "Phase", type: "summary" });
    expect(await controller.addTask({ id: "n4", name: "Duplicate" })).toMatchObject({
      reason: "validation",
    });
    const generated = await controller.addTask({ name: "Generated" });
    expect(generated.committed).toBe(true);
  });

  test("removeTask cascades to children and links by default", async () => {
    const controller = new ProgrammeController({ data: loadFixture("programmes/flat-roof.json") });
    const removed = record(controller, ["task-remove", "link-remove", "change"]);
    await controller.removeTask("s2");
    const data = controller.toJSON();
    expect(data.tasks.map((task) => task.id)).toEqual(["s1", "a1", "t1", "s3", "t8", "p3"]);
    expect(data.links.map((link) => link.id)).toEqual(["l1", "l9"]);
    expect(data.delayEvents[0].taskIds).toEqual([]);
    expect(removed.filter((event) => event.type === "change")).toHaveLength(1);
    expect(removed.filter((event) => event.type === "task-remove")).toHaveLength(7);
  });

  test("removeTask without cascade lifts children to the parent", async () => {
    const controller = new ProgrammeController({ data: loadFixture("programmes/flat-roof.json") });
    await controller.removeTask("s3", { cascade: false });
    expect(controller.getTask("t8").parent).toBeUndefined();
    expect(controller.getTask("t8").level).toBe(1);
  });

  test("links can be added, updated and removed", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const seen = record(controller, ["link-add", "link-update", "link-remove"]);
    await controller.addLink({ id: "x", from: "E", to: "H", type: "SS", lag: 2 });
    expect(controller.getTask("H").start).toBe("2026-11-13");
    await controller.updateLink("x", { lag: 6 });
    expect(controller.getTask("H").start).toBe("2026-11-17");
    expect(await controller.updateLink("x", { from: "J" })).toMatchObject({ reason: "cycle" });
    expect(await controller.addLink({ from: "E", to: "H" })).toMatchObject({
      reason: "validation",
    });
    await controller.removeLink("x");
    expect(seen.map((event) => event.type)).toEqual(["link-add", "link-update", "link-remove"]);
  });

  test("delay events, project values, calendars and baselines", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const seen = record(controller, [
      "delay-add",
      "delay-update",
      "delay-remove",
      "project-update",
    ]);
    await controller.addDelayEvent({
      id: "d1",
      kind: "weather",
      from: "2026-11-04",
      to: "2026-11-04",
      taskIds: ["A"],
    });
    await controller.updateDelayEvent("d1", { title: "Wind" });
    await controller.removeDelayEvent("d1");
    expect(
      await controller.addDelayEvent({ id: "d2", from: "2026-11-05", to: "2026-11-04" }),
    ).toMatchObject({ reason: "validation" });
    await controller.setProject({ dataDate: "2026-11-09" });
    expect(controller.getTask("A").start).toBe("2026-11-09");
    expect(controller.getTask("B").start).toBe("2026-11-12");
    await controller.setCalendar("ew", { ...ewCalendar(), nonWorking: [{ date: "2026-11-10" }] });
    expect(controller.getTask("A").finish).toBe("2026-11-12");
    await controller.setCalendar("extra", { id: "ignored", workWeek: [1, 2, 3, 4, 5, 6] });
    expect(controller.toJSON().calendars.map((calendar) => calendar.id)).toEqual(["ew", "extra"]);
    await controller.captureBaseline({ id: "bl", name: "Rev B", captured: "2026-11-09" });
    expect(controller.toJSON().baselines[0]).toMatchObject({
      id: "bl",
      name: "Rev B",
      tasks: { A: { start: "2026-11-09", finish: "2026-11-12" } },
    });
    await controller.captureBaseline();
    expect(controller.toJSON().baselines[1].name).toBe("Baseline 2");
    expect(seen.map((event) => event.type)).toEqual([
      "delay-add",
      "delay-update",
      "delay-remove",
      "project-update",
      "project-update",
      "project-update",
    ]);
  });

  test("schedule() reschedules everything as one transaction", async () => {
    const controller = new ProgrammeController({
      data: loadFixture("programmes/cpm-n1.json"),
      autoSchedule: "off",
    });
    const changes = record(controller, ["change"]);
    const outcome = controller.schedule();
    await outcome.result;
    expect(outcome.changed).toHaveLength(9);
    expect(outcome.critical.sort()).toEqual(["A", "C", "F", "H", "I", "J"]);
    expect(outcome.floats.E).toEqual({ total: 5, free: 4 });
    expect(changes[0].cause).toBe("schedule");
    expect(controller.getTask("J").finish).toBe("2026-11-27");
  });
});

describe("history", () => {
  test("a cascade is one undo step; undo restores every task and emits change with cause undo", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const original = controller.toJSON();
    await controller.updateTask("D", { start: "2026-11-16" }, { cause: "drag" });
    const changes = record(controller, ["change"]);
    await controller.undo();
    expect(controller.toJSON()).toEqual(original);
    expect(changes).toHaveLength(1);
    expect(changes[0].cause).toBe("undo");
    expect(changes[0].changes.tasks.updated.map((entry) => entry.id).sort()).toEqual([
      "D",
      "G",
      "I",
      "J",
    ]);
    await controller.redo();
    expect(controller.getTask("J").start).toBe("2026-11-30");
    expect(controller.redo()).toBe(false);
  });

  test("batch makes one step and one labelled change; nested batches fold in", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const changes = record(controller, ["change"]);
    await controller.batch(
      () => {
        controller.updateTask("A", { name: "Strip-out" });
        controller.batch(() => controller.updateTask("B", { name: "Deck" }));
        controller.addLink({ id: "x", from: "E", to: "H" });
      },
      { label: "Re-sequence" },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].label).toBe("Re-sequence");
    await controller.undo();
    expect(controller.getTask("A").name).toBe("Task A");
    expect(controller.getLink("x")).toBeUndefined();
    expect(controller.canUndo()).toBe(false);
  });

  test("an exception inside batch rolls everything back and emits nothing", () => {
    const controller = new ProgrammeController({ data: n1() });
    const before = controller.toJSON();
    const changes = record(controller, ["change"]);
    expect(() =>
      controller.batch(() => {
        controller.updateTask("A", { name: "Changed" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(controller.toJSON()).toEqual(before);
    expect(changes).toHaveLength(0);
    expect(controller.canUndo()).toBe(false);
  });

  test("the history is capped; a new edit clears redo", async () => {
    const controller = new ProgrammeController({ data: n1(), historyLimit: 100 });
    for (let index = 0; index < 101; index += 1)
      await controller.updateTask("A", { name: `Name ${index}` });
    let undone = 0;
    while (controller.undo()) undone += 1;
    expect(undone).toBe(100);
    expect(controller.getTask("A").name).toBe("Name 0");
    await controller.redo();
    await controller.updateTask("B", { name: "New" });
    expect(controller.canRedo()).toBe(false);
  });

  test("undo never overwrites a non-undoable server patch (ADR-0006)", async () => {
    const controller = new ProgrammeController({ data: n1() });
    await controller.updateTask("A", { name: "User edit A" });
    await controller.updateTask("B", { name: "User edit B" });
    await controller.updateTask("C", { name: "User edit C" });
    await controller.applyPatch(
      { tasks: { update: [{ id: "B", name: "Server B" }] } },
      { undoable: false },
    );
    expect(controller.getTask("B").name).toBe("Server B");
    await controller.undo();
    expect(controller.getTask("C").name).toBe("Task C");
    expect(controller.canUndo()).toBe(false);
    expect(controller.getTask("B").name).toBe("Server B");
    expect(controller.getTask("A").name).toBe("User edit A");
  });

  test("an undoable patch is just another step", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const changes = record(controller, ["change"]);
    await controller.applyPatch({
      tasks: { add: [{ id: "K", name: "K", start: "2026-11-30", duration: 1 }], remove: ["J"] },
      links: { remove: ["l11"] },
      project: { name: "Patched" },
    });
    expect(changes[0]).toMatchObject({ cause: "patch", source: "server" });
    expect(controller.getTask("J")).toBeUndefined();
    await controller.undo();
    expect(controller.getTask("J")).toBeDefined();
    expect(controller.toJSON().name).toBe("CPM N1: classic 10-activity FS network");
  });

  test("a silent patch emits no change", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const changes = record(controller, ["change", "task-update"]);
    await controller.applyPatch(
      { tasks: { update: [{ id: "A", name: "Quiet" }] } },
      { silent: true },
    );
    expect(changes).toHaveLength(0);
    expect(controller.getTask("A").name).toBe("Quiet");
  });

  test("nothing to undo returns false", () => {
    expect(new ProgrammeController({ data: n1() }).undo()).toBe(false);
  });
});

describe("dirty tracking", () => {
  test("getChanges returns a changeset that applyPatch accepts", async () => {
    const controller = new ProgrammeController({ data: n1() });
    await controller.updateTask("D", { start: "2026-11-16" });
    await controller.addTask({ id: "K", name: "K", start: "2026-12-02", duration: 1 });
    await controller.removeLink("l1");
    await controller.setProject({ revision: { code: "C" } });
    expect(controller.isDirty()).toBe(true);
    const changes = controller.getChanges();
    expect(changes.tasks.update.find((patch) => patch.id === "D")).toEqual({
      id: "D",
      start: "2026-11-16",
      finish: "2026-11-20",
    });
    expect(changes.tasks.add.map((task) => task.id)).toEqual(["K"]);
    expect(changes.links.remove).toEqual(["l1"]);
    expect(changes.project).toEqual({ revision: { code: "C" } });
    const replica = new ProgrammeController({ data: n1() });
    await replica.applyPatch(changes);
    expect(replica.toJSON().tasks.map((task) => [task.id, task.start])).toEqual(
      controller.toJSON().tasks.map((task) => [task.id, task.start]),
    );
    controller.markClean();
    expect(controller.isDirty()).toBe(false);
    expect(controller.getChanges()).toEqual({});
  });
});

describe("other API", () => {
  test("check, CSV and whenIdle", async () => {
    const controller = new ProgrammeController({ data: loadFixture("programmes/flat-roof.json") });
    expect(controller.check().map((finding) => finding.code)).toEqual(["open-end"]);
    expect(controller.exportCSV().split("\r\n")[0]).toMatch(/^id,wbs,name/);
    await expect(controller.whenIdle()).resolves.toBeUndefined();
  });

  test("unknown event names are a programming error", () => {
    const controller = new ProgrammeController();
    expect(() => controller.on("task-moved", () => {})).toThrow(TypeError);
  });

  test("once, off and handler errors do not break dispatch", async () => {
    const controller = new ProgrammeController({ data: n1() });
    const calls = [];
    controller.once("change", () => calls.push("once"));
    const handler = () => calls.push("off");
    controller.on("change", handler);
    controller.off("change", handler);
    controller.on("change", () => {
      throw new Error("handler bug");
    });
    controller.on("change", () => calls.push("after"));
    const errors = [];
    const onError = (error) => errors.push(error);
    process.on("uncaughtException", onError);
    await controller.updateTask("A", { name: "x" });
    await controller.updateTask("A", { name: "y" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("uncaughtException", onError);
    expect(calls).toEqual(["once", "after", "after"]);
    expect(errors.map((error) => error.message)).toEqual(["handler bug", "handler bug"]);
  });

  test("destroy is idempotent; later edits and pending approvals are ignored", async () => {
    const controller = new ProgrammeController({ data: n1() });
    let approve;
    controller.on("before-task-update", (event) =>
      event.waitUntil(new Promise((resolve) => (approve = resolve))),
    );
    const destroyed = record(controller, ["destroy", "change"]);
    const pending = controller.updateTask("D", { start: "2026-11-16" });
    const idle = controller.whenIdle();
    controller.destroy();
    controller.destroy();
    await idle;
    approve(true);
    expect(await pending).toMatchObject({ committed: false, reason: "destroyed" });
    expect(await controller.updateTask("A", { name: "z" })).toMatchObject({ reason: "destroyed" });
    expect(destroyed.map((event) => event.type)).toEqual(["destroy"]);
  });
});

describe("indent and outdent", () => {
  const flatRoof = () =>
    new ProgrammeController({
      data: loadFixture("programmes/flat-roof.json"),
      fields: FLAT_ROOF_FIELDS,
    });

  const tree = () =>
    new ProgrammeController({
      data: {
        calendars: [ewCalendar()],
        tasks: [
          { id: "P", name: "Phase", type: "summary" },
          { id: "A", name: "A", parent: "P", start: "2026-11-02", duration: 2 },
          { id: "B", name: "B", parent: "P", start: "2026-11-02", duration: 2 },
        ],
        links: [],
      },
    });

  test("indent makes a task the last child of the sibling above; undo restores it", async () => {
    const controller = tree();
    expect(await controller.indentTask("B")).toMatchObject({ committed: true });
    expect(controller.getTask("B").parent).toBe("A");
    await controller.undo();
    expect(controller.getTask("B").parent).toBe("P");
  });

  test("outdent moves a task up one level, to the top when its parent is top-level", async () => {
    const controller = tree();
    await controller.indentTask("B");
    expect(await controller.outdentTask("B", { cause: "keyboard" })).toMatchObject({
      committed: true,
    });
    expect(controller.getTask("B").parent).toBe("P");
    await controller.outdentTask("B");
    expect(controller.getTask("B").parent ?? null).toBeNull();
  });

  test("indenting under a linked predecessor is refused as a cycle", async () => {
    expect(await flatRoof().indentTask("t3")).toMatchObject({ committed: false, reason: "cycle" });
  });

  test.each([
    ["indentTask", "s1", "validation", /no task above/],
    ["indentTask", "nope", "not-found", /Unknown task/],
    ["outdentTask", "s1", "validation", /already at the top level/],
    ["outdentTask", "nope", "not-found", /Unknown task/],
  ])("%s(%s) is refused with reason %s", async (method, id, reason, message) => {
    const controller = flatRoof();
    const rejections = record(controller, ["edit-rejected"]);
    expect(await controller[method](id)).toMatchObject({ committed: false, reason });
    expect(rejections[0].message).toMatch(message);
  });
});
