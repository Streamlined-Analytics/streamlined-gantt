// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Calendar } from "../engine/calendar.js";
import { toISO } from "../engine/dates.js";
import { buildHierarchy } from "../engine/graph.js";
import { isMilestone, resolveLeafDates } from "../engine/model.js";
import { calendarElements } from "./mspdi-calendar.js";
import { readProgramme, FIELD_ALIASES, FIELD_IDS, RESIDUE_PREFIX } from "./mspdi-read.js";
import { diffValue } from "./residue.js";
import { XmlWriter } from "./xml.js";

export { MspdiParseError } from "./xml.js";

/**
 * MS Project XML (MSPDI) import and export, `streamlined-gantt/io/mspdi`.
 *
 * **Native fields** (what MS Project, Asta Powerproject, Primavera P6 and
 * MPXJ read): name, WBS, outline (parent), start, finish, duration, milestone
 * and summary flags, % complete, actual start and finish, ASAP/SNET/FNLT
 * constraints, notes, task calendar, `value` as fixed cost, FS/SS/FF/SF links
 * with lag, base calendars (work week and exceptions, recurring ones expanded
 * on import), status date and baselines 0-10. The task id, trade and crew go
 * in the Text1-Text3 extended attributes.
 *
 * **Lossless round trip.** Export writes the native fields, imports them
 * again, and stores the difference from the original as a *residue*: a
 * minimal patch (see `io/residue`) in the Text4 attribute of each task and in
 * the notes of the project summary task (UID 0). Import applies it, so
 * `fromMSPDI(toMSPDI(p)).programme` is deep-equal to `p`, including task
 * types, custom fields, styles, link ids, delay events, markers, revisions
 * and calendar exception kinds. MS Project limits Text fields to 255
 * characters, so a longer task residue moves to the project notes. A field
 * edited in another tool keeps that edit unless the residue overrides the
 * same field; files from other tools have no residue and import natively.
 *
 * **Not imported:** resources, assignments, costs other than fixed cost,
 * time of day, split tasks, leveling, and MSO/MFO/SNLT/FNET/ALAP constraints
 * (each reported in `warnings`).
 *
 * @module streamlined-gantt/io/mspdi
 */

/** @typedef {import("../engine/types.js").Programme} Programme */
/** @typedef {import("../engine/types.js").Task} Task */
/** @typedef {import("../engine/types.js").Link} Link */
/** @typedef {import("./xml.js").XmlChildren} XmlChildren */
/** @typedef {import("./mspdi-read.js").MspdiImport} MspdiImport */

/**
 * @typedef {object} MspdiOptions
 * @property {number} [minutesPerDay] working minutes per day, default 480
 * @property {string} [startTime] start of the working day, default "08:00:00"
 * @property {string} [finishTime] end of the working day, default "17:00:00"
 */

/**
 * @typedef {object} Residue
 * @property {Map<string, string>} tasks JSON residue per task id, for Text4
 * @property {string|null} project JSON residue for the project notes
 */

const MAX_TEXT_FIELD = 255;
const LINK_CODES = { FF: 0, FS: 1, SF: 2, SS: 3 };
const CONSTRAINT_CODES = { ASAP: 0, SNET: 4, FNLT: 7 };
const DEFAULT_OPTIONS = { minutesPerDay: 480, startTime: "08:00:00", finishTime: "17:00:00" };

/**
 * Exports a programme as an MSPDI XML string. The programme must be valid
 * programme data, such as `gantt.toJSON()` returns; this module does not
 * bundle the validator, to stay small.
 * @param {Programme} programme
 * @param {MspdiOptions} [options]
 * @returns {string}
 * @throws {TypeError} when `programme.tasks` is not an array
 */
export function toMSPDI(programme, options = {}) {
  if (!Array.isArray(programme?.tasks))
    throw new TypeError("toMSPDI needs programme data with a tasks array");
  const plan = new ExportPlan(programme, { ...DEFAULT_OPTIONS, ...options });
  const rebuilt = readProgramme(plan.write(null), false).programme;
  return plan.write(residueFor(programme, rebuilt, plan.uid));
}

/**
 * Imports an MSPDI XML string. The result is not validated here: loading it
 * into a `Gantt` or `ProgrammeController` (or calling `validateProgramme`)
 * validates it and reports problems with JSON Pointer paths.
 * @param {string} xml
 * @returns {MspdiImport}
 * @throws {import("./xml.js").MspdiParseError} for malformed or unsafe XML
 * @throws {TypeError} when the document is not an MSPDI project
 */
export function fromMSPDI(xml) {
  return readProgramme(xml, true);
}

/** Everything export needs, computed once and written twice. */
class ExportPlan {
  /**
   * @param {Programme} programme
   * @param {Required<MspdiOptions>} options
   */
  constructor(programme, options) {
    this.programme = programme;
    this.options = options;
    this.calendars = programme.calendars?.length
      ? programme.calendars
      : [{ id: "standard", name: "Standard" }];
    this.calendarUid = new Map(this.calendars.map((calendar, index) => [calendar.id, index + 1]));
    const requested = programme.defaultCalendar ?? this.calendars[0].id;
    this.defaultCalendarId = this.calendarUid.has(requested) ? requested : this.calendars[0].id;
    this.engineCalendars = new Map(
      this.calendars.map((calendar) => [calendar.id, new Calendar(calendar)]),
    );
    this.hierarchy = buildHierarchy(programme.tasks);
    this.byId = new Map(programme.tasks.map((task) => [task.id, task]));
    this.order = treeOrder(this.hierarchy);
    this.uid = new Map(this.order.map(({ id }, index) => [id, index + 1]));
    this.dates = this.resolveDates();
    this.linksInto = groupByTarget(programme.links ?? []);
  }

  /** @returns {Calendar} */
  get projectCalendar() {
    return /** @type {Calendar} */ (this.engineCalendars.get(this.defaultCalendarId));
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  isSummary(id) {
    const hasChildren = (this.hierarchy.childrenOf.get(id)?.length ?? 0) > 0;
    return hasChildren || this.byId.get(id)?.type === "summary";
  }

  /**
   * @param {Task} task
   * @returns {Calendar}
   */
  calendarFor(task) {
    const own = task.calendar ? this.engineCalendars.get(task.calendar) : undefined;
    return own ?? this.projectCalendar;
  }

  /**
   * Leaf dates from stored values; summaries roll up from their children.
   * @returns {Map<string, {start: number, finish: number, duration: number}>}
   */
  resolveDates() {
    const dates = new Map();
    for (let position = this.order.length - 1; position >= 0; position -= 1) {
      const { id } = this.order[position];
      const task = /** @type {Task} */ (this.byId.get(id));
      if (!this.isSummary(id)) {
        if (task.start) dates.set(id, resolveLeafDates(task, this.calendarFor(task)));
        continue;
      }
      const spans = (this.hierarchy.childrenOf.get(id) ?? [])
        .map((kid) => dates.get(kid))
        .filter(Boolean);
      if (spans.length) dates.set(id, this.spanOf(spans));
    }
    return dates;
  }

  /**
   * @param {{start: number, finish: number}[]} spans
   * @returns {{start: number, finish: number, duration: number}}
   */
  spanOf(spans) {
    const start = Math.min(...spans.map((span) => span.start));
    const finish = Math.max(...spans.map((span) => span.finish));
    return { start, finish, duration: this.projectCalendar.workingDaysBetween(start, finish) };
  }

  /**
   * @param {number} day
   * @param {"start"|"finish"} edge
   * @returns {string}
   */
  dateTime(day, edge) {
    return `${toISO(day)}T${edge === "start" ? this.options.startTime : this.options.finishTime}`;
  }

  /**
   * @param {Residue|null} residue
   * @returns {string}
   */
  write(residue) {
    const { programme, options } = this;
    const span = this.dates.size ? this.spanOf([...this.dates.values()]) : null;
    const writer = new XmlWriter();
    const calendars = this.calendars.map((calendar, index) => [
      "Calendar",
      calendarElements(calendar, index + 1, options),
    ]);
    const tasks = this.order.map(({ id, level }) => ["Task", this.taskElement(id, level, residue)]);
    writer.write(
      "Project",
      [
        ["SaveVersion", 14],
        ["Name", `${programme.name ?? "Programme"}.xml`],
        ["Title", programme.name],
        ["ScheduleFromStart", 1],
        ["StartDate", span ? this.dateTime(span.start, "start") : undefined],
        ["FinishDate", span ? this.dateTime(span.finish, "finish") : undefined],
        ["CurrencyCode", programme.currency],
        ["CalendarUID", this.calendarUid.get(this.defaultCalendarId)],
        ["DefaultStartTime", options.startTime],
        ["DefaultFinishTime", options.finishTime],
        ["MinutesPerDay", options.minutesPerDay],
        ["MinutesPerWeek", options.minutesPerDay * 5],
        ["DaysPerMonth", 20],
        ["DurationFormat", 7],
        [
          "StatusDate",
          programme.dataDate ? `${programme.dataDate}T${options.startTime}` : undefined,
        ],
        ["ExtendedAttributes", extendedAttributeDefinitions()],
        ["Calendars", calendars],
        ["Tasks", [["Task", this.projectTask(span, residue?.project ?? null)], ...tasks]],
      ],
      0,
      ' xmlns="http://schemas.microsoft.com/project"',
    );
    return writer.toString();
  }

  /**
   * The project summary task (UID 0), whose notes carry the programme residue.
   * @param {{start: number, finish: number, duration: number}|null} span
   * @param {string|null} residue
   * @returns {XmlChildren}
   */
  projectTask(span, residue) {
    return [
      ["UID", 0],
      ["ID", 0],
      ["Name", this.programme.name ?? "Programme"],
      ["Type", 1],
      ["OutlineNumber", 0],
      ["OutlineLevel", 0],
      ...this.dateElements(span, false),
      ["Milestone", 0],
      ["Summary", 1],
      ["Notes", residue ? `${RESIDUE_PREFIX}${residue}` : undefined],
    ];
  }

  /**
   * @param {{start: number, finish: number, duration: number}|null|undefined} dates
   * @param {boolean} milestone
   * @returns {XmlChildren}
   */
  dateElements(dates, milestone) {
    if (!dates) return [["DurationFormat", 7]];
    const minutes = milestone ? 0 : Math.round(dates.duration * this.options.minutesPerDay);
    return [
      ["Start", this.dateTime(dates.start, "start")],
      ["Finish", this.dateTime(dates.finish, milestone ? "start" : "finish")],
      ["Duration", `PT${Math.floor(minutes / 60)}H${minutes % 60}M0S`],
      ["DurationFormat", 7],
    ];
  }

  /**
   * @param {string} id
   * @param {number} level
   * @param {Residue|null} residue
   * @returns {XmlChildren}
   */
  taskElement(id, level, residue) {
    const task = /** @type {Task} */ (this.byId.get(id));
    const summary = this.isSummary(id);
    const milestone = !summary && isMilestone(task);
    return [
      ["UID", this.uid.get(id)],
      ["ID", this.uid.get(id)],
      ["Name", task.name ?? ""],
      ["Type", 1],
      ["WBS", task.wbs],
      ["OutlineNumber", outlineNumber(id, this.hierarchy)],
      ["OutlineLevel", level],
      ...this.dateElements(this.dates.get(id), milestone),
      ["Milestone", milestone ? 1 : 0],
      ["Summary", summary ? 1 : 0],
      ...(summary ? [] : this.progressElements(task)),
      ["ConstraintType", summary ? undefined : constraintCode(task)],
      ["CalendarUID", this.calendarUid.get(task.calendar ?? "") ?? -1],
      ["ConstraintDate", summary ? undefined : this.constraintDate(task)],
      ["Notes", typeof task.notes === "string" && task.notes ? task.notes : undefined],
      ...(this.linksInto.get(id) ?? []).map((link) => ["PredecessorLink", this.linkElement(link)]),
      ...extendedAttributes(task, residue?.tasks.get(id)),
      ...this.baselineElements(id),
    ];
  }

  /**
   * @param {Task} task
   * @returns {XmlChildren}
   */
  progressElements(task) {
    const { startTime, finishTime } = this.options;
    const hasValue = Number.isSafeInteger(task.value) && task.value !== 0;
    return [
      ["FixedCost", hasValue ? task.value : undefined],
      ["PercentComplete", Math.round((task.progress ?? 0) * 100)],
      ["ActualStart", task.actualStart ? `${task.actualStart}T${startTime}` : undefined],
      ["ActualFinish", task.actualFinish ? `${task.actualFinish}T${finishTime}` : undefined],
    ];
  }

  /**
   * @param {Task} task
   * @returns {string|undefined}
   */
  constraintDate(task) {
    const constraint = task.constraint;
    if (!constraint?.date || !constraintCode(task)) return undefined;
    const time = constraint.type === "FNLT" ? this.options.finishTime : this.options.startTime;
    return `${constraint.date}T${time}`;
  }

  /**
   * @param {Link} link
   * @returns {XmlChildren}
   */
  linkElement(link) {
    return [
      ["PredecessorUID", this.uid.get(link.from)],
      ["Type", LINK_CODES[link.type ?? "FS"]],
      ["LinkLag", Math.round((link.lag ?? 0) * this.options.minutesPerDay * 10)],
      ["LagFormat", 7],
    ];
  }

  /**
   * @param {string} id
   * @returns {XmlChildren}
   */
  baselineElements(id) {
    const { startTime, finishTime } = this.options;
    return (this.programme.baselines ?? []).slice(0, 11).flatMap((baseline, number) => {
      const entry = baseline.tasks?.[id];
      if (!entry) return [];
      const fields = [
        ["Number", number],
        ["Start", `${entry.start}T${startTime}`],
        ["Finish", `${entry.finish}T${finishTime}`],
      ];
      return [["Baseline", fields]];
    });
  }
}

/**
 * @param {Task} task
 * @returns {number} MSPDI `ConstraintType`; 0 (ASAP) for none
 */
function constraintCode(task) {
  return CONSTRAINT_CODES[task.constraint?.type ?? "ASAP"] ?? 0;
}

/**
 * Tasks in depth-first tree order with their outline level.
 * @param {import("../engine/graph.js").Hierarchy} hierarchy
 * @returns {{id: string, level: number}[]}
 */
function treeOrder(hierarchy) {
  const order = [];
  const roots = hierarchy.childrenOf.get(null) ?? [];
  const stack = [...roots].reverse().map((id) => ({ id, level: 1 }));
  while (stack.length) {
    const entry = /** @type {{id: string, level: number}} */ (stack.pop());
    order.push(entry);
    const kids = hierarchy.childrenOf.get(entry.id) ?? [];
    for (let index = kids.length - 1; index >= 0; index -= 1) {
      stack.push({ id: kids[index], level: entry.level + 1 });
    }
  }
  return order;
}

/**
 * @param {string} id
 * @param {import("../engine/graph.js").Hierarchy} hierarchy
 * @returns {string}
 */
function outlineNumber(id, hierarchy) {
  const parts = [];
  /** @type {string|null} */
  let current = id;
  while (current !== null) {
    const parent = hierarchy.parentOf.get(current) ?? null;
    parts.unshift((hierarchy.childrenOf.get(parent) ?? []).indexOf(current) + 1);
    current = parent;
  }
  return parts.join(".");
}

/** @returns {XmlChildren} */
function extendedAttributeDefinitions() {
  return Object.entries(FIELD_IDS).map(([key, fieldId], index) => [
    "ExtendedAttribute",
    [
      ["FieldID", fieldId],
      ["FieldName", `Text${index + 1}`],
      ["Alias", FIELD_ALIASES[key]],
    ],
  ]);
}

/**
 * @param {unknown} value
 * @returns {string|undefined}
 */
const nonEmptyText = (value) => (typeof value === "string" && value ? value : undefined);

/**
 * @param {Task} task
 * @param {string|undefined} residue
 * @returns {XmlChildren}
 */
function extendedAttributes(task, residue) {
  const values = {
    id: task.id,
    trade: nonEmptyText(task.trade),
    crew: nonEmptyText(task.crew),
    residue,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [
      "ExtendedAttribute",
      [
        ["FieldID", FIELD_IDS[key]],
        ["Value", value],
      ],
    ]);
}

/**
 * The patches that turn a native-only import back into the original. Tasks
 * are paired by their position in the file, not by id: the native id can
 * differ (text XML cannot carry is dropped, see ADR-0012), and overflowing
 * residues are keyed by the id import rebuilds before patching.
 * @param {Programme} original
 * @param {Programme} rebuilt
 * @param {Map<string, number>} uid each original task's UID, its 1-based position in the file
 * @returns {Residue}
 */
function residueFor(original, rebuilt, uid) {
  const originalLinks = groupByTarget(original.links ?? []);
  const rebuiltLinks = groupByTarget(rebuilt.links ?? []);
  /** @type {Map<string, string>} */
  const tasks = new Map();
  /** @type {Record<string, object>} */
  const overflow = {};
  for (const task of original.tasks) {
    const native = rebuilt.tasks[/** @type {number} */ (uid.get(task.id)) - 1];
    const patch = taskResidue(
      task,
      native,
      originalLinks.get(task.id) ?? [],
      rebuiltLinks.get(native.id) ?? [],
    );
    if (!patch) continue;
    const json = residueJson(patch);
    if (json.length <= MAX_TEXT_FIELD) tasks.set(task.id, json);
    else overflow[native.id] = patch;
  }
  const project = projectResidue(original, rebuilt, overflow);
  return { tasks, project: project ? residueJson(project) : null };
}

/**
 * JSON with U+FFFE and U+FFFF written as `\u` escapes. `JSON.stringify`
 * already escapes control characters and lone surrogates, so the result holds
 * only characters XML 1.0 can carry, and the residue restores text the native
 * fields had to drop (ADR-0012).
 * @param {object} value
 * @returns {string}
 */
function residueJson(value) {
  return JSON.stringify(value)
    .replace(/\uffff/g, "\\uffff")
    .replace(/\ufffe/g, "\\ufffe");
}

/**
 * @param {Task} task
 * @param {Task} rebuilt
 * @param {Link[]} links
 * @param {Link[]} rebuiltLinks
 * @returns {object|undefined}
 */
function taskResidue(task, rebuilt, links, rebuiltLinks) {
  const patch = diffValue(task, rebuilt) ?? {};
  const linkPatches = links.map(
    (link, position) => diffValue(link, rebuiltLinks[position] ?? {}) ?? 0,
  );
  const result = linkPatches.some(Boolean) ? { ...patch, l: linkPatches } : patch;
  return Object.keys(result).length ? result : undefined;
}

/**
 * Programme-level patch, plus the original task and link order (`t`, `k`),
 * an absent `links` key (`n`), and task residues too long for Text4 (`x`).
 * @param {Programme} original
 * @param {Programme} rebuilt
 * @param {Record<string, object>} overflow
 * @returns {object|undefined}
 */
function projectResidue(original, rebuilt, overflow) {
  /** @type {Record<string, unknown>} */
  const result = { ...diffValue(projectPart(original), projectPart(rebuilt)) };
  const taskOrder = original.tasks.map((task) => task.id);
  if (!sameOrder(taskOrder, rebuilt.tasks)) result.t = taskOrder;
  if (original.links === undefined) result.n = 1;
  const linkOrder = (original.links ?? []).map((link) => link.id);
  const linksInto = groupByTarget(original.links ?? []);
  const importedOrder = rebuilt.tasks.flatMap((task) => linksInto.get(task.id) ?? []);
  if (!sameOrder(linkOrder, importedOrder)) result.k = linkOrder;
  if (Object.keys(overflow).length) result.x = overflow;
  return Object.keys(result).length ? result : undefined;
}

/**
 * @param {string[]} ids
 * @param {{id: string}[]} items
 * @returns {boolean}
 */
function sameOrder(ids, items) {
  return ids.length === items.length && ids.every((id, index) => items[index].id === id);
}

/**
 * @param {Programme} programme
 * @returns {Record<string, unknown>}
 */
function projectPart(programme) {
  const { tasks: _tasks, links: _links, ...rest } = programme;
  return rest;
}

/**
 * @param {Link[]} links
 * @returns {Map<string, Link[]>}
 */
function groupByTarget(links) {
  /** @type {Map<string, Link[]>} */
  const groups = new Map();
  for (const link of links) groups.set(link.to, [...(groups.get(link.to) ?? []), link]);
  return groups;
}
