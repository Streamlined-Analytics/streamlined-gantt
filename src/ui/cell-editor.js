// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { minorUnitScale, parseMoney } from "../engine/format.js";
import { isLocked } from "../engine/model.js";
import { html } from "./dom.js";

/**
 * Inline cell editing (Enter or F2 on a cell). Enter or leaving the cell
 * commits through `updateTask(…, {cause: "grid"})`; Esc cancels. A value that
 * fails validation keeps the editor open with `aria-invalid` and an
 * `aria-describedby` message.
 *
 * @module ui/cell-editor
 */

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {string} taskId
 * @param {number} columnIndex
 * @returns {boolean}
 */
export function startCellEdit(gantt, taskId, columnIndex) {
  const column = gantt.columns[columnIndex];
  const row = gantt.rowById(taskId);
  const cell = gantt.grid.cell(taskId, columnIndex);
  const blocked = !column?.editor || !row || !cell || gantt.readOnly || isLocked(row.task);
  if (blocked || (row.summary && column.field !== "name")) return false;
  if (row.milestone && ["finish", "duration", "progress"].includes(column.field)) return false;
  const kind = column.editor;
  const currency = gantt.currency;
  const errorId = `${gantt.uid}-error`;
  const input = /** @type {HTMLInputElement} */ (
    html("input", {
      class: "sg-cell-input",
      type:
        kind === "date"
          ? "date"
          : ["duration", "number", "integer", "percent"].includes(kind)
            ? "number"
            : "text",
      "aria-label": column.title,
      "aria-describedby": errorId,
    })
  );
  input.value = initialValue(gantt, row, column, kind, currency);
  cell.classList.add("sg-editing");
  cell.replaceChildren(input);
  gantt.editingCell = { taskId, columnIndex };
  input.focus();
  input.select?.();
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    if (!commit) {
      finished = true;
      gantt.editingCell = null;
      gantt.invalidCells.delete(taskId);
      gantt.grid.rows.get(taskId).signature = "";
      gantt.focusTask(taskId, { column: columnIndex });
      return;
    }
    const parsed = parse(kind, input.value, currency);
    const patch = parsed.error ? null : buildPatch(column.field, parsed.value);
    const message = parsed.error ?? validate(gantt, row, column.field, parsed.value);
    if (message) {
      gantt.invalidCells.set(taskId, { field: column.field, message });
      gantt.errorRegion.textContent = message;
      input.setAttribute("aria-invalid", "true");
      gantt.emit("validation-error", { taskId, field: column.field, value: input.value, message });
      input.focus();
      return;
    }
    finished = true;
    gantt.editingCell = null;
    gantt.invalidCells.delete(taskId);
    gantt.errorRegion.textContent = "";
    gantt.grid.rows.get(taskId).signature = "";
    gantt
      .updateTask(taskId, patch, { cause: "grid" })
      .then(() => gantt.focusTask(taskId, { column: columnIndex }));
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  return true;
}

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {import("./columns.js").Row} row
 * @param {import("./columns.js").Column} column
 * @param {string} kind
 * @param {string} currency
 * @returns {string}
 */
function initialValue(gantt, row, column, kind, currency) {
  const task = gantt.getTask(row.id);
  const value = column.field.startsWith("fields.")
    ? task.fields?.[column.field.slice(7)]
    : task[column.field];
  if (value === undefined || value === null) return "";
  if (kind === "currency")
    return (Number(value) / minorUnitScale(currency)).toFixed(Math.log10(minorUnitScale(currency)));
  if (kind === "percent" || column.field === "progress")
    return String(Math.round(Number(value) * 1000) / 10);
  return String(value);
}

/**
 * @param {string} kind
 * @param {string} text
 * @param {string} currency
 * @returns {{value?: unknown, error?: string}}
 */
function parse(kind, text, currency) {
  const value = text.trim();
  if (value === "") return { value: null };
  if (kind === "currency") {
    const minor = parseMoney(value, { currency });
    return Number.isNaN(minor) ? { error: "Enter an amount" } : { value: minor };
  }
  if (kind === "percent") {
    const percent = Number(value);
    return Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? { value: Math.round(percent * 10) / 1000 }
      : { error: "Enter a percentage from 0 to 100" };
  }
  if (kind === "duration" || kind === "integer") {
    const number = Number(value);
    const valid = Number.isInteger(number) && (kind !== "duration" || number >= 1);
    return valid ? { value: number } : { error: "Enter a whole number of working days" };
  }
  if (kind === "number")
    return Number.isFinite(Number(value)) ? { value: Number(value) } : { error: "Enter a number" };
  return { value };
}

/**
 * @param {string} field
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function buildPatch(field, value) {
  if (field.startsWith("fields.")) return { fields: { [field.slice(7)]: value } };
  return { [field]: value };
}

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {import("./columns.js").Row} row
 * @param {string} field
 * @param {unknown} value
 * @returns {string|null}
 */
function validate(gantt, row, field, value) {
  if (field === "name" && !value) return gantt.strings.invalid_required;
  if (!field.startsWith("fields.")) return null;
  const key = field.slice(7);
  return gantt.fields.validate(key, value, {
    ...row.task,
    fields: { ...row.task.fields, [key]: value },
  });
}
