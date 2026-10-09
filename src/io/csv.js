// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { programmeToCSV } from "../engine/csv.js";

export { programmeToCSV, csvCell, minorToDecimal } from "../engine/csv.js";

/**
 * CSV export, `streamlined-gantt/io/csv`: an optional entry so the core
 * bundle stays small.
 *
 * @example
 * import { exportCSV } from "streamlined-gantt/io/csv";
 * const csv = exportCSV(gantt); // UTF-8 text with CRLF line ends, ready for Excel
 *
 * @module streamlined-gantt/io/csv
 */

/**
 * The programme as CSV: one row per task with dates, float, money and custom fields.
 * @param {import("../model/controller.js").ProgrammeController} controller a `Gantt` or `ProgrammeController`
 * @param {{ids?: string[]}} [options] `ids` limits the rows to those tasks
 * @returns {string}
 */
export function exportCSV(controller, options) {
  return programmeToCSV(controller.analysis, controller.store.data, options);
}
