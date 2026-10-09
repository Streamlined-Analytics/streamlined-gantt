// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toISO } from "./dates.js";

/**
 * CSV export (RFC 4180, CRLF line endings). Dates are ISO `YYYY-MM-DD` with
 * inclusive finishes; money is written in major units with two decimals.
 * Text cells that a spreadsheet would treat as a formula are prefixed with an
 * apostrophe to block CSV injection.
 *
 * @module engine/csv
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let text = String(value);
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {number} minor integer minor units
 * @returns {string}
 */
export function minorToDecimal(minor) {
  const sign = minor < 0 ? "-" : "";
  const magnitude = Math.abs(minor);
  return `${sign}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Programme} programme
 * @param {{ids?: string[]}} [options] restrict and order rows (default: every task in row order)
 * @returns {string}
 */
export function programmeToCSV(analysis, programme, options = {}) {
  const ids = options.ids ?? analysis.order;
  const predecessors = new Map();
  for (const link of programme.links ?? []) {
    const type = link.type ?? "FS";
    const lag = link.lag ?? 0;
    const label = `${link.from}${type}${lag > 0 ? `+${lag}` : lag < 0 ? lag : ""}`;
    predecessors.set(link.to, [...(predecessors.get(link.to) ?? []), label]);
  }
  const definitions = analysis.fields.list();
  const header = [
    "id",
    "wbs",
    "name",
    "type",
    "level",
    "start",
    "finish",
    "duration",
    "progress",
    "predecessors",
    "value",
    ...definitions.map((definition) => definition.label ?? definition.key),
  ];
  const rows = [header.map(csvCell).join(",")];
  for (const id of ids) rows.push(csvRow(analysis, id, predecessors).map(csvCell).join(","));
  return `${rows.join("\r\n")}\r\n`;
}

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {string} id
 * @param {Map<string, string[]>} predecessors
 * @returns {unknown[]}
 */
function csvRow(analysis, id, predecessors) {
  const task = analysis.taskById.get(id);
  const dates = analysis.resolved.get(id);
  const values = analysis.fieldValues.get(id) ?? {};
  const type = analysis.tree.summaries.has(id) ? "summary" : (task.type ?? "task");
  const dateCells = dates
    ? [
        toISO(dates.start),
        toISO(dates.finish),
        dates.duration,
        Math.round(dates.progress * 100) / 100,
      ]
    : ["", "", "", ""];
  return [
    task.id,
    task.wbs ?? "",
    task.name,
    type,
    analysis.depth.get(id) ?? 1,
    ...dateCells,
    (predecessors.get(id) ?? []).join(";"),
    typeof task.value === "number" ? minorToDecimal(task.value) : "",
    ...analysis.fields
      .list()
      .map((definition) => formatFieldForCSV(definition, values[definition.key])),
  ];
}

/**
 * @param {import("./fields.js").FieldDefinition} definition
 * @param {unknown} value
 * @returns {unknown}
 */
function formatFieldForCSV(definition, value) {
  if (value === null || value === undefined) return "";
  if (definition.type === "currency" && typeof value === "number")
    return minorToDecimal(Math.round(value));
  return value;
}
