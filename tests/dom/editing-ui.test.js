// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test } from "vitest";
import flatRoof from "../fixtures/programmes/flat-roof.json";
import { trustedHTML } from "../../src/index.js";
import { buildToolbar } from "../../src/toolbar.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { cleanup, frame, mount } from "./support.js";

afterEach(cleanup);

const press = (target, key, init = {}) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );

function record(gantt, names) {
  const seen = [];
  for (const name of names) gantt.on(name, (event) => seen.push(event));
  return seen;
}

const dialog = () => document.querySelector("dialog[open]");
const field = (label) =>
  [...dialog().querySelectorAll("label")].find((element) => element.textContent === label)?.control;

describe("built-in editor", () => {
  test("opens with configured fields, focuses the first field, and saves through updateTask", async () => {
    const { gantt } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    const seen = record(gantt, [
      "editor-open",
      "before-task-update",
      "change",
      "editor-save",
      "editor-close",
    ]);
    expect(gantt.openEditor("t5")).toBe(true);
    expect(dialog().getAttribute("aria-labelledby")).toBe(dialog().querySelector("h2").id);
    expect(document.activeElement).toBe(field("Task name"));
    expect(field("Cost").value).toBe("6000.00");
    expect(field("Progress").value).toBe("0");
    expect(field("Margin %").disabled).toBe(true);
    expect(dialog().querySelector(".sg-field-currency .sg-affix").textContent).toBe("£");
    field("Cost").value = "1,250.50";
    field("Duration").value = "7";
    dialog().querySelector(".sg-button-primary").click();
    await gantt.whenIdle();
    await frame();
    expect(dialog()).toBeNull();
    expect(gantt.getTask("t5")).toMatchObject({
      duration: 7,
      finish: "2026-11-23",
      fields: { cost: 125050 },
    });
    expect(seen.map((event) => event.type)).toEqual([
      "editor-open",
      "before-task-update",
      "change",
      "editor-save",
      "editor-close",
    ]);
    expect(seen.find((event) => event.type === "change").cause).toBe("editor");
    expect(seen.at(-1).saved).toBe(true);
  });

  test("invalid input shows an accessible inline error and blocks the save", async () => {
    const { gantt } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    gantt.openEditor("t5");
    field("Cost").value = "-10";
    dialog().querySelector(".sg-button-primary").click();
    await frame();
    const cost = field("Cost");
    expect(cost.hasAttribute("aria-invalid")).toBe(true);
    expect(document.getElementById(cost.getAttribute("aria-describedby")).textContent).toBe(
      "Cost must be at least 0",
    );
    expect(document.activeElement).toBe(cost);
    expect(gantt.getTask("t5").fields.cost).toBe(600000);
    dialog().querySelector(".sg-button").click();
  });

  test("a server rejection keeps the dialog open with the reason", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.on("before-task-update", (event) => event.waitUntil(Promise.resolve(false)));
    gantt.openEditor("t5");
    field("Task name").value = "Rejected name";
    dialog().querySelector(".sg-button-primary").click();
    await gantt.whenIdle();
    await frame();
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector("[role=alert]").textContent).toBe(
      "The server rejected the change",
    );
    dialog().querySelector(".sg-button").click();
  });

  test("Esc closes without saving and returns focus to the row", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    gantt.focusTask("t5", { column: 1 });
    const closes = record(gantt, ["editor-close"]);
    gantt.openEditor("t5");
    dialog().close();
    await frame();
    expect(closes[0].saved).toBe(false);
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t5");
    void host;
  });

  test("custom slots render from a function or a template", () => {
    const { gantt, host } = mount(structuredClone(flatRoof), {
      editorFields: [
        { field: "name", label: "Name", type: "text" },
        {
          slot: "photos",
          render: (task) =>
            Object.assign(document.createElement("p"), { textContent: `Photos for ${task.id}` }),
        },
        { slot: "notes-help" },
      ],
    });
    const template = document.createElement("template");
    template.dataset.slot = "notes-help";
    template.innerHTML = "<em>Site notes go here</em>";
    host.append(template);
    gantt.openEditor("t5");
    expect(dialog().querySelector('[data-slot="photos"]').textContent).toBe("Photos for t5");
    expect(dialog().querySelector('[data-slot="notes-help"] em').textContent).toBe(
      "Site notes go here",
    );
    dialog().close();
  });

  test("before-editor-open can be prevented to use your own modal; editor none disables it", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.on("before-editor-open", (event) => event.preventDefault());
    expect(gantt.openEditor("t5")).toBe(false);
    expect(dialog()).toBeNull();
    const custom = [];
    const second = mount(structuredClone(flatRoof), {
      editor: (task) => custom.push(task.id),
    }).gantt;
    expect(second.openEditor("t3")).toBe(true);
    expect(custom).toEqual(["t3"]);
    expect(mount(structuredClone(flatRoof), { editor: "none" }).gantt.openEditor("t3")).toBe(false);
  });

  test("read-only and locked tasks open a view-only dialog", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.openEditor("a1");
    expect(dialog().querySelector("h2").textContent).toBe("Task details");
    expect(dialog().querySelector(".sg-button-primary")).toBeNull();
    dialog().close();
  });
});

describe("context menu", () => {
  test("Shift+F10 opens a keyboard-operable menu; Esc returns focus", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    gantt.focusTask("t5", { column: 1 });
    press(document.activeElement, "F10", { shiftKey: true });
    const menu = host.querySelector("[role=menu]");
    expect(menu).not.toBeNull();
    expect(document.activeElement.getAttribute("role")).toBe("menuitem");
    expect(
      [...menu.querySelectorAll("[role=menuitem]")].map((item) => item.dataset.action),
    ).toEqual([
      "edit",
      "add-below",
      "add-milestone",
      "indent",
      "outdent",
      "link",
      "copy-id",
      "delete",
    ]);
    press(document.activeElement, "ArrowDown");
    expect(document.activeElement.dataset.action).toBe("add-below");
    press(document.activeElement, "End");
    expect(document.activeElement.dataset.action).toBe("delete");
    press(document.activeElement, "ArrowDown");
    expect(document.activeElement.dataset.action).toBe("edit");
    press(document.activeElement, "Escape");
    expect(host.querySelector("[role=menu]")).toBeNull();
    expect(document.activeElement.closest("[data-task-id]").dataset.taskId).toBe("t5");
  });

  test("choosing an item emits menu-action and runs it", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof));
    const actions = record(gantt, ["menu-action"]);
    gantt.openContextMenu("t5", { keyboard: true });
    host.querySelector('[data-action="add-below"]').click();
    await gantt.whenIdle();
    expect(actions[0]).toMatchObject({ action: "add-below", taskId: "t5" });
    const added = gantt.toJSON().tasks.find((task) => task.name === "New task");
    expect(added).toMatchObject({ parent: "s2", start: "2026-11-23", duration: 1 });
    expect(gantt.toJSON().tasks.findIndex((task) => task.id === added.id)).toBe(
      gantt.toJSON().tasks.findIndex((task) => task.id === "t5") + 1,
    );
  });

  test("right-click over the timeline offers to record a delay on that date", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { zoom: "day" });
    const bar = host.querySelector('[data-task-id="t5"] .sg-hit');
    const box = bar.getBoundingClientRect();
    bar.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 5,
        clientY: box.top + 5,
      }),
    );
    host.querySelector('[data-action="delay"]').click();
    await gantt.whenIdle();
    expect(gantt.getDelayEvents().at(-1)).toMatchObject({
      from: "2026-11-13",
      to: "2026-11-13",
      taskIds: ["t5"],
    });
  });

  test("indent and outdent", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    await gantt.indentTask("t5");
    expect(gantt.getTask("t5").parent).toBe("p1");
    await gantt.outdentTask("t5");
    expect(gantt.getTask("t5").parent).toBe("s2");
    expect(await gantt.indentTask("s1")).toMatchObject({ reason: "validation" });
    expect(await gantt.outdentTask("s1")).toMatchObject({ reason: "validation" });
  });

  test("read-only mode shows only non-editing items; contextMenu false disables it", () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { readOnly: true });
    gantt.openContextMenu("t5", {});
    expect(
      [...host.querySelectorAll("[role=menuitem]")].map((item) => item.dataset.action),
    ).toEqual(["edit", "copy-id"]);
    gantt.menu.close();
    const none = mount(structuredClone(flatRoof), { contextMenu: false });
    expect(none.gantt.openContextMenu("t5", {})).toBe(false);
  });
});

describe("link picker, delete confirmation and inline editing", () => {
  test("Ctrl+K opens a searchable picker; Enter creates the link", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.focusTask("t1", { column: 1 });
    press(document.activeElement, "k", { ctrlKey: true });
    const search = dialog().querySelector("[role=combobox]");
    expect(document.activeElement).toBe(search);
    search.value = "Insul";
    search.dispatchEvent(new Event("input"));
    const options = dialog().querySelectorAll("[role=option]");
    expect([...options].map((option) => option.textContent)).toEqual([
      "2.4 Insulation and membrane",
    ]);
    expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);
    press(search, "Enter");
    await gantt.whenIdle();
    expect(gantt.getLinks("t5").some((link) => link.from === "t1" && link.type === "FS")).toBe(
      true,
    );
  });

  test("tasks that would create a cycle are not offered", () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.openLinkPicker("t8");
    const names = [...dialog().querySelectorAll("[role=option]")].map(
      (option) => option.textContent,
    );
    expect(names.some((name) => name.includes("Deck repairs"))).toBe(false);
    dialog().close();
  });

  test("Delete asks first; cancelling keeps the task", async () => {
    const { gantt } = mount(structuredClone(flatRoof));
    gantt.focusTask("t6", { column: 1 });
    press(document.activeElement, "Delete");
    await frame();
    expect(dialog().textContent).toContain("Delete “Edge trims and outlets”");
    dialog().querySelector(".sg-button").click();
    await frame();
    expect(gantt.getTask("t6")).toBeDefined();
    gantt.requestRemove("t6");
    await frame();
    dialog().querySelector(".sg-button-danger").click();
    await gantt.whenIdle();
    await frame();
    expect(gantt.getTask("t6")).toBeUndefined();
  });

  test("Enter edits a cell inline; Enter commits, Esc cancels", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    const changes = record(gantt, ["change"]);
    gantt.focusTask("t5", { column: 4 });
    press(document.activeElement, "Enter");
    const input = host.querySelector(".sg-cell-input");
    expect(input.value).toBe("6");
    input.value = "8";
    press(input, "Enter");
    await gantt.whenIdle();
    expect(gantt.getTask("t5")).toMatchObject({ duration: 8, finish: "2026-11-24" });
    expect(changes[0].cause).toBe("grid");
    gantt.focusTask("t5", { column: 1 });
    press(document.activeElement, "F2");
    const name = host.querySelector(".sg-cell-input");
    name.value = "Changed";
    press(name, "Escape");
    expect(gantt.getTask("t5").name).toBe("Insulation and membrane");
  });

  test("invalid inline values are marked with aria-invalid and an error message", async () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { fields: FLAT_ROOF_FIELDS });
    const errors = record(gantt, ["validation-error"]);
    const costColumn = gantt.columns.findIndex((column) => column.id === "fields.cost");
    gantt.focusTask("t5", { column: costColumn });
    press(document.activeElement, "Enter");
    const input = host.querySelector(".sg-cell-input");
    input.value = "-4";
    press(input, "Enter");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")).textContent).toBe(
      "Cost must be at least 0",
    );
    expect(errors[0]).toMatchObject({ taskId: "t5", field: "fields.cost" });
    press(input, "Escape");
  });
});

describe("tooltip", () => {
  test("shows inclusive en-GB dates and renders task names as text, never HTML", async () => {
    const programme = structuredClone(flatRoof);
    programme.tasks.find((task) => task.id === "t5").name = '<img src=x onerror="window.pwned=1">';
    const { host } = mount(programme);
    await frame();
    await frame();
    const bar = host.querySelector('[data-task-id="t5"] .sg-hit');
    const box = bar.getBoundingClientRect();
    bar.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        clientX: box.left + 5,
        clientY: box.top + 5,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 320));
    const tooltip = host.querySelector(".sg-tooltip");
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("13/11/2026 – 20/11/2026");
    expect(tooltip.textContent).toContain('<img src=x onerror="window.pwned=1">');
    expect(tooltip.querySelector("img")).toBeNull();
    expect(host.querySelector(".sg-grid img")).toBeNull();
    expect(window.pwned).toBeUndefined();
  });

  test("a custom template may return trusted HTML explicitly", async () => {
    const { host } = mount(structuredClone(flatRoof), {
      tooltip: (task) => trustedHTML(`<b class="custom">${task.id}</b>`),
    });
    await frame();
    await frame();
    const bar = host.querySelector('[data-task-id="t5"] .sg-hit');
    bar.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: 10, clientY: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(host.querySelector(".sg-tooltip b.custom").textContent).toBe("t5");
  });
});

describe("toolbar", () => {
  test("the optional toolbar drives zoom, toggles and lookahead", () => {
    const { gantt, host } = mount(structuredClone(flatRoof), { toolbar: buildToolbar });
    const toolbar = host.querySelector("[role=toolbar]");
    const zoom = toolbar.querySelector("select");
    zoom.value = "day";
    zoom.dispatchEvent(new Event("change"));
    expect(gantt.zoom).toBe("day");
    const critical = [...toolbar.querySelectorAll("button")].find(
      (button) => button.textContent === "Critical path",
    );
    critical.click();
    expect(gantt.showCriticalPath).toBe(false);
    expect(critical.getAttribute("aria-pressed")).toBe("false");
    const lookahead = toolbar.querySelectorAll("select")[1];
    lookahead.value = "3";
    lookahead.dispatchEvent(new Event("change"));
    expect(gantt.lookahead.weeks).toBe(3);
  });
});
