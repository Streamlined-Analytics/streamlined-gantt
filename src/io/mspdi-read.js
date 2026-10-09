// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Calendar } from "../engine/calendar.js";
import { toDay, toISO } from "../engine/dates.js";
import { readCalendars } from "./mspdi-calendar.js";
import { applyPatch } from "./residue.js";
import { child, children, parseXml, textOf } from "./xml.js";

/**
 * Reads MSPDI into programme data: the native fields first, then (for files
 * this library wrote) the residue patches that restore everything else.
 * Export also uses the native-only read to work out what the residue must be.
 *
 * @module io/mspdi-read
 */

/** @typedef {import("../engine/types.js").Programme} Programme */
/** @typedef {import("../engine/types.js").Task} Task */
/** @typedef {import("../engine/types.js").Link} Link */
/** @typedef {import("./xml.js").XmlElement} XmlElement */

/**
 * @typedef {object} MspdiImport
 * @property {Programme} programme
 * @property {string[]} warnings what could not be represented
 */

/** The Text1-Text4 extended attribute field ids export uses. */
export const FIELD_IDS = {
  id: "188743731",
  trade: "188743734",
  crew: "188743737",
  residue: "188743740",
};

/** Field aliases export writes; import finds fields by alias, in any slot. */
export const FIELD_ALIASES = {
  id: "streamlined-gantt id",
  trade: "Trade",
  crew: "Crew",
  residue: "streamlined-gantt data",
};
export const RESIDUE_PREFIX = "streamlined-gantt:";

const LINK_TYPES = ["FF", "FS", "SF", "SS"];
const CONSTRAINT_TYPES = { 0: "ASAP", 4: "SNET", 7: "FNLT" };
const UNSUPPORTED_CONSTRAINTS = { 1: "ALAP", 2: "MSO", 3: "MFO", 5: "SNLT", 6: "FNET" };
const ELAPSED_FORMATS = new Set([4, 6, 8, 10, 12, 36, 38, 40, 42, 44]);
const PERCENT_FORMATS = new Set([19, 20]);
const TENTHS_OF_MINUTE_PER_ELAPSED_DAY = 14400;

/**
 * @typedef {object} ReadContext
 * @property {number} minutesPerDay
 * @property {string} dayStart the project's DefaultStartTime
 * @property {Calendar} calendar the project calendar
 * @property {Map<string, Calendar>} engineCalendars calendar UID to a working-day calendar
 * @property {Partial<Record<keyof typeof FIELD_IDS, string>>} fields FieldID per role, by alias
 * @property {string[]} warnings
 */

/**
 * @typedef {object} TaskEntry
 * @property {Task} task
 * @property {Link[]} links incoming links in file order
 * @property {XmlElement} element
 */

/**
 * @param {string} xml
 * @param {boolean} useResidue false reads the native fields only
 * @returns {MspdiImport}
 */
export function readProgramme(xml, useResidue) {
  const root = parseXml(xml);
  if (root.name !== "Project") {
    throw new TypeError(`Not an MSPDI file: the root element is <${root.name}>`);
  }
  /** @type {string[]} */
  const warnings = [];
  const calendars = readCalendars(root, warnings);
  const engineCalendars = new Map(
    calendars.map(({ uid, definition }) => [String(uid), new Calendar(definition)]),
  );
  const defaultUid = textOf(root, "CalendarUID") ?? "";
  const defaultEngine = engineCalendars.get(defaultUid) ?? engineCalendars.values().next().value;
  const defaultCalendar = defaultEngine?.id;
  /** @type {ReadContext} */
  const context = {
    minutesPerDay: Number(textOf(root, "MinutesPerDay")) || 480,
    dayStart: textOf(root, "DefaultStartTime") ?? "08:00:00",
    calendar: defaultEngine ?? new Calendar({ id: "standard" }),
    engineCalendars,
    fields: fieldsByAlias(root),
    warnings,
  };
  const { projectTask, entries } = readTasks(root, context);
  /** @type {Record<string, unknown>} */
  const project = { schema: "streamlined-gantt/1", ...projectFields(root, projectTask) };
  if (defaultCalendar) project.defaultCalendar = defaultCalendar;
  project.calendars = calendars.map(({ definition }) => definition);
  const baselines = readBaselines(entries, context);
  if (baselines.length) project.baselines = baselines;
  const programme = useResidue
    ? applyResidues(project, entries, projectTask, context)
    : assemble(project, entries);
  return { programme, warnings };
}

/**
 * Which extended attribute holds each role, found by its alias (case
 * insensitive), so a foreign file's unrelated Text1 is never taken for an id.
 * @param {XmlElement} root
 * @returns {Partial<Record<keyof typeof FIELD_IDS, string>>}
 */
function fieldsByAlias(root) {
  /** @type {Partial<Record<keyof typeof FIELD_IDS, string>>} */
  const fields = {};
  const roles = Object.entries(FIELD_ALIASES).map(([role, alias]) => [role, alias.toLowerCase()]);
  for (const definition of children(child(root, "ExtendedAttributes"), "ExtendedAttribute")) {
    const alias = (textOf(definition, "Alias") ?? "").toLowerCase();
    const role = roles.find(([, wanted]) => wanted === alias)?.[0];
    const fieldId = textOf(definition, "FieldID");
    if (role && fieldId) fields[/** @type {keyof typeof FIELD_IDS} */ (role)] ??= fieldId;
  }
  return fields;
}

/**
 * @param {XmlElement} root
 * @param {XmlElement|undefined} projectTask
 * @returns {Record<string, string>}
 */
function projectFields(root, projectTask) {
  /** @type {Record<string, string>} */
  const fields = {};
  const name = textOf(root, "Title") || (projectTask ? textOf(projectTask, "Name") : undefined);
  if (name) fields.name = name;
  const currency = textOf(root, "CurrencyCode");
  if (currency) fields.currency = currency;
  const statusDate = textOf(root, "StatusDate");
  if (statusDate && /^\d{4}-\d{2}-\d{2}/.test(statusDate))
    fields.dataDate = statusDate.slice(0, 10);
  return fields;
}

/**
 * @param {XmlElement} element
 * @returns {boolean}
 */
function isProjectSummaryTask(element) {
  return textOf(element, "UID") === "0" || textOf(element, "OutlineLevel") === "0";
}

/**
 * @param {XmlElement} root
 * @param {ReadContext} context
 * @returns {{projectTask: XmlElement|undefined, entries: TaskEntry[]}}
 */
function readTasks(root, context) {
  const elements = children(child(root, "Tasks"), "Task").filter(
    (element) => textOf(element, "IsNull") !== "1",
  );
  const projectTask = elements.find(isProjectSummaryTask);
  /** @type {Map<string, string>} */
  const uidToId = new Map();
  /** @type {(string|null)[]} */
  const parents = [];
  /** @type {TaskEntry[]} */
  const entries = [];
  for (const element of elements) {
    if (element === projectTask) continue;
    entries.push({ task: readTask(element, uidToId, parents, context), links: [], element });
  }
  for (const entry of entries) entry.links = readLinks(entry, uidToId, context);
  return { projectTask, entries };
}

/**
 * @param {XmlElement} element
 * @param {string|undefined} fieldId
 * @returns {string|undefined}
 */
function extendedValue(element, fieldId) {
  if (!fieldId) return undefined;
  const match = children(element, "ExtendedAttribute").find(
    (attribute) => textOf(attribute, "FieldID") === fieldId,
  );
  return match ? (child(match, "Value")?.text ?? "") : undefined;
}

/**
 * The stored streamlined-gantt id, unless it is missing or already taken.
 * @param {XmlElement} element
 * @param {Map<string, string>} uidToId
 * @param {string|undefined} fieldId
 * @returns {string}
 */
function taskIdOf(element, uidToId, fieldId) {
  const uid = textOf(element, "UID") ?? `n${uidToId.size + 1}`;
  const stored = extendedValue(element, fieldId);
  const taken = new Set(uidToId.values());
  const id = stored && !taken.has(stored) ? stored : `t${uid}`;
  uidToId.set(uid, id);
  return id;
}

/**
 * @param {XmlElement} element
 * @param {Map<string, string>} uidToId
 * @param {(string|null)[]} parents task ids by outline level
 * @param {ReadContext} context
 * @returns {Task}
 */
function readTask(element, uidToId, parents, context) {
  const id = taskIdOf(element, uidToId, context.fields.id);
  const level = Math.max(1, Number(textOf(element, "OutlineLevel") ?? 1) || 1);
  const parent = parents[level - 2] ?? null;
  parents.length = level - 1;
  parents[level - 1] = id;
  /** @type {Task} */
  const task = { id, name: textOf(element, "Name") ?? "" };
  if (parent) task.parent = parent;
  if (textOf(element, "WBS")) task.wbs = textOf(element, "WBS");
  if (textOf(element, "Summary") === "1") task.type = "summary";
  else readLeafFields(task, element, withTaskCalendar(element, context));
  const calendar = context.engineCalendars.get(textOf(element, "CalendarUID") ?? "");
  if (calendar) task.calendar = calendar.id;
  readTextFields(task, element, context);
  return task;
}

/**
 * The reading context for one task: dates are normalised on the task's own
 * calendar (`CalendarUID`) when it has one, else on the project calendar.
 * @param {XmlElement} element
 * @param {ReadContext} context
 * @returns {ReadContext}
 */
function withTaskCalendar(element, context) {
  const own = context.engineCalendars.get(textOf(element, "CalendarUID") ?? "");
  return own ? { ...context, calendar: own } : context;
}

/**
 * @param {Task} task
 * @param {XmlElement} element
 * @param {ReadContext} context
 */
function readTextFields(task, element, context) {
  const trade = extendedValue(element, context.fields.trade);
  if (trade) task.trade = trade;
  const crew = extendedValue(element, context.fields.crew);
  if (crew) task.crew = crew;
  const notes = child(element, "Notes")?.text;
  if (notes) task.notes = notes;
}

/**
 * Dates, progress, constraint and cost for a leaf task. Duration is stored;
 * finish only for in-progress tasks, where it is the forecast.
 * @param {Task} task
 * @param {XmlElement} element
 * @param {ReadContext} context
 */
function readLeafFields(task, element, context) {
  const milestone = textOf(element, "Milestone") === "1";
  if (milestone) task.type = "milestone";
  const percent = Number(textOf(element, "PercentComplete") ?? 0) || 0;
  const startText = textOf(element, "Start");
  if (startText) readLeafDates(task, element, { milestone, percent }, context);
  if (percent) task.progress = percent / 100;
  const actualStart = textOf(element, "ActualStart");
  if (actualStart) task.actualStart = actualStart.slice(0, 10);
  const actualFinish = textOf(element, "ActualFinish");
  if (actualFinish) task.actualFinish = toISO(finishDay(actualFinish, context));
  const constraint = readConstraint(element, task.name, context.warnings);
  if (constraint) task.constraint = constraint;
  const fixedCost = Math.round(Number(textOf(element, "FixedCost") ?? 0));
  if (Number.isSafeInteger(fixedCost) && fixedCost !== 0) task.value = fixedCost;
}

/**
 * @param {Task} task
 * @param {XmlElement} element
 * @param {{milestone: boolean, percent: number}} state
 * @param {ReadContext} context
 */
function readLeafDates(task, element, state, context) {
  const start = String(textOf(element, "Start")).slice(0, 10);
  task.start = start;
  if (state.milestone) {
    task.duration = 0;
    return;
  }
  const finishText = textOf(element, "Finish");
  const finish = finishText ? Math.max(finishDay(finishText, context), toDay(start)) : null;
  task.duration = durationOf(element, toDay(start), finish, context);
  const inProgress = state.percent > 0 && state.percent < 100;
  if (inProgress && finish !== null) task.finish = toISO(finish);
}

/**
 * The inclusive last working day of an MSPDI finish. A finish at or before
 * the start of the working day (midnight, or 08:00 as some tools write it)
 * belongs to the previous working day.
 * @param {string} value
 * @param {ReadContext} context
 * @returns {number}
 */
function finishDay(value, context) {
  const day = toDay(value.slice(0, 10));
  const time = value.slice(11, 19) || "23:59:00";
  if (time > context.dayStart) return day;
  return context.calendar.previousWorkingDay(day - 1);
}

/**
 * Working days from `Duration`, or from the dates when it is elapsed time.
 * @param {XmlElement} element
 * @param {number} start
 * @param {number|null} finish
 * @param {ReadContext} context
 * @returns {number}
 */
function durationOf(element, start, finish, context) {
  const format = Number(textOf(element, "DurationFormat") ?? 7);
  const text = textOf(element, "Duration");
  const minutes = text ? durationMinutes(text) : null;
  if (minutes !== null && !ELAPSED_FORMATS.has(format)) {
    return Math.max(1, Math.round(minutes / context.minutesPerDay));
  }
  if (finish === null) return 1;
  return Math.max(1, context.calendar.workingDaysBetween(start, finish));
}

const DURATION_PATTERN =
  /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * @param {string} text an ISO-8601 duration such as PT40H0M0S
 * @returns {number|null} minutes
 */
function durationMinutes(text) {
  const match = DURATION_PATTERN.exec(text);
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 1440 + Number(hours) * 60 + Number(minutes) + Number(seconds) / 60;
}

/**
 * @param {XmlElement} element
 * @param {string} name
 * @param {string[]} warnings
 * @returns {import("../engine/types.js").Constraint|undefined}
 */
function readConstraint(element, name, warnings) {
  const code = Number(textOf(element, "ConstraintType") ?? 0);
  const type = CONSTRAINT_TYPES[code];
  if (!type) {
    const label = UNSUPPORTED_CONSTRAINTS[code] ?? `type ${code}`;
    warnings.push(`"${name}": ${label} constraint dropped (unsupported)`);
    return undefined;
  }
  const date = textOf(element, "ConstraintDate");
  if (type === "ASAP" || !date) return undefined;
  return { type, date: date.slice(0, 10) };
}

/**
 * @param {TaskEntry} entry
 * @param {Map<string, string>} uidToId
 * @param {ReadContext} context
 * @returns {Link[]}
 */
function readLinks(entry, uidToId, context) {
  /** @type {Link[]} */
  const links = [];
  for (const element of children(entry.element, "PredecessorLink")) {
    const from = uidToId.get(textOf(element, "PredecessorUID") ?? "");
    if (!from) {
      context.warnings.push(`"${entry.task.name}": link from a missing task dropped`);
      continue;
    }
    const base = `${from}-${entry.task.id}`;
    const taken = links.some((link) => link.id === base);
    /** @type {Link} */
    const link = { id: taken ? `${base}-${links.length + 1}` : base, from, to: entry.task.id };
    const type = LINK_TYPES[Number(textOf(element, "Type") ?? 1)] ?? "FS";
    if (type !== "FS") link.type = /** @type {import("../engine/types.js").LinkType} */ (type);
    const lag = linkLagDays(element, entry.task.name, context);
    if (lag !== 0) link.lag = lag;
    links.push(link);
  }
  return links;
}

/**
 * `LinkLag` is in tenths of a minute. Elapsed lags are converted at five
 * working days per seven calendar days; percentage lags are dropped.
 * @param {XmlElement} element
 * @param {string} name
 * @param {ReadContext} context
 * @returns {number}
 */
function linkLagDays(element, name, context) {
  const tenths = Number(textOf(element, "LinkLag") ?? 0) || 0;
  const format = Number(textOf(element, "LagFormat") ?? 7);
  if (tenths === 0) return 0;
  if (PERCENT_FORMATS.has(format)) {
    context.warnings.push(`"${name}": percentage lag dropped`);
    return 0;
  }
  if (ELAPSED_FORMATS.has(format)) {
    context.warnings.push(`"${name}": elapsed lag converted to working days`);
    return Math.round(((tenths / TENTHS_OF_MINUTE_PER_ELAPSED_DAY) * 5) / 7);
  }
  return Math.round(tenths / (context.minutesPerDay * 10));
}

/**
 * @param {TaskEntry[]} entries
 * @param {ReadContext} context
 * @returns {import("../engine/types.js").Baseline[]}
 */
function readBaselines(entries, context) {
  /** @type {Map<number, import("../engine/types.js").Baseline>} */
  const byNumber = new Map();
  for (const { task, element } of entries) {
    for (const baseline of children(element, "Baseline")) {
      const number = Number(textOf(baseline, "Number") ?? 0);
      const start = textOf(baseline, "Start");
      const finish = textOf(baseline, "Finish");
      if (!start || !finish) continue;
      if (!byNumber.has(number)) byNumber.set(number, { id: `baseline-${number}`, tasks: {} });
      const tasks = /** @type {import("../engine/types.js").Baseline} */ (byNumber.get(number))
        .tasks;
      const finishOn = finishDay(finish, withTaskCalendar(element, context));
      tasks[task.id] = { start: start.slice(0, 10), finish: toISO(finishOn) };
    }
  }
  const numbers = [...byNumber.keys()].sort((first, second) => first - second);
  return numbers.map(
    (number) => /** @type {import("../engine/types.js").Baseline} */ (byNumber.get(number)),
  );
}

/**
 * @param {Record<string, unknown>} project
 * @param {TaskEntry[]} entries
 * @returns {Programme}
 */
function assemble(project, entries) {
  return /** @type {Programme} */ ({
    ...project,
    tasks: entries.map((entry) => entry.task),
    links: entries.flatMap((entry) => entry.links),
  });
}

/**
 * @param {string|undefined} text
 * @param {string[]} warnings
 * @returns {Record<string, any>|null}
 */
function parseResidue(text, warnings) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    warnings.push("Unreadable streamlined-gantt data ignored");
    return null;
  }
}

/**
 * @param {XmlElement|undefined} projectTask
 * @param {string[]} warnings
 * @returns {Record<string, any>|null}
 */
function projectResidue(projectTask, warnings) {
  const notes = projectTask ? child(projectTask, "Notes")?.text : undefined;
  if (!notes?.startsWith(RESIDUE_PREFIX)) return null;
  return parseResidue(notes.slice(RESIDUE_PREFIX.length), warnings);
}

/**
 * @param {TaskEntry} entry
 * @param {Record<string, any>|null} patch
 */
function patchEntry(entry, patch) {
  if (!patch) return;
  entry.task = applyPatch(entry.task, patch);
  const linkPatches = Array.isArray(patch.l) ? patch.l : [];
  entry.links = entry.links.map((link, position) => applyPatch(link, linkPatches[position]));
}

/**
 * @param {Record<string, unknown>} project
 * @param {TaskEntry[]} entries
 * @param {XmlElement|undefined} projectTask
 * @param {ReadContext} context
 * @returns {Programme}
 */
function applyResidues(project, entries, projectTask, context) {
  const { warnings } = context;
  const projectPatch = projectResidue(projectTask, warnings);
  const overflow = projectPatch?.x && typeof projectPatch.x === "object" ? projectPatch.x : {};
  for (const entry of entries) {
    const own = parseResidue(extendedValue(entry.element, context.fields.residue), warnings);
    patchEntry(
      entry,
      own ?? (Object.hasOwn(overflow, entry.task.id) ? overflow[entry.task.id] : null),
    );
  }
  const programme = /** @type {any} */ ({
    ...applyPatch(project, projectPatch),
    ...assemble({}, entries),
  });
  programme.tasks = reorder(programme.tasks, projectPatch?.t);
  programme.links = reorder(programme.links, projectPatch?.k);
  if (projectPatch?.n === 1 && programme.links.length === 0) delete programme.links;
  return programme;
}

/**
 * Restores a stored id order; items not listed keep their order at the end.
 * @template {{id: string}} T
 * @param {T[]} items
 * @param {unknown} ids
 * @returns {T[]}
 */
function reorder(items, ids) {
  if (!Array.isArray(ids)) return items;
  const rank = new Map(ids.map((id, index) => [id, index]));
  const rankOf = (item) => rank.get(item.id) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((first, second) => rankOf(first) - rankOf(second));
}
