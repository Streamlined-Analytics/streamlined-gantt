// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { isISODate } from "./dates.js";
import { pathSegment } from "./schema.js";

/**
 * Custom per-task fields defined in configuration (cost, charge, quantity,
 * margin…). Values live in `task.fields[key]`. Computed fields are derived
 * from the task on demand and are never stored, so `toJSON()` round-trips.
 *
 * @module engine/fields
 */

/**
 * @typedef {"text"|"number"|"integer"|"currency"|"percent"|"date"|"select"|"boolean"} FieldType
 */

/**
 * @typedef {"sum"|"min"|"max"|"avg"|"weighted"|((rows: object[], sums: Record<string, number>) => unknown)} Rollup
 */

/**
 * @typedef {object} FieldDefinition
 * @property {string} key
 * @property {string} [label]
 * @property {FieldType} [type] default "text"
 * @property {Rollup} [rollup] how summary rows and project totals combine the field
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [pattern] regular expression source for text fields
 * @property {(string|{value: string, label: string})[]} [options] for select fields
 * @property {boolean} [required]
 * @property {boolean} [readOnly]
 * @property {string} [unit] suffix shown in the editor and grid, e.g. "m²"
 * @property {boolean} [multiline]
 * @property {(task: object) => unknown} [compute] derives a read-only value
 * @property {(value: unknown, task: object, context: object) => string|null|undefined} [validate]
 * @property {boolean|{width?: number, title?: string}} [column] show as a grid column
 * @property {boolean} [editor] show in the built-in editor (default true)
 */

const NUMERIC_TYPES = new Set(["number", "integer", "currency", "percent"]);

/**
 * @param {FieldDefinition} definition
 * @returns {boolean}
 */
export function isNumericField(definition) {
  return NUMERIC_TYPES.has(definition.type ?? "text");
}

/**
 * @param {FieldDefinition} definition
 * @returns {string[]}
 */
function optionValues(definition) {
  return (definition.options ?? []).map((option) =>
    typeof option === "string" ? option : option.value,
  );
}

/**
 * Type check only: is the value storable for this field type?
 * @param {FieldDefinition} definition
 * @param {unknown} value
 * @returns {string|null}
 */
export function typeProblem(definition, value) {
  if (value === null || value === undefined || value === "") return null;
  const type = definition.type ?? "text";
  if (type === "currency" || type === "integer") {
    return Number.isSafeInteger(value) ? null : "must be a whole number";
  }
  if (type === "number" || type === "percent") {
    return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
  }
  if (type === "date") return isISODate(value) ? null : "must be a date (YYYY-MM-DD)";
  if (type === "boolean") return typeof value === "boolean" ? null : "must be true or false";
  if (type === "select") {
    return optionValues(definition).includes(String(value)) ? null : "is not one of the options";
  }
  return typeof value === "string" ? null : "must be text";
}

/**
 * Declarative rules: required, min, max, step, pattern.
 * @param {FieldDefinition} definition
 * @param {unknown} value
 * @returns {string|null}
 */
function ruleProblem(definition, value) {
  const empty = value === null || value === undefined || value === "";
  if (empty) return definition.required ? "is required" : null;
  if (typeof value === "number") {
    if (definition.min !== undefined && value < definition.min)
      return `must be at least ${definition.min}`;
    if (definition.max !== undefined && value > definition.max)
      return `must be at most ${definition.max}`;
    const step = definition.step;
    const offStep = step && Math.abs(value / step - Math.round(value / step)) > 1e-9;
    if (offStep) return `must be a multiple of ${step}`;
  }
  if (
    typeof value === "string" &&
    definition.pattern &&
    !new RegExp(definition.pattern).test(value)
  ) {
    return "is not in the expected format";
  }
  return null;
}

/**
 * The configured custom fields, with validation, computed values and roll-ups.
 */
export class FieldRegistry {
  /** @param {FieldDefinition[]} [definitions] */
  constructor(definitions = []) {
    /** @type {FieldDefinition[]} */
    this.definitions = definitions.map((definition) => ({ type: "text", ...definition }));
    /** @type {Map<string, FieldDefinition>} */
    this.byKey = new Map(this.definitions.map((definition) => [definition.key, definition]));
  }

  /**
   * @param {string} key
   * @returns {FieldDefinition|undefined}
   */
  get(key) {
    return this.byKey.get(key);
  }

  /** @returns {FieldDefinition[]} */
  list() {
    return this.definitions;
  }

  /** @returns {FieldDefinition[]} */
  computed() {
    return this.definitions.filter((definition) => typeof definition.compute === "function");
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  isEditable(key) {
    const definition = this.byKey.get(key);
    return Boolean(definition) && !definition.readOnly && typeof definition.compute !== "function";
  }

  /**
   * A task's field value, computing derived fields.
   * @param {{fields?: Record<string, unknown>}} task
   * @param {string} key
   * @returns {unknown}
   */
  valueOf(task, key) {
    const definition = this.byKey.get(key);
    if (definition?.compute) return this.safeCompute(definition, task);
    return task.fields?.[key];
  }

  /**
   * Stored values merged with computed ones (for display and roll-ups).
   * @param {{fields?: Record<string, unknown>}} task
   * @returns {Record<string, unknown>}
   */
  valuesOf(task) {
    const values = { ...(task.fields ?? {}) };
    for (const definition of this.computed()) {
      values[definition.key] = this.safeCompute(definition, { ...task, fields: values });
    }
    return values;
  }

  /**
   * @param {FieldDefinition} definition
   * @param {object} task
   * @returns {unknown}
   */
  safeCompute(definition, task) {
    const withFields = { ...task, fields: /** @type {any} */ (task).fields ?? {} };
    const value = definition.compute(withFields);
    return value === undefined || (typeof value === "number" && !Number.isFinite(value))
      ? null
      : value;
  }

  /**
   * Full validation of one value: type, declarative rules, then `validate()`.
   * @param {string} key
   * @param {unknown} value
   * @param {object} task
   * @param {object} [context]
   * @returns {string|null} a message, or null when valid
   */
  validate(key, value, task, context = {}) {
    const definition = this.byKey.get(key);
    if (!definition) return null;
    const problem = typeProblem(definition, value) ?? ruleProblem(definition, value);
    if (problem) return `${definition.label ?? key} ${problem}`;
    const custom = definition.validate?.(value, task, context);
    return custom ? String(custom) : null;
  }

  /**
   * Schema hook used by `load()`: type-checks stored values of known fields.
   * Unknown keys are kept untouched.
   * @param {any} task
   * @param {string} path
   * @param {{add: (path: string, message: string) => void}} problems
   */
  checkStored(task, path, problems) {
    for (const [key, value] of Object.entries(task.fields ?? {})) {
      const definition = this.byKey.get(key);
      if (!definition || definition.compute) continue;
      const problem = typeProblem(definition, value);
      if (problem) problems.add(`${path}.${pathSegment(key)}`, problem);
    }
  }

  /**
   * Sums of every numeric field over the given value rows.
   * @param {Record<string, unknown>[]} valueRows
   * @returns {Record<string, number>}
   */
  sums(valueRows) {
    /** @type {Record<string, number>} */
    const totals = {};
    for (const definition of this.definitions) {
      if (!isNumericField(definition) || definition.compute) continue;
      totals[definition.key] = 0;
      for (const row of valueRows) {
        const value = row[definition.key];
        if (typeof value === "number") totals[definition.key] += value;
      }
    }
    return totals;
  }

  /**
   * Rolls a field up over leaf rows.
   * @param {FieldDefinition} definition
   * @param {{values: Record<string, unknown>, duration: number, task: object}[]} rows
   * @param {Record<string, number>} sums
   * @returns {unknown}
   */
  rollup(definition, rows, sums) {
    const rule = definition.rollup;
    if (typeof rule === "function") {
      const value = rule(
        rows.map((row) => ({ ...row.task, fields: row.values })),
        sums,
      );
      return value === undefined ? null : value;
    }
    const numbers = rows
      .map((row) => ({ value: row.values[definition.key], weight: row.duration }))
      .filter((entry) => typeof entry.value === "number");
    if (!rule || numbers.length === 0) return null;
    return aggregate(rule, /** @type {{value: number, weight: number}[]} */ (numbers));
  }
}

/**
 * @param {"sum"|"min"|"max"|"avg"|"weighted"} rule
 * @param {{value: number, weight: number}[]} numbers
 * @returns {number}
 */
function aggregate(rule, numbers) {
  const values = numbers.map((entry) => entry.value);
  if (rule === "min") return Math.min(...values);
  if (rule === "max") return Math.max(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (rule === "avg") return total / values.length;
  if (rule === "weighted") {
    const weight = numbers.reduce((sum, entry) => sum + entry.weight, 0);
    if (weight === 0) return total / values.length;
    return numbers.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight;
  }
  return total;
}
