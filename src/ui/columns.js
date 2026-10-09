// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "../engine/dates.js";
import { formatDate, formatMoney, formatPercent } from "../engine/format.js";

/**
 * Grid column definitions. Built-in columns are addressed by name; custom
 * fields by `fields.<key>`. Every cell renders as text.
 *
 * @module ui/columns
 */

/**
 * @typedef {object} ColumnConfig
 * @property {string} field "wbs" | "name" | "start" | "finish" | "duration" | "progress" | "float" | "variance" | "value" | "trade" | "crew" | "fields.<key>"
 * @property {string} [title]
 * @property {number} [width]
 * @property {boolean} [editable]
 */

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {import("../engine/types.js").Task} task
 * @property {import("../engine/analysis.js").ResolvedTask|undefined} dates
 * @property {number} level
 * @property {boolean} summary
 * @property {boolean} milestone
 * @property {boolean} hasChildren
 * @property {boolean} expanded
 * @property {import("../engine/scheduler.js").TaskSchedule|undefined} schedule
 * @property {Record<string, unknown>} values custom field values (computed and rolled up)
 * @property {number|null} variance baseline finish variance in working days
 */

/**
 * @typedef {object} Column
 * @property {string} id
 * @property {string} field
 * @property {string} title
 * @property {number} width
 * @property {"start"|"end"} align
 * @property {boolean} tree
 * @property {string|null} editor input kind when inline-editable, else null
 * @property {(row: Row) => string} text
 */

/**
 * @param {number|null|undefined} value
 * @returns {string}
 */
function signed(value) {
  if (value === null || value === undefined) return "";
  return value > 0 ? `+${value}` : String(value);
}

/**
 * @param {import("../engine/fields.js").FieldDefinition} definition
 * @param {unknown} value
 * @param {{locale: string, currency: string}} context
 * @returns {string}
 */
export function formatFieldValue(definition, value, context) {
  if (value === null || value === undefined || value === "") return "";
  const type = definition.type ?? "text";
  if (type === "currency" && typeof value === "number")
    return formatMoney(Math.round(value), context);
  if (type === "percent" && typeof value === "number") return formatPercent(value, context.locale);
  if (type === "date" && typeof value === "string") return formatDate(toDay(value), context.locale);
  if (type === "boolean") return value ? "Yes" : "No";
  if ((type === "number" || type === "integer") && typeof value === "number") {
    const number = new Intl.NumberFormat(context.locale, { maximumFractionDigits: 2 }).format(
      value,
    );
    return definition.unit ? `${number} ${definition.unit}` : number;
  }
  return String(value);
}

/**
 * @param {{locale: string, currency: string, strings: Record<string, string>, fields: import("../engine/fields.js").FieldRegistry}} context
 * @returns {Record<string, Omit<Column, "id"|"field">>}
 */
function builtInColumns(context) {
  const { strings, locale } = context;
  const date = (day) => (day === undefined ? "" : formatDate(day, locale));
  return {
    wbs: {
      title: strings.columnWbs,
      width: 52,
      align: "start",
      tree: false,
      editor: null,
      text: (row) => row.task.wbs ?? "",
    },
    name: {
      title: strings.columnName,
      width: 240,
      align: "start",
      tree: true,
      editor: "text",
      text: (row) => row.task.name,
    },
    start: {
      title: strings.columnStart,
      width: 92,
      align: "start",
      tree: false,
      editor: "date",
      text: (row) => date(row.dates?.start),
    },
    finish: {
      title: strings.columnFinish,
      width: 92,
      align: "start",
      tree: false,
      editor: "date",
      text: (row) => date(row.dates?.finish),
    },
    duration: {
      title: strings.columnDuration,
      width: 56,
      align: "end",
      tree: false,
      editor: "duration",
      text: (row) => (row.dates ? String(row.dates.duration) : ""),
    },
    progress: {
      title: strings.columnProgress,
      width: 72,
      align: "end",
      tree: false,
      editor: "percent",
      text: (row) => (row.dates ? formatPercent(row.dates.progress, locale) : ""),
    },
    float: {
      title: strings.columnFloat,
      width: 56,
      align: "end",
      tree: false,
      editor: null,
      text: (row) => signed(row.schedule?.totalFloat),
    },
    variance: {
      title: strings.columnVariance,
      width: 56,
      align: "end",
      tree: false,
      editor: null,
      text: (row) => signed(row.variance),
    },
    value: {
      title: strings.columnValue,
      width: 96,
      align: "end",
      tree: false,
      editor: "currency",
      text: (row) =>
        typeof row.task.value === "number" ? formatMoney(row.task.value, context) : "",
    },
    trade: {
      title: strings.columnTrade,
      width: 100,
      align: "start",
      tree: false,
      editor: "text",
      text: (row) => row.task.trade ?? "",
    },
    crew: {
      title: strings.columnCrew,
      width: 90,
      align: "start",
      tree: false,
      editor: "text",
      text: (row) => row.task.crew ?? "",
    },
  };
}

/**
 * Resolves the configured columns.
 * @param {(ColumnConfig|string)[]|undefined} configured
 * @param {{locale: string, currency: string, strings: Record<string, string>, fields: import("../engine/fields.js").FieldRegistry, hidden?: string[]}} context
 * @returns {Column[]}
 */
export function buildColumns(configured, context) {
  const builtIns = builtInColumns(context);
  const fieldColumns = context.fields
    .list()
    .filter((definition) => definition.column)
    .map((definition) => ({
      field: `fields.${definition.key}`,
      ...(typeof definition.column === "object" ? definition.column : {}),
    }));
  const requested = configured ?? ["wbs", "name", "start", "finish", "duration", ...fieldColumns];
  const hidden = new Set(context.hidden ?? []);
  return requested
    .map((entry) => (typeof entry === "string" ? { field: entry } : entry))
    .filter((entry) => !hidden.has(entry.field))
    .map((entry) => resolveColumn(entry, builtIns, context))
    .filter(Boolean);
}

/**
 * @param {ColumnConfig} entry
 * @param {ReturnType<typeof builtInColumns>} builtIns
 * @param {{locale: string, currency: string, fields: import("../engine/fields.js").FieldRegistry}} context
 * @returns {Column|null}
 */
function resolveColumn(entry, builtIns, context) {
  const base = builtIns[entry.field];
  if (base) {
    const editor = entry.editable === false ? null : base.editor;
    return {
      ...base,
      id: entry.field,
      field: entry.field,
      title: entry.title ?? base.title,
      width: entry.width ?? base.width,
      editor,
    };
  }
  if (!entry.field.startsWith("fields.")) return null;
  const key = entry.field.slice(7);
  const definition = context.fields.get(key) ?? { key, type: "text" };
  const numeric = ["number", "integer", "currency", "percent"].includes(definition.type ?? "text");
  const editable = entry.editable !== false && context.fields.isEditable(key);
  return {
    id: entry.field,
    field: entry.field,
    title: entry.title ?? definition.label ?? key,
    width: entry.width ?? (numeric ? 96 : 120),
    align: numeric ? "end" : "start",
    tree: false,
    editor: editable ? (definition.type ?? "text") : null,
    text: (row) => formatFieldValue(definition, row.values[key], context),
  };
}
