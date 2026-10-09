// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { button, openDialog } from "./dialog.js";
import { html } from "./dom.js";
import { fill } from "./strings.js";

/**
 * "Link to…" (Ctrl+K): the keyboard alternative to drag-linking. A
 * searchable combobox lists the tasks that can follow the focused one; the
 * link type and lag are chosen in the same dialog.
 *
 * @module ui/picker
 */

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {string} fromId
 * @returns {boolean}
 */
export function openLinkPicker(gantt, fromId) {
  const source = gantt.getTask(fromId);
  if (!source || gantt.readOnly) return false;
  const s = gantt.strings;
  const id = `${gantt.uid}-picker`;
  const handle = openDialog(gantt.root, {
    title: fill(s.pickerTitle, { name: source.name }),
    className: "sg-picker",
  });
  const search = /** @type {HTMLInputElement} */ (
    html("input", {
      id: `${id}-search`,
      type: "search",
      role: "combobox",
      "aria-expanded": "true",
      "aria-controls": `${id}-list`,
      "aria-autocomplete": "list",
      autocomplete: "off",
    })
  );
  const list = html("ul", {
    id: `${id}-list`,
    role: "listbox",
    class: "sg-picker-list",
    "aria-label": s.pickerSearch,
  });
  const type = /** @type {HTMLSelectElement} */ (
    html(
      "select",
      { id: `${id}-type` },
      ["FS", "SS", "FF", "SF"].map((code) =>
        html("option", { value: code }, [s[`linkType${code}`]]),
      ),
    )
  );
  const lag = /** @type {HTMLInputElement} */ (
    html("input", { id: `${id}-lag`, type: "number", step: 1, value: 0 })
  );
  const empty = html("p", { class: "sg-picker-empty", hidden: true }, [s.pickerNone]);
  handle.body.append(
    html("div", { class: "sg-field" }, [
      html("label", { for: search.id }, [s.pickerSearch]),
      search,
    ]),
    list,
    empty,
    html("div", { class: "sg-field-row" }, [
      html("div", { class: "sg-field" }, [html("label", { for: type.id }, [s.pickerType]), type]),
      html("div", { class: "sg-field" }, [html("label", { for: lag.id }, [s.pickerLag]), lag]),
    ]),
  );
  const candidates = gantt
    .rows()
    .filter((row) => row.id !== fromId && !row.summary && gantt.canLink(fromId, row.id));
  let active = 0;
  let shown = candidates;
  const render = () => {
    const query = search.value.trim().toLowerCase();
    shown = candidates.filter((row) =>
      `${row.task.wbs ?? ""} ${row.task.name}`.toLowerCase().includes(query),
    );
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.replaceChildren(
      ...shown.map((row, index) => {
        const option = html(
          "li",
          {
            id: `${id}-option-${index}`,
            role: "option",
            "aria-selected": String(index === active),
            class: index === active ? "sg-active" : "",
          },
          [row.task.wbs ? `${row.task.wbs} ${row.task.name}` : row.task.name],
        );
        option.addEventListener("click", () => {
          active = index;
          create();
        });
        return option;
      }),
    );
    empty.hidden = shown.length > 0;
    if (shown.length) search.setAttribute("aria-activedescendant", `${id}-option-${active}`);
    else search.removeAttribute("aria-activedescendant");
  };
  const create = () => {
    const target = shown[active];
    if (!target) return;
    const link = /** @type {any} */ ({
      from: fromId,
      to: target.id,
      type: type.value,
      lag: Number(lag.value) || 0,
    });
    handle.close("create");
    gantt
      .addLink(link, { cause: "keyboard" })
      .then((result) =>
        gantt.announceLink(result, fromId, { taskId: target.id, type: type.value }),
      );
  };
  search.addEventListener("input", () => {
    active = 0;
    render();
  });
  search.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      active = Math.max(0, Math.min(shown.length - 1, active + step));
      render();
      list.children[active]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      create();
    }
  });
  const cancel = button(s.cancel);
  const confirm = button(s.pickerCreate, { class: "sg-button sg-button-primary" });
  cancel.addEventListener("click", () => handle.close("cancel"));
  confirm.addEventListener("click", create);
  handle.actions.append(cancel, confirm);
  render();
  search.focus();
  gantt.activeDialog = handle;
  return true;
}
