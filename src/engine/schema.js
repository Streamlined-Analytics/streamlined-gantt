// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { isISODate } from "./dates.js";
import { findCycle } from "./graph.js";

/**
 * @typedef {object} ValidationProblem
 * @property {string} path JSON Pointer (RFC 6901), e.g. `/tasks/3/start`
 * @property {string} message
 */

export const SCHEMA_ID = "streamlined-gantt/1";
/** Largest duration or lag accepted: about 38 years of working days, far beyond any programme. */
export const MAX_WORKING_DAYS = 10_000;
export const TASK_TYPES = [
  "task",
  "summary",
  "milestone",
  "payment",
  "access",
  "need-by",
  "reference",
];
export const LINK_TYPES = ["FS", "SS", "FF", "SF"];
export const CONSTRAINT_TYPES = ["ASAP", "SNET", "FNLT"];
export const DELAY_KINDS = ["weather", "access", "information", "variation", "client", "other"];

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const PROGRAMME_KEYS = new Set([
  "schema",
  "id",
  "name",
  "currency",
  "dataDate",
  "contractCompletion",
  "revision",
  "revisions",
  "defaultCalendar",
  "calendars",
  "tasks",
  "links",
  "baselines",
  "delayEvents",
  "markers",
  "fields",
]);

const TASK_KEYS = new Set([
  "id",
  "name",
  "type",
  "parent",
  "wbs",
  "start",
  "finish",
  "duration",
  "calendar",
  "progress",
  "actualStart",
  "actualFinish",
  "constraint",
  "value",
  "valuePercent",
  "trade",
  "crew",
  "owner",
  "locked",
  "notes",
  "source",
  "style",
  "className",
  "category",
  "collapsed",
  "fields",
]);

const LINK_KEYS = new Set(["id", "from", "to", "type", "lag", "style", "category"]);

/**
 * Thrown by `load()` and `validateProgramme()` with every problem found.
 */
export class GanttValidationError extends Error {
  /** @param {ValidationProblem[]} problems */
  constructor(problems) {
    const summary = problems
      .slice(0, 5)
      .map((problem) => `${problem.path}: ${problem.message}`)
      .join("; ");
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : "";
    super(`Invalid programme data: ${summary}${more}`);
    this.name = "GanttValidationError";
    this.problems = problems;
  }
}

/** @param {unknown} value */
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

/** @param {unknown} value */
const isOptionalISODate = (value) => value === undefined || value === null || isISODate(value);

/** @param {unknown} value */
const isFraction = (value) => typeof value === "number" && value >= 0 && value <= 1;

/**
 * Converts an internal dotted path (`tasks[3].start`) to a JSON Pointer (`/tasks/3/start`).
 * @param {string} path
 * @returns {string}
 */
function toPointer(path) {
  if (path === "$") return "";
  const dotted = path.replace(/^\$\./, "").replace(/\[(\d+)\]/g, ".$1");
  return `/${dotted
    .split(".")
    .map((segment) => unescapeSegment(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}

const DOT_STANDIN = "\u0001";
const BRACKET_STANDIN = "\u0002";

/**
 * Escapes a user-controlled key (an id or a custom field key) before it is
 * appended to an internal dotted path, so a key containing "." or "[" still
 * becomes a single JSON Pointer segment.
 * @param {string} key
 * @returns {string}
 */
export function pathSegment(key) {
  return String(key).replaceAll(".", DOT_STANDIN).replaceAll("[", BRACKET_STANDIN);
}

/**
 * @param {string} segment
 * @returns {string}
 */
function unescapeSegment(segment) {
  return segment.replaceAll(DOT_STANDIN, ".").replaceAll(BRACKET_STANDIN, "[");
}

/**
 * Collects problems for one validation pass.
 */
class ProblemList {
  constructor() {
    /** @type {ValidationProblem[]} */
    this.items = [];
  }

  /**
   * @param {string} path
   * @param {string} message
   */
  add(path, message) {
    this.items.push({ path: toPointer(path), message });
  }

  /**
   * @param {boolean} condition
   * @param {string} path
   * @param {string} message
   */
  require(condition, path, message) {
    if (!condition) this.add(path, message);
  }
}

/**
 * Rejects prototype-polluting keys at any depth.
 * @param {unknown} value
 * @param {string} path
 * @param {ProblemList} problems
 * @param {number} depth
 */
function checkForbiddenKeys(value, path, problems, depth = 0) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      problems.add(`${path}.${pathSegment(key)}`, "forbidden property name");
      continue;
    }
    checkForbiddenKeys(value[key], `${path}.${pathSegment(key)}`, problems, depth + 1);
  }
}

/**
 * @param {object} item
 * @param {Set<string>} allowed
 * @param {string} path
 * @param {ProblemList} problems
 */
function checkUnknownKeys(item, allowed, path, problems) {
  for (const key of Object.keys(item)) {
    if (allowed.has(key) || key.startsWith("x-")) continue;
    problems.add(
      `${path}.${pathSegment(key)}`,
      "unknown property (use an x- prefix for extensions)",
    );
  }
}

/**
 * @param {unknown[]} items
 * @param {string} collection
 * @param {ProblemList} problems
 * @returns {Set<string>}
 */
function checkIds(items, collection, problems) {
  const seen = new Set();
  items.forEach((item, index) => {
    const path = `${collection}[${index}].id`;
    const id = /** @type {any} */ (item)?.id;
    if (!isNonEmptyString(id)) {
      problems.add(path, "must be a non-empty string");
      return;
    }
    if (seen.has(id)) problems.add(path, `duplicate id "${id}"`);
    seen.add(id);
  });
  return seen;
}

/**
 * @param {any} calendar
 * @param {string} path
 * @param {ProblemList} problems
 */
function validateCalendar(calendar, path, problems) {
  if (!isPlainObject(calendar)) {
    problems.add(path, "must be an object");
    return;
  }
  const workWeek = calendar.workWeek;
  if (workWeek !== undefined) {
    const validDays =
      Array.isArray(workWeek) &&
      workWeek.length > 0 &&
      workWeek.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    problems.require(validDays, `${path}.workWeek`, "must list ISO weekdays 1-7");
  }
  for (const listName of ["nonWorking", "working"]) {
    const list = calendar[listName];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.add(`${path}.${listName}`, "must be an array");
      continue;
    }
    list.forEach((entry, index) =>
      validateException(entry, `${path}.${listName}[${index}]`, problems),
    );
  }
}

/**
 * @param {any} entry
 * @param {string} path
 * @param {ProblemList} problems
 */
function validateException(entry, path, problems) {
  if (!isPlainObject(entry)) {
    problems.add(path, "must be an object");
    return;
  }
  if (entry.date !== undefined) {
    problems.require(isISODate(entry.date), `${path}.date`, "must be an ISO date");
    return;
  }
  const validRange = isISODate(entry.from) && isISODate(entry.to) && entry.from <= entry.to;
  problems.require(validRange, path, "needs a date, or from/to ISO dates with from <= to");
}

/**
 * @param {any} task
 * @param {string} path
 * @param {{taskIds: Set<string>, calendarIds: Set<string>, fieldValidator?: Function}} context
 * @param {ProblemList} problems
 */
function validateTask(task, path, context, problems) {
  if (!isPlainObject(task)) {
    problems.add(path, "must be an object");
    return;
  }
  checkUnknownKeys(task, TASK_KEYS, path, problems);
  problems.require(typeof task.name === "string", `${path}.name`, "must be a string");
  if (task.type !== undefined) {
    problems.require(
      TASK_TYPES.includes(task.type),
      `${path}.type`,
      `must be one of ${TASK_TYPES.join(", ")}`,
    );
  }
  validateTaskDates(task, path, problems);
  validateTaskRelations(task, path, context, problems);
  validateTaskNumbers(task, path, problems);
  validateAppearance(task, path, problems);
  if (task.fields !== undefined) {
    if (!isPlainObject(task.fields)) problems.add(`${path}.fields`, "must be an object");
    else context.fieldValidator?.(task, `${path}.fields`, problems);
  }
}

/**
 * @param {any} task
 * @param {string} path
 * @param {ProblemList} problems
 */
function validateTaskDates(task, path, problems) {
  const isSummary = task.type === "summary";
  if (!isSummary) problems.require(isISODate(task.start), `${path}.start`, "must be an ISO date");
  if (isSummary && task.start !== undefined) {
    problems.require(isISODate(task.start), `${path}.start`, "must be an ISO date");
  }
  for (const key of ["finish", "actualStart", "actualFinish"]) {
    problems.require(isOptionalISODate(task[key]), `${path}.${key}`, "must be an ISO date or null");
  }
  if (isISODate(task.start) && isISODate(task.finish)) {
    problems.require(task.finish >= task.start, `${path}.finish`, "must not be before start");
  }
  if (task.duration !== undefined) {
    const valid =
      Number.isInteger(task.duration) && task.duration >= 0 && task.duration <= MAX_WORKING_DAYS;
    problems.require(
      valid,
      `${path}.duration`,
      `must be a whole number of working days from 0 to ${MAX_WORKING_DAYS}`,
    );
  }
  if (!isSummary && task.finish === undefined && task.duration === undefined) {
    problems.add(path, "needs a finish date or a duration");
  }
  const constraint = task.constraint;
  if (constraint === undefined) return;
  if (!isPlainObject(constraint) || !CONSTRAINT_TYPES.includes(constraint.type)) {
    problems.add(`${path}.constraint.type`, `must be one of ${CONSTRAINT_TYPES.join(", ")}`);
    return;
  }
  if (constraint.type !== "ASAP") {
    problems.require(isISODate(constraint.date), `${path}.constraint.date`, "must be an ISO date");
  }
}

/**
 * @param {any} task
 * @param {string} path
 * @param {{taskIds: Set<string>, calendarIds: Set<string>}} context
 * @param {ProblemList} problems
 */
function validateTaskRelations(task, path, context, problems) {
  if (task.parent !== undefined && task.parent !== null) {
    const known = context.taskIds.has(task.parent) && task.parent !== task.id;
    problems.require(known, `${path}.parent`, `unknown parent "${task.parent}"`);
  }
  if (task.calendar !== undefined) {
    problems.require(
      context.calendarIds.has(task.calendar),
      `${path}.calendar`,
      `unknown calendar "${task.calendar}"`,
    );
  }
}

/**
 * @param {any} task
 * @param {string} path
 * @param {ProblemList} problems
 */
function validateTaskNumbers(task, path, problems) {
  if (task.progress !== undefined) {
    problems.require(isFraction(task.progress), `${path}.progress`, "must be a number from 0 to 1");
  }
  if (task.value !== undefined) {
    problems.require(
      Number.isSafeInteger(task.value),
      `${path}.value`,
      "must be an integer amount in minor units",
    );
  }
  if (task.valuePercent !== undefined) {
    problems.require(
      isFraction(task.valuePercent),
      `${path}.valuePercent`,
      "must be a number from 0 to 1",
    );
  }
  if (task.locked !== undefined) {
    problems.require(typeof task.locked === "boolean", `${path}.locked`, "must be a boolean");
  }
}

/**
 * @param {any} link
 * @param {string} path
 * @param {Set<string>} taskIds
 * @param {ProblemList} problems
 */
function validateLink(link, path, taskIds, problems) {
  if (!isPlainObject(link)) {
    problems.add(path, "must be an object");
    return;
  }
  checkUnknownKeys(link, LINK_KEYS, path, problems);
  problems.require(taskIds.has(link.from), `${path}.from`, `unknown task "${link.from}"`);
  problems.require(taskIds.has(link.to), `${path}.to`, `unknown task "${link.to}"`);
  problems.require(link.from !== link.to, path, "a task cannot link to itself");
  if (link.type !== undefined) {
    problems.require(
      LINK_TYPES.includes(link.type),
      `${path}.type`,
      `must be one of ${LINK_TYPES.join(", ")}`,
    );
  }
  if (link.lag !== undefined) {
    problems.require(
      Number.isInteger(link.lag) && Math.abs(link.lag) <= MAX_WORKING_DAYS,
      `${path}.lag`,
      `must be a whole number of working days, at most ${MAX_WORKING_DAYS} either way`,
    );
  }
  validateAppearance(link, path, problems);
}

/**
 * `style` (colour overrides as CSS colour strings) and `category` on a task or link.
 * @param {any} item
 * @param {string} path
 * @param {ProblemList} problems
 */
function validateAppearance(item, path, problems) {
  const style = item.style ?? {};
  const valid =
    isPlainObject(style) &&
    [style.color, style.textColor, item.category].every(
      (value) => value === undefined || typeof value === "string",
    );
  problems.require(valid, path, "style must be an object of CSS colour strings; category a string");
}

/**
 * @param {any} data
 * @param {Set<string>} taskIds
 * @param {ProblemList} problems
 */
function validateSecondaryCollections(data, taskIds, problems) {
  for (const name of ["baselines", "delayEvents", "markers", "revisions"]) {
    if (data[name] !== undefined && !Array.isArray(data[name]))
      problems.add(name, "must be an array");
  }
  (Array.isArray(data.baselines) ? data.baselines : []).forEach((baseline, index) => {
    const path = `baselines[${index}]`;
    if (!isPlainObject(baseline?.tasks)) {
      problems.add(`${path}.tasks`, "must be an object keyed by task id");
      return;
    }
    for (const [id, dates] of Object.entries(baseline.tasks)) {
      const valid = isPlainObject(dates) && isISODate(dates.start) && isISODate(dates.finish);
      problems.require(
        valid,
        `${path}.tasks.${pathSegment(id)}`,
        "needs ISO start and finish dates",
      );
    }
  });
  if (Array.isArray(data.baselines)) checkIds(data.baselines, "baselines", problems);
  if (Array.isArray(data.delayEvents)) checkIds(data.delayEvents, "delayEvents", problems);
  if (Array.isArray(data.markers)) checkIds(data.markers, "markers", problems);
  (Array.isArray(data.delayEvents) ? data.delayEvents : []).forEach((event, index) => {
    const path = `delayEvents[${index}]`;
    const validRange = isISODate(event?.from) && isISODate(event?.to) && event.from <= event.to;
    problems.require(validRange, path, "needs from/to ISO dates with from <= to");
    if (event?.kind !== undefined) {
      problems.require(
        DELAY_KINDS.includes(event.kind),
        `${path}.kind`,
        `must be one of ${DELAY_KINDS.join(", ")}`,
      );
    }
    if (event?.taskIds !== undefined && !Array.isArray(event.taskIds)) {
      problems.add(`${path}.taskIds`, "must be an array of task ids");
      return;
    }
    for (const taskId of event?.taskIds ?? []) {
      problems.require(taskIds.has(taskId), `${path}.taskIds`, `unknown task "${taskId}"`);
    }
  });
  (Array.isArray(data.markers) ? data.markers : []).forEach((marker, index) => {
    problems.require(isISODate(marker?.date), `markers[${index}].date`, "must be an ISO date");
  });
}

/**
 * @param {any[]} tasks
 * @param {ProblemList} problems
 */
function checkParentCycles(tasks, problems) {
  const parentOf = new Map(tasks.map((task) => [task?.id, task?.parent ?? null]));
  for (const [index, task] of tasks.entries()) {
    if (task?.parent === task?.id) continue;
    const visited = new Set();
    let current = task?.parent ?? null;
    while (current !== null && current !== undefined && !visited.has(current)) {
      visited.add(current);
      current = parentOf.get(current) ?? null;
    }
    if (current !== null && current !== undefined) {
      problems.add(`tasks[${index}].parent`, "parent chain forms a cycle");
    }
  }
}

/**
 * Validates programme data against the v1 format and returns every problem.
 *
 * @param {unknown} data
 * @param {{fieldValidator?: (task: object, path: string, problems: ProblemList) => void}} [options]
 * @returns {ValidationProblem[]}
 */
export function collectProblems(data, options = {}) {
  const problems = new ProblemList();
  if (!isPlainObject(data)) {
    problems.add("$", "programme data must be an object");
    return problems.items;
  }
  const programme = /** @type {any} */ (data);
  checkForbiddenKeys(programme, "$", problems);
  checkUnknownKeys(programme, PROGRAMME_KEYS, "$", problems);
  if (programme.schema !== undefined) {
    problems.require(programme.schema === SCHEMA_ID, "schema", `must be "${SCHEMA_ID}"`);
  }
  for (const key of ["dataDate", "contractCompletion"]) {
    problems.require(isOptionalISODate(programme[key]), key, "must be an ISO date");
  }
  if (!Array.isArray(programme.tasks)) {
    problems.add("tasks", "must be an array");
    return problems.items;
  }
  const calendars = Array.isArray(programme.calendars) ? programme.calendars : [];
  if (programme.calendars !== undefined && !Array.isArray(programme.calendars)) {
    problems.add("calendars", "must be an array");
  }
  const calendarIds = checkIds(calendars, "calendars", problems);
  calendars.forEach((calendar, index) =>
    validateCalendar(calendar, `calendars[${index}]`, problems),
  );
  if (programme.defaultCalendar !== undefined) {
    problems.require(
      calendarIds.has(programme.defaultCalendar),
      "defaultCalendar",
      `unknown calendar "${programme.defaultCalendar}"`,
    );
  }
  const taskIds = checkIds(programme.tasks, "tasks", problems);
  const context = { taskIds, calendarIds, fieldValidator: options.fieldValidator };
  programme.tasks.forEach((task, index) =>
    validateTask(task, `tasks[${index}]`, context, problems),
  );
  checkParentCycles(programme.tasks, problems);
  const links = programme.links ?? [];
  if (!Array.isArray(links)) {
    problems.add("links", "must be an array");
    return problems.items;
  }
  checkIds(links, "links", problems);
  links.forEach((link, index) => validateLink(link, `links[${index}]`, taskIds, problems));
  validateSecondaryCollections(programme, taskIds, problems);
  if (problems.items.length === 0) {
    const cycle = findCycle(programme.tasks, links);
    if (cycle) problems.add("links", `dependency cycle: ${cycle.join(" -> ")}`);
  }
  return problems.items;
}

/**
 * Throws a {@link GanttValidationError} listing every problem, or returns the data.
 * @template T
 * @param {T} data
 * @param {Parameters<typeof collectProblems>[1]} [options]
 * @returns {T}
 */
export function validateProgramme(data, options) {
  const problems = collectProblems(data, options);
  if (problems.length) throw new GanttValidationError(problems);
  return data;
}
