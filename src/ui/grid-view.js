// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { html, setAttributes } from "./dom.js";
import { fill } from "./strings.js";
import { formatLongDate } from "../engine/format.js";

/**
 * The left-hand task grid: an ARIA treegrid with virtualised rows.
 *
 * Only the rows in the visible window (plus overscan) exist in the DOM. Rows
 * are keyed by task id and reused while they stay in the window, so a
 * one-row scroll creates one row. `aria-rowcount` and `aria-rowindex` give
 * screen readers the true position despite virtualisation. Focus uses a
 * roving tabindex: exactly one cell (or, when the focused row is scrolled
 * out, the grid itself) is in the tab order.
 *
 * @module ui/grid-view
 */

export class GridView {
  /**
   * @param {import("./gantt.js").Gantt} gantt
   */
  constructor(gantt) {
    this.gantt = gantt;
    this.element = html("div", {
      class: "sg-grid",
      role: "treegrid",
      "aria-multiselectable": "true",
    });
    this.header = html("div", { class: "sg-grid-header", role: "rowgroup" });
    this.headerRow = html("div", {
      class: "sg-row sg-header-row",
      role: "row",
      "aria-rowindex": 1,
    });
    this.header.append(this.headerRow);
    this.body = html("div", { class: "sg-grid-body", role: "rowgroup" });
    this.element.append(this.header, this.body);
    /** @type {Map<string, {element: HTMLElement, signature: string}>} */
    this.rows = new Map();
    this.columnsSignature = "";
  }

  /**
   * @param {import("./columns.js").Column[]} columns
   */
  renderHeader(columns) {
    const signature = columns
      .map((column) => `${column.id}:${column.width}:${column.title}`)
      .join("|");
    if (signature === this.columnsSignature) return;
    this.columnsSignature = signature;
    const template = columns.map((column) => `${column.width}px`).join(" ");
    this.element.style.setProperty("--sg-grid-columns", template);
    this.element.style.setProperty("--sg-grid-width", `${this.width(columns)}px`);
    this.headerRow.replaceChildren(
      ...columns.map((column, index) =>
        html(
          "div",
          {
            class: `sg-cell sg-header-cell sg-align-${column.align}`,
            role: "columnheader",
            "aria-colindex": index + 1,
            "data-column": column.id,
          },
          [column.title],
        ),
      ),
    );
    for (const entry of this.rows.values()) entry.signature = "";
  }

  /**
   * @param {import("./columns.js").Column[]} columns
   * @returns {number}
   */
  width(columns) {
    return columns.reduce((total, column) => total + column.width, 0);
  }

  /**
   * @param {{rows: import("./columns.js").Row[], first: number, last: number, columns: import("./columns.js").Column[], rowHeight: number}} view
   */
  render(view) {
    const { rows, first, last, columns, rowHeight } = view;
    this.renderHeader(columns);
    setAttributes(this.element, {
      "aria-rowcount": rows.length + 1,
      "aria-colcount": columns.length,
      "aria-label": this.gantt.strings.gridLabel,
      "aria-readonly": this.gantt.readOnly ? "true" : false,
    });
    this.body.style.setProperty("height", `${rows.length * rowHeight}px`);
    const wanted = new Set();
    let previous = null;
    for (let index = first; index < last; index += 1) {
      const row = rows[index];
      wanted.add(row.id);
      const element = this.renderRow(row, index, columns, rowHeight);
      if (element.previousElementSibling !== previous || element.parentElement !== this.body) {
        if (previous) previous.after(element);
        else this.body.prepend(element);
      }
      previous = element;
    }
    for (const [id, entry] of this.rows) {
      if (wanted.has(id)) continue;
      entry.element.remove();
      this.rows.delete(id);
    }
    this.updateTabStop();
  }

  /**
   * @param {import("./columns.js").Row} row
   * @param {number} index
   * @param {import("./columns.js").Column[]} columns
   * @param {number} rowHeight
   * @returns {HTMLElement}
   */
  renderRow(row, index, columns, rowHeight) {
    const gantt = this.gantt;
    const selected = gantt.selection.has(row.id);
    const focused = gantt.focus.taskId === row.id;
    const pending = gantt.pending.has(row.id);
    const texts = columns.map((column) => column.text(row));
    const signature = [
      index,
      selected,
      focused ? gantt.focus.column : -1,
      pending,
      row.expanded,
      row.level,
      row.schedule?.critical,
      gantt.invalidCells.get(row.id) ?? "",
      ...texts,
    ].join("\u0001");
    let entry = this.rows.get(row.id);
    if (!entry) {
      entry = { element: html("div", { role: "row", "data-task-id": row.id }), signature: "" };
      this.rows.set(row.id, entry);
    }
    entry.element.style.setProperty("top", `${index * rowHeight}px`);
    if (entry.signature === signature) {
      entry.element.classList.toggle("sg-row-alt", index % 2 === 1);
      return entry.element;
    }
    entry.signature = signature;
    const element = entry.element;
    setAttributes(element, {
      class: rowClass(row, selected, pending),
      "aria-rowindex": index + 2,
      "aria-level": row.level,
      "aria-expanded": row.hasChildren ? String(row.expanded) : null,
      "aria-selected": String(selected),
      "aria-busy": pending ? "true" : null,
    });
    element.classList.toggle("sg-row-alt", index % 2 === 1);
    element.replaceChildren(
      ...columns.map((column, columnIndex) =>
        this.renderCell(row, column, columnIndex, texts[columnIndex]),
      ),
    );
    return element;
  }

  /**
   * @param {import("./columns.js").Row} row
   * @param {import("./columns.js").Column} column
   * @param {number} columnIndex
   * @param {string} text
   * @returns {HTMLElement}
   */
  renderCell(row, column, columnIndex, text) {
    const gantt = this.gantt;
    const focused = gantt.focus.taskId === row.id && gantt.focus.column === columnIndex;
    const invalid = gantt.invalidCells.get(row.id);
    const isInvalid = invalid && invalid.field === column.field;
    const cell = html("div", {
      class: `sg-cell sg-align-${column.align}${column.tree ? " sg-tree-cell" : ""}`,
      role: "gridcell",
      "aria-colindex": columnIndex + 1,
      "data-column": column.id,
      tabindex: focused ? "0" : "-1",
      "aria-readonly": column.editor && !gantt.readOnly ? null : "true",
      "aria-invalid": isInvalid ? "true" : null,
      "aria-describedby": isInvalid ? `${gantt.uid}-error` : null,
    });
    if (column.tree) {
      cell.style.setProperty("--sg-level", String(row.level - 1));
      const toggle = html(
        "span",
        {
          class: "sg-toggle",
          "aria-hidden": "true",
          "data-action": row.hasChildren ? "toggle" : null,
        },
        [row.hasChildren ? (row.expanded ? "▾" : "▸") : ""],
      );
      const icon = html("span", {
        class: `sg-type-icon sg-type-${row.summary ? "summary" : (row.task.type ?? "task")}`,
        "aria-hidden": "true",
      });
      const label = html("span", { class: "sg-cell-text" }, [text]);
      cell.append(toggle, icon, label);
      cell.setAttribute("aria-label", this.describe(row));
      return cell;
    }
    cell.textContent = text;
    return cell;
  }

  /**
   * The accessible name of a task's tree cell.
   * @param {import("./columns.js").Row} row
   * @returns {string}
   */
  describe(row) {
    const { strings, options } = this.gantt;
    const locale = options.locale;
    if (!row.dates) return row.task.name;
    const long = (day) => formatLongDate(day, locale);
    if (row.milestone) {
      const typeLabel =
        { payment: strings.payment, access: strings.access, "need-by": strings.needBy }[
          row.task.type
        ] ?? strings.milestone;
      return fill(strings.milestoneRow, {
        name: row.task.name,
        type: typeLabel,
        date: long(row.dates.start),
      });
    }
    const days = row.dates.duration === 1 ? strings.workingDay : strings.workingDays;
    const base = fill(strings.taskRow, {
      name: row.task.name,
      start: long(row.dates.start),
      finish: long(row.dates.finish),
      duration: row.dates.duration,
      days,
    });
    return row.schedule?.critical ? `${base}, ${strings.critical}` : base;
  }

  /** Keeps exactly one tab stop: the focused cell, or the grid when it is scrolled out. */
  updateTabStop() {
    const focusedRendered = this.rows.has(this.gantt.focus.taskId ?? "");
    this.element.tabIndex = focusedRendered ? -1 : 0;
  }

  /**
   * @param {string} taskId
   * @param {number} column
   * @returns {HTMLElement|null}
   */
  cell(taskId, column) {
    return /** @type {HTMLElement|null} */ (
      this.rows.get(taskId)?.element.children[column] ?? null
    );
  }

  destroy() {
    this.rows.clear();
    this.element.remove();
  }
}

/**
 * @param {import("./columns.js").Row} row
 * @param {boolean} selected
 * @param {boolean} pending
 * @returns {string}
 */
function rowClass(row, selected, pending) {
  const classes = ["sg-row"];
  if (row.summary) classes.push("sg-row-summary");
  if (row.milestone) classes.push("sg-row-milestone");
  if (selected) classes.push("sg-selected");
  if (pending) classes.push("sg-pending");
  if (row.schedule?.critical) classes.push("sg-row-critical");
  return classes.join(" ");
}
