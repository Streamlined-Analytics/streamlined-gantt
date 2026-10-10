// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { analyse } from "../engine/analysis.js";
import { FieldRegistry } from "../engine/fields.js";
import { formatMoney } from "../engine/format.js";
import { wouldCreateCycle } from "../engine/graph.js";
import { isLocked, isMilestone, normaliseDatePatch, schedulingCalendar } from "../engine/model.js";
import { collectProblems, GanttValidationError } from "../engine/schema.js";
import { schedule as runSchedule } from "../engine/scheduler.js";
import { projectSummary } from "../engine/summary.js";
import { toISO, today } from "../engine/dates.js";
import { Emitter } from "./emitter.js";
import { History } from "./history.js";
import { loadProgramme } from "./programme.js";
import {
  ENTITY_COLLECTIONS,
  ProgrammeStore,
  changedFields,
  compactRecords,
  deepEqual,
  diffProgrammes,
} from "./store.js";

/**
 * The DOM-free programme controller: data, CRUD, transactions with
 * before/after events and asynchronous approval, scheduling cascades,
 * undo/redo, dirty tracking and summaries. The `Gantt` UI class extends it.
 *
 * Every mutation runs as a *transaction*:
 * 1. the change is applied tentatively and, when auto-scheduling is on, the
 *    scheduler cascades it to successors;
 * 2. one cancelable `before-*` event fires per requested operation, carrying
 *    the change and the cascade;
 * 3. if any handler vetoes, everything is rolled back and `edit-rejected` fires;
 * 4. if handlers called `waitUntil()`, the transaction waits (optimistically
 *    shown, or held in `confirm` mode) for the promises; `false` or a rejection
 *    vetoes, a changeset object replaces the local result, anything else accepts;
 * 5. on commit it enters the undo history and fires the after events
 *    (`task-update`…, `field-change`) and exactly one `change`.
 *
 * Transactions run one at a time; edits requested while one is awaiting
 * approval are queued in order.
 *
 * @module model/controller
 */

/**
 * @typedef {object} ControllerOptions
 * @property {import("../engine/types.js").Programme} [data]
 * @property {import("../engine/fields.js").FieldDefinition[]} [fields]
 * @property {"propagate"|"tight"|"off"} [autoSchedule]
 * @property {"optimistic"|"confirm"} [editMode]
 * @property {number} [approvalTimeout] milliseconds before a pending approval is rejected (default 15000)
 * @property {number} [historyLimit] default 100
 * @property {number} [criticalThreshold] default 0
 * @property {string} [locale] default "en-GB"
 * @property {string} [currency] default from the data, else "GBP"
 * @property {EventTarget|null} [eventTarget] where DOM CustomEvents are mirrored
 * @property {string} [eventPrefix] default "gantt"
 * @property {Record<string, (event: import("./emitter.js").GanttEvent) => void>} [on] handlers registered before the first load
 * @property {() => string} [today] ISO date provider (default: the viewer's local date)
 */

/**
 * @typedef {object} EditResult
 * @property {boolean} committed
 * @property {string} transactionId
 * @property {string} [reason]
 */

/**
 * @typedef {object} Intent
 * @property {string} event before-event name
 * @property {Record<string, unknown>} payload
 */

const DATE_KEYS = ["start", "finish", "duration"];
const SCHEDULING_KEYS = new Set([
  "start",
  "finish",
  "duration",
  "progress",
  "actualStart",
  "actualFinish",
  "constraint",
  "type",
  "parent",
  "locked",
]);
const SCHEDULING_PROJECT_KEYS = new Set([
  "dataDate",
  "contractCompletion",
  "calendars",
  "defaultCalendar",
]);

let transactionCounter = 0;

/** @returns {string} */
function nextTransactionId() {
  transactionCounter += 1;
  return `tx-${Date.now().toString(36)}-${transactionCounter}`;
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random.slice(0, 8)}`;
}

/**
 * @template T
 * @param {T} value
 * @returns {Readonly<T>}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Merges a task patch: `fields` merge key by key (a null value removes the
 * key); any other property set to null or undefined is removed.
 * @param {Record<string, any>} entity
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
export function mergePatch(entity, patch) {
  const merged = { ...entity };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id") continue;
    if (key === "fields" && value && typeof value === "object") {
      merged.fields = mergeFields(entity.fields ?? {}, value);
      continue;
    }
    if (value === null || value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {Record<string, unknown>} patch a null or undefined value removes the key
 * @returns {Record<string, unknown>}
 */
function mergeFields(fields, patch) {
  const merged = { ...fields };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

class Transaction {
  /**
   * @param {string} cause
   * @param {string} label
   * @param {{undoable?: boolean, silent?: boolean, schedule?: boolean, source?: string}} [options]
   */
  constructor(cause, label, options = {}) {
    this.id = nextTransactionId();
    this.cause = cause;
    this.label = label;
    this.undoable = options.undoable ?? true;
    this.silent = options.silent ?? false;
    this.schedule = options.schedule ?? true;
    this.source = options.source ?? "local";
    /** @type {import("./store.js").ChangeRecord[]} */
    this.records = [];
    /** @type {Intent[]} */
    this.intents = [];
    /** @type {Set<string>} */
    this.pinned = new Set();
    /** @type {Set<string>} tasks an operation was about, even if it changed nothing */
    this.subjectTaskIds = new Set();
    /** @type {Set<string>} */
    this.subjectLinkIds = new Set();
    /** @type {{reason: string, message: string, error?: unknown}|null} */
    this.rejection = null;
    /** @type {{id: string, start: string, finish: string, duration: number}[]} */
    this.cascade = [];
  }

  /**
   * @param {string} reason
   * @param {string} message
   * @param {unknown} [error]
   */
  reject(reason, message, error) {
    this.rejection ??= { reason, message, ...(error === undefined ? {} : { error }) };
  }

  get touchedTaskIds() {
    const touched = this.records
      .filter((record) => record.collection === "tasks")
      .map((record) => record.id);
    return [...new Set([...this.subjectTaskIds, ...touched])];
  }

  get touchedLinkIds() {
    const touched = this.records
      .filter((record) => record.collection === "links")
      .map((record) => record.id);
    return [...new Set([...this.subjectLinkIds, ...touched])];
  }
}

export class ProgrammeController {
  /** @param {ControllerOptions} [options] */
  constructor(options = {}) {
    /** @type {Record<string, any>} */
    this.options = {
      autoSchedule: "propagate",
      editMode: "optimistic",
      approvalTimeout: 15_000,
      historyLimit: 100,
      criticalThreshold: 0,
      locale: "en-GB",
      eventPrefix: "gantt",
      ...options,
    };
    this.fields = new FieldRegistry(options.fields ?? []);
    this.emitter = new Emitter({
      target: options.eventTarget ?? null,
      prefix: this.options.eventPrefix,
    });
    this.history = new History({ limit: this.options.historyLimit });
    /** @type {ProgrammeStore} */
    this.store = new ProgrammeStore({ schema: "streamlined-gantt/1", tasks: [], links: [] });
    /** @type {import("../engine/types.js").Programme} */
    this.cleanSnapshot = this.store.snapshot();
    /** @type {Transaction|null} */
    this.openTransaction = null;
    /** @type {Transaction|null} */
    this.pendingTransaction = null;
    /** @type {Array<() => void>} */
    this.queue = [];
    /** @type {Set<() => void>} */
    this.idleWaiters = new Set();
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    this.timers = new Set();
    /** @type {import("../engine/analysis.js").Analysis|null} */
    this.analysisCache = null;
    this.destroyed = false;
    /** @type {() => void} */
    this.releaseApprovals = () => {};
    /** @type {Promise<"__destroyed__">} resolves when destroy() runs, so pending approvals settle */
    this.destroyGate = new Promise((resolve) => {
      this.releaseApprovals = () => resolve("__destroyed__");
    });
    for (const [name, handler] of Object.entries(options.on ?? {})) this.on(name, handler);
    if (options.data) this.load(options.data);
  }

  /* ---------------------------------------------------------------- events */

  /**
   * @param {string} name
   * @param {(event: import("./emitter.js").GanttEvent) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(name, handler) {
    return this.emitter.on(name, handler);
  }

  /**
   * @param {string} name
   * @param {(event: import("./emitter.js").GanttEvent) => void} handler
   */
  off(name, handler) {
    this.emitter.off(name, handler);
  }

  /**
   * @param {string} name
   * @param {(event: import("./emitter.js").GanttEvent) => void} handler
   * @returns {() => void}
   */
  once(name, handler) {
    return this.emitter.once(name, handler);
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} [payload]
   */
  emit(name, payload) {
    if (this.destroyed && name !== "destroy") return null;
    return this.emitter.emit(name, payload);
  }

  /* ------------------------------------------------------------- data in/out */

  /**
   * Replaces the whole programme. Throws {@link GanttValidationError} listing
   * every problem. Clears undo history and marks the data clean.
   * @param {unknown} data
   * @returns {this}
   */
  load(data) {
    const programme = loadProgramme(data, { fields: this.fields });
    this.store = new ProgrammeStore(programme);
    this.history.clear();
    this.cleanSnapshot = this.store.snapshot();
    this.invalidate();
    this.onDataReplaced();
    this.emit("load", { programme: this.toJSON() });
    this.emitScheduleEvent();
    return this;
  }

  /** Hook for the UI layer. */
  onDataReplaced() {}

  /**
   * The programme in its stored form; deep-equal to what was loaded plus edits.
   * @returns {import("../engine/types.js").Programme}
   */
  toJSON() {
    return this.store.snapshot();
  }

  /* --------------------------------------------------------------- analysis */

  invalidate() {
    this.analysisCache = null;
  }

  /** @returns {import("../engine/analysis.js").Analysis} */
  get analysis() {
    this.analysisCache ??= analyse(this.store.data, {
      fields: this.fields,
      criticalThreshold: this.options.criticalThreshold,
      today: this.todayISO(),
    });
    return this.analysisCache;
  }

  /** @returns {string} */
  todayISO() {
    return this.options.today ? this.options.today() : toISO(today());
  }

  get calendar() {
    return this.analysis.calendar;
  }

  /**
   * A frozen snapshot of a task with derived values: summary dates, float,
   * criticality, computed custom fields and tree level.
   * @param {string} id
   * @returns {Readonly<Record<string, any>>|undefined}
   */
  getTask(id) {
    const task = this.store.get("tasks", id);
    if (!task) return undefined;
    const analysis = this.analysis;
    const resolved = analysis.resolved.get(id);
    const scheduled = analysis.schedule.tasks.get(id);
    const isSummary = analysis.tree.summaries.has(id);
    const snapshot = {
      ...structuredClone(task),
      ...(resolved
        ? {
            start: toISO(resolved.start),
            finish: toISO(resolved.finish),
            duration: resolved.duration,
          }
        : {}),
      fields: { ...(analysis.fieldValues.get(id) ?? task.fields ?? {}) },
      summary: isSummary,
      level: analysis.depth.get(id) ?? 1,
      progress: resolved ? resolved.progress : (task.progress ?? 0),
      float: scheduled ? { total: scheduled.totalFloat, free: scheduled.freeFloat } : null,
      critical: scheduled?.critical ?? false,
      early: scheduled ? { start: scheduled.earlyStart, finish: scheduled.earlyFinish } : null,
      late: scheduled ? { start: scheduled.lateStart, finish: scheduled.lateFinish } : null,
    };
    if (!task.fields && !isSummary && Object.keys(snapshot.fields).length === 0)
      delete snapshot.fields;
    return deepFreeze(snapshot);
  }

  /**
   * @param {(task: Readonly<Record<string, any>>) => boolean} [filter]
   * @returns {Readonly<Record<string, any>>[]}
   */
  getTasks(filter) {
    const tasks = this.analysis.order.map((id) => this.getTask(id));
    return filter ? tasks.filter(filter) : tasks;
  }

  /**
   * @param {string} id
   * @returns {Readonly<import("../engine/types.js").Link>|undefined}
   */
  getLink(id) {
    const link = this.store.get("links", id);
    return link ? deepFreeze(structuredClone(link)) : undefined;
  }

  /**
   * Links, optionally only those touching a task.
   * @param {string} [taskId]
   * @returns {Readonly<import("../engine/types.js").Link>[]}
   */
  getLinks(taskId) {
    const links = this.store
      .list("links")
      .filter((link) => !taskId || link.from === taskId || link.to === taskId);
    return links.map((link) => deepFreeze(structuredClone(link)));
  }

  /** @returns {Readonly<import("../engine/types.js").DelayEvent>[]} */
  getDelayEvents() {
    return this.store.list("delayEvents").map((event) => deepFreeze(structuredClone(event)));
  }

  /* -------------------------------------------------------------- summaries */

  /**
   * Project aggregates for host pages (see the custom fields guide).
   * @param {import("../engine/summary.js").SummaryOptions & {preview?: boolean, baselineId?: string}} [options]
   * @returns {import("../engine/summary.js").ProjectSummary}
   */
  getProjectSummary(options = {}) {
    const data = this.summaryData(options.preview === true);
    const analysis =
      data === this.store.data
        ? this.analysis
        : analyse(data, { fields: this.fields, today: this.todayISO() });
    const baselines = data.baselines ?? [];
    const baseline =
      options.baseline ??
      baselines.find((entry) => entry.id === options.baselineId) ??
      baselines[0] ??
      null;
    return projectSummary(analysis, data, { ...options, baseline });
  }

  /**
   * The programme the summary is computed from. The UI layer overrides this to
   * include an uncommitted drag when `preview` is requested.
   * @param {boolean} _preview
   * @returns {import("../engine/types.js").Programme}
   */
  summaryData(_preview) {
    return this.store.data;
  }

  /** @returns {import("../engine/summary.js").PaymentEntry[]} */
  getPaymentSchedule() {
    return this.getProjectSummary().payments;
  }

  /**
   * @param {string[]} [fieldKeys]
   * @param {(task: import("../engine/types.js").Task) => boolean} [filter]
   * @returns {Record<string, number>}
   */
  getFieldTotals(fieldKeys, filter) {
    return this.getProjectSummary({ fields: fieldKeys, filter }).sums;
  }

  /**
   * Formats integer minor units with the programme's currency and locale,
   * so host tables match the grid.
   * @param {number} minor
   * @returns {string}
   */
  formatMoney = (minor) =>
    formatMoney(minor, { locale: this.options.locale, currency: this.currency });

  get currency() {
    return this.options.currency ?? this.store.data.currency ?? "GBP";
  }

  /* --------------------------------------------------------- dirty tracking */

  /**
   * Everything changed since the last load or `markClean()`, as a changeset
   * that `applyPatch()` (and a backend) understands.
   * @returns {import("../engine/types.js").Changeset}
   */
  getChanges() {
    return diffProgrammes(this.cleanSnapshot, this.store.data);
  }

  /** @returns {boolean} */
  isDirty() {
    return !deepEqual(this.cleanSnapshot, this.store.data);
  }

  markClean() {
    this.cleanSnapshot = this.store.snapshot();
  }

  /* ------------------------------------------------------------- mutations */

  /**
   * Adds a task. `parent` and `index` (position among the parent's children)
   * place it in the tree; a missing id is generated.
   * @param {Partial<import("../engine/types.js").Task>} task
   * @param {{parent?: string|null, index?: number, cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  addTask(task, options = {}) {
    return this.perform(options.cause ?? "api", "Add task", (tx) =>
      this.opAddTask(tx, task, options),
    );
  }

  /**
   * Updates a task. Date rules: start + duration derive finish; start + finish
   * derive duration; start alone moves the task keeping its duration.
   * `fields` merge key by key.
   * @param {string} id
   * @param {Partial<import("../engine/types.js").Task>} patch
   * @param {{cause?: string, label?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  updateTask(id, patch, options = {}) {
    return this.perform(options.cause ?? "api", options.label ?? "Update task", (tx) =>
      this.opUpdateTask(tx, id, patch),
    );
  }

  /**
   * Removes a task. With `cascade` (default) its descendants go too; without,
   * they move up to its parent. Links touching removed tasks are removed.
   * @param {string} id
   * @param {{cascade?: boolean, cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  removeTask(id, options = {}) {
    return this.perform(options.cause ?? "api", "Remove task", (tx) =>
      this.opRemoveTask(tx, id, options.cascade ?? true),
    );
  }

  /**
   * Makes a task the last child of the sibling above it.
   * @param {string} id
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  indentTask(id, options = {}) {
    return this.perform(options.cause ?? "api", "Indent", (tx) => {
      const task = this.store.get("tasks", id);
      const siblings = this.analysis.tree.hierarchy.childrenOf.get(task?.parent ?? null) ?? [];
      const previous = siblings[siblings.indexOf(id) - 1];
      if (!task || !previous) {
        tx.reject(
          task ? "validation" : "not-found",
          task ? "There is no task above to indent under" : `Unknown task "${id}"`,
        );
        return;
      }
      this.opUpdateTask(tx, id, { parent: previous });
    });
  }

  /**
   * Moves a task up one level, to follow its former parent.
   * @param {string} id
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  outdentTask(id, options = {}) {
    return this.perform(options.cause ?? "api", "Outdent", (tx) => {
      const task = this.store.get("tasks", id);
      if (!task?.parent) {
        tx.reject(
          task ? "validation" : "not-found",
          task ? "The task is already at the top level" : `Unknown task "${id}"`,
        );
        return;
      }
      const grandparent = this.store.get("tasks", task.parent)?.parent ?? null;
      this.opUpdateTask(tx, id, { parent: grandparent });
    });
  }

  /**
   * Adds a dependency. A link that would create a cycle is refused with reason "cycle".
   * @param {Partial<import("../engine/types.js").Link>} link
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  addLink(link, options = {}) {
    return this.perform(options.cause ?? "api", "Add link", (tx) => this.opAddLink(tx, link));
  }

  /**
   * @param {string} id
   * @param {Partial<import("../engine/types.js").Link>} patch
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  updateLink(id, patch, options = {}) {
    return this.perform(options.cause ?? "api", "Update link", (tx) =>
      this.opUpdateLink(tx, id, patch),
    );
  }

  /**
   * @param {string} id
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  removeLink(id, options = {}) {
    return this.perform(options.cause ?? "api", "Remove link", (tx) => this.opRemoveLink(tx, id));
  }

  /**
   * @param {Partial<import("../engine/types.js").DelayEvent>} delay
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  addDelayEvent(delay, options = {}) {
    return this.perform(options.cause ?? "api", "Record delay", (tx) =>
      this.opEntity(tx, "delayEvents", "add", delay),
    );
  }

  /**
   * @param {string} id
   * @param {Partial<import("../engine/types.js").DelayEvent>} patch
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  updateDelayEvent(id, patch, options = {}) {
    return this.perform(options.cause ?? "api", "Update delay", (tx) =>
      this.opEntity(tx, "delayEvents", "update", { ...patch, id }),
    );
  }

  /**
   * @param {string} id
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  removeDelayEvent(id, options = {}) {
    return this.perform(options.cause ?? "api", "Remove delay", (tx) =>
      this.opEntity(tx, "delayEvents", "remove", { id }),
    );
  }

  /**
   * Sets programme-level properties such as `dataDate`, `contractCompletion`,
   * `revision`, `name` or `calendars`.
   * @param {Record<string, unknown>} values
   * @param {{cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  setProject(values, options = {}) {
    return this.perform(options.cause ?? "api", "Update programme", (tx) => {
      for (const [key, value] of Object.entries(values))
        this.applyRecords(tx, [this.store.recordFor("project", key, value ?? null, tx.cause)]);
    });
  }

  /**
   * Replaces (or adds) a calendar definition.
   * @param {string} id
   * @param {import("../engine/calendar.js").CalendarDefinition} calendar
   * @returns {Promise<EditResult>}
   */
  setCalendar(id, calendar) {
    const calendars = [...(this.store.data.calendars ?? [])];
    const index = calendars.findIndex((entry) => entry.id === id);
    const definition = { ...calendar, id };
    if (index === -1) calendars.push(definition);
    else calendars[index] = definition;
    return this.setProject({ calendars }, { cause: "api" });
  }

  /**
   * Captures the current dates of every task as a baseline.
   * @param {{id?: string, name?: string, captured?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  captureBaseline(options = {}) {
    const analysis = this.analysis;
    /** @type {Record<string, {start: string, finish: string}>} */
    const tasks = {};
    for (const [id, dates] of analysis.resolved) {
      if (analysis.tree.summaries.has(id)) continue;
      tasks[id] = { start: toISO(dates.start), finish: toISO(dates.finish) };
    }
    const baseline = {
      id: options.id ?? generateId("bl"),
      name: options.name ?? `Baseline ${(this.store.data.baselines?.length ?? 0) + 1}`,
      captured: options.captured ?? this.todayISO(),
      tasks,
    };
    return this.perform("api", "Capture baseline", (tx) =>
      this.opEntity(tx, "baselines", "add", baseline),
    );
  }

  /**
   * Runs the scheduler over the whole programme as one transaction
   * (cause "schedule") and returns what moved, the critical path and violations.
   * @returns {{changed: import("../engine/scheduler.js").ScheduleResult["changed"], critical: string[], floats: Record<string, {total: number, free: number}>, violations: import("../engine/scheduler.js").Violation[], result: Promise<EditResult>}}
   */
  schedule() {
    const mode = this.options.autoSchedule === "off" ? "propagate" : this.options.autoSchedule;
    const outcome = this.runScheduler(mode, new Set());
    const result = this.perform("schedule", "Reschedule", (tx) => {
      tx.schedule = false;
      this.applyCascade(tx, outcome.changed);
    });
    const analysis = this.analysis.schedule;
    const floats = Object.fromEntries(
      [...analysis.tasks].map(([id, task]) => [
        id,
        { total: task.totalFloat, free: task.freeFloat },
      ]),
    );
    return {
      changed: outcome.changed,
      critical: analysis.critical,
      floats,
      violations: analysis.violations,
      result,
    };
  }

  /**
   * Groups mutations into one transaction: one undo step, one `change`.
   * Nested batches fold into the outer one. If `fn` throws, everything it
   * did is rolled back, nothing is emitted and the error is re-thrown.
   * @param {() => void} fn
   * @param {{label?: string, cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  batch(fn, options = {}) {
    return this.perform(options.cause ?? "api", options.label ?? "Batch", () => fn());
  }

  /**
   * Applies an authoritative changeset (for example dates recomputed by the
   * backend). No before events and no rescheduling. With `undoable: false` the
   * patch is kept out of history and undo never overwrites it (ADR-0006).
   * With `silent`, no after events or `change` fire.
   * @param {import("../engine/types.js").Changeset} changeset
   * @param {{undoable?: boolean, silent?: boolean, label?: string, cause?: string}} [options]
   * @returns {Promise<EditResult>}
   */
  applyPatch(changeset, options = {}) {
    return this.perform(
      options.cause ?? "patch",
      options.label ?? "Apply patch",
      (tx) => this.opChangeset(tx, changeset),
      {
        undoable: options.undoable ?? true,
        silent: options.silent ?? false,
        schedule: false,
        source: "server",
      },
    );
  }

  /** @returns {boolean} */
  canUndo() {
    return this.history.canUndo();
  }

  /** @returns {boolean} */
  canRedo() {
    return this.history.canRedo();
  }

  /**
   * Reverts the last transaction and emits `change` with cause "undo", so a
   * backend persists it like any other edit.
   * @returns {Promise<EditResult>|false} false when there is nothing to undo
   */
  undo() {
    if (!this.canUndo() || this.pendingTransaction) return false;
    const entry = this.history.takeUndo();
    return this.replay(entry, "undo", true);
  }

  /**
   * @returns {Promise<EditResult>|false} false when there is nothing to redo
   */
  redo() {
    if (!this.canRedo() || this.pendingTransaction) return false;
    const entry = this.history.takeRedo();
    return this.replay(entry, "redo", false);
  }

  /**
   * @param {import("./history.js").HistoryEntry} entry
   * @param {string} cause
   * @param {boolean} invert
   * @returns {Promise<EditResult>}
   */
  replay(entry, cause, invert) {
    const tx = new Transaction(cause, `${cause === "undo" ? "Undo" : "Redo"} ${entry.label}`, {
      undoable: false,
      schedule: false,
    });
    const records = invert
      ? [...entry.records].reverse().map((record) => ({
          ...record,
          before: record.after,
          after: record.before,
          beforeIndex: record.afterIndex,
          afterIndex: record.beforeIndex,
          cause,
        }))
      : entry.records.map((record) => ({ ...record, cause }));
    this.store.apply(records);
    tx.records = records;
    this.invalidate();
    this.commit(tx);
    return Promise.resolve({ committed: true, transactionId: tx.id });
  }

  /**
   * Resolves when no transaction is awaiting approval or queued.
   * @returns {Promise<void>}
   */
  whenIdle() {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /** @returns {boolean} */
  isIdle() {
    return !this.pendingTransaction && this.queue.length === 0;
  }

  notifyIdle() {
    if (!this.isIdle()) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  /* --------------------------------------------------- transaction pipeline */

  /**
   * Runs `body` inside a transaction, or inside the open one when nested.
   * @param {string} cause
   * @param {string} label
   * @param {(tx: Transaction) => void} body
   * @param {ConstructorParameters<typeof Transaction>[2]} [options]
   * @returns {Promise<EditResult>}
   */
  perform(cause, label, body, options) {
    if (this.destroyed)
      return Promise.resolve({ committed: false, transactionId: "", reason: "destroyed" });
    if (this.openTransaction) {
      body(this.openTransaction);
      return Promise.resolve({
        committed: false,
        transactionId: this.openTransaction.id,
        reason: "batched",
      });
    }
    if (this.pendingTransaction || this.queue.length) {
      return new Promise((resolve) => {
        this.queue.push(() => resolve(this.perform(cause, label, body, options)));
      });
    }
    const tx = new Transaction(cause, label, options);
    this.openTransaction = tx;
    try {
      body(tx);
    } catch (error) {
      this.openTransaction = null;
      this.store.revert(tx.records);
      this.invalidate();
      throw error;
    }
    this.openTransaction = null;
    return this.finish(tx);
  }

  /**
   * @param {Transaction} tx
   * @returns {Promise<EditResult>}
   */
  finish(tx) {
    if (!tx.rejection) this.validateDocument(tx);
    if (!tx.rejection && tx.schedule) this.cascade(tx);
    if (tx.rejection) return Promise.resolve(this.rejectTransaction(tx));
    if (tx.records.length === 0)
      return Promise.resolve({ committed: false, transactionId: tx.id, reason: "no-change" });
    const pending = tx.silent || tx.source === "server" ? [] : this.fireBeforeEvents(tx);
    if (tx.rejection) return Promise.resolve(this.rejectTransaction(tx));
    if (pending.length === 0) {
      this.commit(tx);
      return Promise.resolve({ committed: true, transactionId: tx.id });
    }
    return this.awaitApproval(tx, pending);
  }

  /**
   * Rejects a transaction whose result would be invalid data.
   * @param {Transaction} tx
   */
  validateDocument(tx) {
    if (!tx.records.length) return;
    const problems = collectProblems(this.store.data, {
      fieldValidator: (task, path, list) => this.fields.checkStored(task, path, list),
    });
    if (!problems.length) return;
    const cycle = problems.find((problem) => problem.message.startsWith("dependency cycle"));
    const reason = cycle ? "cycle" : "validation";
    tx.reject(
      reason,
      problems.map((problem) => `${problem.path}: ${problem.message}`).join("; "),
      new GanttValidationError(problems),
    );
  }

  /**
   * Runs the scheduler and folds its moves into the transaction.
   * @param {Transaction} tx
   */
  cascade(tx) {
    if (this.options.autoSchedule === "off") return;
    const affectsSchedule = tx.records.some((record) => this.recordAffectsSchedule(record));
    if (!affectsSchedule) return;
    let outcome;
    try {
      outcome = this.runScheduler(this.options.autoSchedule, tx.pinned);
    } catch (error) {
      tx.reject("cycle", error instanceof Error ? error.message : String(error), error);
      return;
    }
    this.applyCascade(tx, outcome.changed);
  }

  /**
   * @param {import("./store.js").ChangeRecord} record
   * @returns {boolean}
   */
  recordAffectsSchedule(record) {
    if (record.collection === "links") return true;
    if (record.collection === "project") return SCHEDULING_PROJECT_KEYS.has(record.id);
    if (record.collection !== "tasks") return false;
    if (!record.before || !record.after) return true;
    return changedFields(record.before, record.after).some((key) => SCHEDULING_KEYS.has(key));
  }

  /**
   * @param {string} mode "propagate" or "tight"
   * @param {Set<string>} pinned
   * @returns {import("../engine/scheduler.js").ScheduleResult}
   */
  runScheduler(mode, pinned) {
    const data = this.store.data;
    return runSchedule({
      tasks: data.tasks,
      links: data.links ?? [],
      calendar: schedulingCalendar(data),
      dataDate: data.dataDate ?? null,
      contractCompletion: data.contractCompletion ?? null,
      mode: /** @type {"propagate"|"tight"} */ (mode),
      pinned,
      criticalThreshold: this.options.criticalThreshold,
      today: this.todayISO(),
    });
  }

  /**
   * @param {Transaction} tx
   * @param {import("../engine/scheduler.js").ScheduleResult["changed"]} changed
   */
  applyCascade(tx, changed) {
    const records = [];
    for (const change of changed) {
      const task = this.store.get("tasks", change.id);
      const after = {
        ...task,
        start: change.start,
        finish: change.finish,
        duration: change.duration,
      };
      const ownCause = tx.records.find(
        (record) => record.collection === "tasks" && record.id === change.id,
      )?.cause;
      records.push(this.store.recordFor("tasks", change.id, after, ownCause ?? "schedule"));
    }
    this.applyRecords(tx, records);
    tx.cascade = changed.map((change) => ({ ...change }));
  }

  /**
   * @param {Transaction} tx
   * @param {import("./store.js").ChangeRecord[]} records
   */
  applyRecords(tx, records) {
    if (!records.length) return;
    this.store.apply(records);
    tx.records.push(...records);
    this.invalidate();
  }

  /**
   * Fires one before event per requested operation. Returns pending promises.
   * @param {Transaction} tx
   * @returns {Promise<unknown>[]}
   */
  fireBeforeEvents(tx) {
    const pending = [];
    for (const intent of tx.intents) {
      const event = this.emit(intent.event, {
        transactionId: tx.id,
        label: tx.label,
        cause: tx.cause,
        ...intent.payload,
        cascade: tx.cascade.filter((change) => change.id !== intent.payload.id),
      });
      if (!event) continue;
      if (event.defaultPrevented) {
        tx.reject("vetoed", `${intent.event} was prevented by a handler`);
        return [];
      }
      pending.push(...event.pending);
    }
    return pending;
  }

  /**
   * @param {Transaction} tx
   * @returns {EditResult}
   */
  rejectTransaction(tx) {
    const taskIds = tx.touchedTaskIds;
    const linkIds = tx.touchedLinkIds;
    this.store.revert(tx.records);
    tx.records = [];
    this.invalidate();
    this.onTransactionSettled(tx);
    const { reason, message, error } = tx.rejection;
    this.emit("edit-rejected", {
      transactionId: tx.id,
      label: tx.label,
      cause: tx.cause,
      reason,
      taskIds,
      linkIds,
      message,
      error,
    });
    this.drainQueue();
    return { committed: false, transactionId: tx.id, reason };
  }

  /**
   * Waits for `waitUntil()` promises, showing the result optimistically or
   * holding it in confirm mode.
   * @param {Transaction} tx
   * @param {Promise<unknown>[]} pending
   * @returns {Promise<EditResult>}
   */
  awaitApproval(tx, pending) {
    this.pendingTransaction = tx;
    const optimistic = this.options.editMode !== "confirm";
    const records = tx.records;
    if (!optimistic) {
      this.store.revert(records);
      this.invalidate();
    }
    this.onApprovalPending(tx, optimistic);
    return this.settleApprovals(pending).then((verdict) => {
      if (this.destroyed) return { committed: false, transactionId: tx.id, reason: "destroyed" };
      this.pendingTransaction = null;
      if (!optimistic) {
        this.store.apply(records);
        this.invalidate();
      }
      return this.resolveApproval(tx, verdict);
    });
  }

  /**
   * @param {Promise<unknown>[]} pending
   * @returns {Promise<{outcome: "accept"|"veto"|"error"|"timeout"|"replace", changesets: import("../engine/types.js").Changeset[], error?: unknown}>}
   */
  settleApprovals(pending) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("__timeout__"), this.options.approvalTimeout);
      this.timers.add(timer);
    });
    const all = Promise.allSettled(pending).then((results) => results);
    return Promise.race([all, timeout, this.destroyGate]).then((results) => {
      clearTimeout(timer);
      this.timers.delete(timer);
      if (results === "__timeout__") return { outcome: "timeout", changesets: [] };
      if (results === "__destroyed__") return { outcome: "veto", changesets: [] };
      const settled = /** @type {PromiseSettledResult<unknown>[]} */ (results);
      const failed = settled.find((result) => result.status === "rejected");
      if (failed)
        return {
          outcome: "error",
          changesets: [],
          error: /** @type {PromiseRejectedResult} */ (failed).reason,
        };
      const values = settled.map(
        (result) => /** @type {PromiseFulfilledResult<unknown>} */ (result).value,
      );
      if (values.some((value) => value === false)) return { outcome: "veto", changesets: [] };
      const changesets = values.filter(isChangeset);
      return { outcome: changesets.length ? "replace" : "accept", changesets };
    });
  }

  /**
   * @param {Transaction} tx
   * @param {Awaited<ReturnType<ProgrammeController["settleApprovals"]>>} verdict
   * @returns {EditResult}
   */
  resolveApproval(tx, verdict) {
    if (verdict.outcome === "accept") {
      this.commit(tx);
      this.drainQueue();
      return { committed: true, transactionId: tx.id };
    }
    if (verdict.outcome !== "replace") {
      const reasons = { veto: "vetoed", error: "error", timeout: "timeout" };
      const messages = {
        veto: "The server rejected the change",
        error: "The approval promise rejected",
        timeout: `No approval within ${this.options.approvalTimeout} ms`,
      };
      tx.reject(reasons[verdict.outcome], messages[verdict.outcome], verdict.error);
      return this.rejectTransaction(tx);
    }
    this.store.revert(tx.records);
    tx.records = [];
    tx.source = "server";
    try {
      for (const changeset of verdict.changesets) this.opChangeset(tx, changeset);
      this.validateDocument(tx);
    } catch (error) {
      tx.reject("error", "The server changeset could not be applied", error);
    }
    if (tx.rejection) return this.rejectTransaction(tx);
    this.commit(tx);
    this.drainQueue();
    return { committed: true, transactionId: tx.id };
  }

  drainQueue() {
    this.onTransactionSettled(null);
    const next = this.queue.shift();
    if (next) next();
    this.notifyIdle();
  }

  /**
   * Hooks for the UI layer.
   * @param {Transaction} _tx
   * @param {boolean} _optimistic
   */
  onApprovalPending(_tx, _optimistic) {}

  /** @param {Transaction|null} _tx */
  onTransactionSettled(_tx) {}

  /** @param {Transaction} _tx */
  onCommitted(_tx) {}

  /**
   * Records history, then fires the after events and exactly one `change`.
   * @param {Transaction} tx
   */
  commit(tx) {
    if (tx.undoable) {
      this.history.push({
        transactionId: tx.id,
        label: tx.label,
        cause: tx.cause,
        records: tx.records,
      });
    } else if (tx.cause === "patch") {
      this.history.protect(tx.records);
    }
    this.invalidate();
    this.onTransactionSettled(tx);
    this.onCommitted(tx);
    if (!tx.silent) this.emitAfterEvents(tx);
    this.emitScheduleEvent();
  }

  /** @param {Transaction} tx */
  emitAfterEvents(tx) {
    const compacted = compactRecords(tx.records);
    /** @type {Record<string, {added: any[], updated: any[], removed: any[]}>} */
    const changes = Object.fromEntries(
      ENTITY_COLLECTIONS.map((collection) => [collection, { added: [], updated: [], removed: [] }]),
    );
    const project = { updated: [] };
    const base = { transactionId: tx.id, label: tx.label };
    for (const record of compacted) {
      if (record.collection === "project") {
        const entry = { key: record.id, old: record.before, new: record.after };
        project.updated.push(entry);
        this.emit("project-update", { ...base, cause: record.cause, ...entry });
        continue;
      }
      this.emitEntityEvent(record, changes[record.collection], base);
    }
    this.emit("change", {
      ...base,
      cause: tx.cause,
      source: tx.source,
      changes: { ...changes, project },
    });
  }

  /**
   * @param {import("./store.js").ChangeRecord} record
   * @param {{added: any[], updated: any[], removed: any[]}} bucket
   * @param {{transactionId: string, label: string}} base
   */
  emitEntityEvent(record, bucket, base) {
    const names = {
      tasks: "task",
      links: "link",
      delayEvents: "delay",
      markers: null,
      baselines: null,
    };
    const prefix = names[record.collection];
    const cause = record.cause;
    if (!record.before) {
      bucket.added.push(record.after);
      if (prefix)
        this.emit(`${prefix}-add`, {
          ...base,
          cause,
          id: record.id,
          [prefix === "delay" ? "delay" : prefix]: record.after,
        });
      return;
    }
    if (!record.after) {
      bucket.removed.push(record.before);
      if (prefix)
        this.emit(`${prefix}-remove`, {
          ...base,
          cause,
          id: record.id,
          [prefix === "delay" ? "delay" : prefix]: record.before,
        });
      return;
    }
    const fieldsChanged = changedFields(record.before, record.after);
    const entry = {
      id: record.id,
      old: record.before,
      new: record.after,
      changedFields: fieldsChanged,
      cause,
    };
    bucket.updated.push(entry);
    if (prefix) this.emit(`${prefix}-update`, { ...base, ...entry });
    if (record.collection !== "tasks") return;
    for (const field of fieldsChanged) {
      const key = field.startsWith("fields.") ? field.slice(7) : field;
      const read = (task) => (field.startsWith("fields.") ? task.fields?.[key] : task[key]);
      this.emit("field-change", {
        taskId: record.id,
        field,
        old: read(record.before),
        new: read(record.after),
        cause,
        transactionId: base.transactionId,
      });
    }
  }

  emitScheduleEvent() {
    const result = this.analysis.schedule;
    this.emit("schedule", {
      critical: result.critical,
      violations: result.violations,
      projectStart: result.projectStart,
      projectFinish: result.projectFinish,
    });
  }

  /* ------------------------------------------------------------ operations */

  /**
   * @param {Transaction} tx
   * @param {Partial<import("../engine/types.js").Task>} input
   * @param {{parent?: string|null, index?: number}} options
   */
  opAddTask(tx, input, options) {
    const parent = options.parent !== undefined ? options.parent : (input.parent ?? null);
    if (parent && !this.store.get("tasks", parent)) {
      tx.reject("not-found", `Unknown parent "${parent}"`);
      return;
    }
    const task = this.defaultsForNewTask({ ...input, ...(parent ? { parent } : {}) });
    if (this.store.get("tasks", task.id)) {
      tx.reject("validation", `A task with id "${task.id}" already exists`);
      return;
    }
    const position = this.insertionIndex(parent, options.index);
    this.applyRecords(tx, [this.store.recordFor("tasks", task.id, task, tx.cause, position)]);
    tx.pinned.add(task.id);
    tx.intents.push({ event: "before-task-add", payload: { id: task.id, task, changes: task } });
  }

  /**
   * @param {Partial<import("../engine/types.js").Task>} input
   * @returns {import("../engine/types.js").Task}
   */
  defaultsForNewTask(input) {
    const task = { id: input.id ?? generateId("t"), name: input.name ?? "New task", ...input };
    if (task.type === "summary") return /** @type {any} */ (task);
    const start =
      task.start ??
      this.store.data.dataDate ??
      this.analysis.schedule.projectStart ??
      this.todayISO();
    const calendar = this.calendar;
    const dates = normaliseDatePatch(
      { ...task, start, duration: task.duration ?? (isMilestone(task) ? 0 : 1) },
      {
        start,
        ...(task.finish ? { finish: task.finish } : {}),
        ...(task.duration !== undefined ? { duration: task.duration } : {}),
      },
      calendar,
    );
    return /** @type {any} */ ({ ...task, ...dates });
  }

  /**
   * Absolute array index for a new child at `siblingIndex` under `parent`.
   * @param {string|null} parent
   * @param {number|undefined} siblingIndex
   * @returns {number}
   */
  insertionIndex(parent, siblingIndex) {
    const tasks = this.store.list("tasks");
    const hierarchy = this.analysis.tree.hierarchy;
    const siblings = hierarchy.childrenOf.get(parent) ?? [];
    const lastOfSubtree = (id) => {
      const descendants = leavesOfSubtree(id, hierarchy);
      return Math.max(...descendants.map((descendant) => this.store.indexOf("tasks", descendant)));
    };
    if (siblingIndex === undefined || siblingIndex >= siblings.length) {
      if (siblings.length) return lastOfSubtree(siblings[siblings.length - 1]) + 1;
      return parent ? this.store.indexOf("tasks", parent) + 1 : tasks.length;
    }
    return this.store.indexOf("tasks", siblings[Math.max(0, siblingIndex)]);
  }

  /**
   * @param {Transaction} tx
   * @param {string} id
   * @param {Partial<import("../engine/types.js").Task>} patch
   */
  opUpdateTask(tx, id, patch) {
    tx.subjectTaskIds.add(id);
    const task = this.store.get("tasks", id);
    if (!task) {
      tx.reject("not-found", `Unknown task "${id}"`);
      return;
    }
    if (isLocked(task) && tx.source !== "server") {
      tx.reject("locked", `"${task.name}" is locked`);
      return;
    }
    if (!this.validateFieldPatch(tx, task, patch)) return;
    let normalised = { ...patch };
    const touchesDates = DATE_KEYS.some((key) => patch[key] !== undefined);
    const isLeaf = !this.analysis.tree.summaries.has(id);
    if (touchesDates && isLeaf) {
      normalised = { ...normalised, ...normaliseDatePatch(task, pickDates(patch), this.calendar) };
      if (patch.start !== undefined || patch.finish !== undefined) tx.pinned.add(id);
    }
    const after = mergePatch(task, normalised);
    if (deepEqual(after, task)) return;
    const record = this.store.recordFor("tasks", id, after, tx.cause);
    this.applyRecords(tx, [record]);
    tx.intents.push({
      event: "before-task-update",
      payload: {
        id,
        old: record.before,
        new: after,
        changes: patch,
        changedFields: changedFields(record.before, after),
      },
    });
  }

  /**
   * Field-level validation; emits `validation-error` and rejects on failure.
   * @param {Transaction} tx
   * @param {import("../engine/types.js").Task} task
   * @param {Partial<import("../engine/types.js").Task>} patch
   * @returns {boolean}
   */
  validateFieldPatch(tx, task, patch) {
    const candidate = mergePatch(task, patch);
    for (const [key, value] of Object.entries(patch.fields ?? {})) {
      const definition = this.fields.get(key);
      if (definition && !this.fields.isEditable(key)) {
        return this.failValidation(
          tx,
          task.id,
          `fields.${key}`,
          value,
          `${definition.label ?? key} is read-only`,
        );
      }
      const message = this.fields.validate(key, value, candidate, { programme: this.store.data });
      if (message) return this.failValidation(tx, task.id, `fields.${key}`, value, message);
    }
    if (
      patch.progress !== undefined &&
      !(typeof patch.progress === "number" && patch.progress >= 0 && patch.progress <= 1)
    ) {
      return this.failValidation(
        tx,
        task.id,
        "progress",
        patch.progress,
        "Progress must be between 0 and 100%",
      );
    }
    if (patch.name !== undefined && typeof patch.name !== "string") {
      return this.failValidation(tx, task.id, "name", patch.name, "Name must be text");
    }
    return true;
  }

  /**
   * @param {Transaction} tx
   * @param {string} taskId
   * @param {string} field
   * @param {unknown} value
   * @param {string} message
   * @returns {false}
   */
  failValidation(tx, taskId, field, value, message) {
    this.emit("validation-error", { taskId, field, value, message });
    tx.reject("validation", message);
    return false;
  }

  /**
   * @param {Transaction} tx
   * @param {string} id
   * @param {boolean} cascade
   */
  opRemoveTask(tx, id, cascade) {
    tx.subjectTaskIds.add(id);
    const task = this.store.get("tasks", id);
    if (!task) {
      tx.reject("not-found", `Unknown task "${id}"`);
      return;
    }
    const hierarchy = this.analysis.tree.hierarchy;
    const descendants = cascade
      ? leavesOfSubtree(id, hierarchy).filter((descendant) => descendant !== id)
      : [];
    const removed = new Set([id, ...descendants]);
    const records = [];
    if (!cascade) {
      for (const child of hierarchy.childrenOf.get(id) ?? []) {
        const childTask = this.store.get("tasks", child);
        records.push(
          this.store.recordFor(
            "tasks",
            child,
            mergePatch(childTask, { parent: task.parent ?? null }),
            tx.cause,
          ),
        );
      }
    }
    this.applyRecords(tx, records);
    for (const link of [...this.store.list("links")]) {
      if (removed.has(link.from) || removed.has(link.to))
        this.applyRecords(tx, [this.store.recordFor("links", link.id, null, tx.cause)]);
    }
    for (const delay of [...this.store.list("delayEvents")]) {
      const taskIds = delay.taskIds ?? [];
      if (!taskIds.some((taskId) => removed.has(taskId))) continue;
      this.applyRecords(tx, [
        this.store.recordFor(
          "delayEvents",
          delay.id,
          { ...delay, taskIds: taskIds.filter((taskId) => !removed.has(taskId)) },
          tx.cause,
        ),
      ]);
    }
    for (const removedId of [...descendants].reverse().concat(id)) {
      this.applyRecords(tx, [this.store.recordFor("tasks", removedId, null, tx.cause)]);
    }
    tx.intents.push({ event: "before-task-remove", payload: { id, task: structuredClone(task) } });
  }

  /**
   * @param {Transaction} tx
   * @param {Partial<import("../engine/types.js").Link>} input
   */
  opAddLink(tx, input) {
    const link = {
      id: input.id ?? generateId("l"),
      from: input.from,
      to: input.to,
      type: input.type ?? "FS",
      lag: input.lag ?? 0,
    };
    const tasks = this.store.list("tasks");
    const known = this.store.get("tasks", link.from) && this.store.get("tasks", link.to);
    if (!known) {
      tx.reject("not-found", "Both ends of a link must be existing tasks");
      return;
    }
    if (link.from === link.to || wouldCreateCycle(tasks, this.store.list("links"), link)) {
      tx.reject("cycle", `Linking "${link.from}" to "${link.to}" would create a dependency cycle`);
      return;
    }
    const duplicate = this.store
      .list("links")
      .some((existing) => existing.from === link.from && existing.to === link.to);
    if (duplicate || this.store.get("links", link.id)) {
      tx.reject("validation", "That dependency already exists");
      return;
    }
    this.applyRecords(tx, [this.store.recordFor("links", link.id, link, tx.cause)]);
    tx.pinned.add(link.to);
    tx.intents.push({ event: "before-link-add", payload: { id: link.id, link } });
  }

  /**
   * @param {Transaction} tx
   * @param {string} id
   * @param {Partial<import("../engine/types.js").Link>} patch
   */
  opUpdateLink(tx, id, patch) {
    tx.subjectLinkIds.add(id);
    const link = this.store.get("links", id);
    if (!link) {
      tx.reject("not-found", `Unknown link "${id}"`);
      return;
    }
    const after = mergePatch(link, patch);
    const others = this.store.list("links").filter((existing) => existing.id !== id);
    if (wouldCreateCycle(this.store.list("tasks"), others, /** @type {any} */ (after))) {
      tx.reject("cycle", "That change would create a dependency cycle");
      return;
    }
    const record = this.store.recordFor("links", id, after, tx.cause);
    this.applyRecords(tx, [record]);
    tx.intents.push({
      event: "before-link-update",
      payload: { id, old: record.before, new: after, changes: patch },
    });
  }

  /**
   * @param {Transaction} tx
   * @param {string} id
   */
  opRemoveLink(tx, id) {
    tx.subjectLinkIds.add(id);
    const link = this.store.get("links", id);
    if (!link) {
      tx.reject("not-found", `Unknown link "${id}"`);
      return;
    }
    this.applyRecords(tx, [this.store.recordFor("links", id, null, tx.cause)]);
    tx.intents.push({ event: "before-link-remove", payload: { id, link: structuredClone(link) } });
  }

  /**
   * Generic add/update/remove for delay events, markers and baselines.
   * @param {Transaction} tx
   * @param {"delayEvents"|"markers"|"baselines"} collection
   * @param {"add"|"update"|"remove"} action
   * @param {Record<string, any>} input
   */
  opEntity(tx, collection, action, input) {
    const id = input.id ?? generateId(collection === "delayEvents" ? "d" : collection.slice(0, 2));
    const existing = this.store.get(collection, id);
    const missing = action !== "add" && !existing;
    if (missing || (action === "add" && existing)) {
      tx.reject(
        missing ? "not-found" : "validation",
        missing ? `Unknown ${collection} entry "${id}"` : `"${id}" already exists`,
      );
      return;
    }
    const after =
      action === "remove"
        ? null
        : action === "add"
          ? { ...input, id }
          : mergePatch(existing, input);
    const record = this.store.recordFor(collection, id, after, tx.cause);
    this.applyRecords(tx, [record]);
    if (collection !== "delayEvents") return;
    const event = {
      add: "before-delay-add",
      update: "before-delay-update",
      remove: "before-delay-remove",
    }[action];
    const payload =
      action === "update"
        ? { id, old: record.before, new: after, changes: input }
        : { id, delay: after ?? record.before };
    tx.intents.push({ event, payload });
  }

  /**
   * Applies a changeset as records (no events of its own).
   * @param {Transaction} tx
   * @param {import("../engine/types.js").Changeset} changeset
   */
  opChangeset(tx, changeset) {
    for (const collection of ENTITY_COLLECTIONS) {
      const patch = changeset?.[collection];
      if (!patch) continue;
      for (const item of patch.add ?? []) {
        this.applyRecords(tx, [
          this.store.recordFor(collection, item.id, structuredClone(item), tx.cause),
        ]);
      }
      for (const item of patch.update ?? []) {
        const existing = this.store.get(collection, item.id);
        if (!existing)
          throw new RangeError(`Changeset updates unknown ${collection} entry "${item.id}"`);
        this.applyRecords(tx, [
          this.store.recordFor(collection, item.id, mergePatch(existing, item), tx.cause),
        ]);
      }
      for (const id of patch.remove ?? []) {
        if (this.store.get(collection, id))
          this.applyRecords(tx, [this.store.recordFor(collection, id, null, tx.cause)]);
      }
    }
    for (const [key, value] of Object.entries(changeset?.project ?? {})) {
      this.applyRecords(tx, [this.store.recordFor("project", key, value ?? null, tx.cause)]);
    }
  }

  /* -------------------------------------------------------------- lifecycle */

  /**
   * Releases everything. Idempotent. Pending approvals resolve as "destroyed".
   */
  destroy() {
    if (this.destroyed) return;
    this.emit("destroy", {});
    this.destroyed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.releaseApprovals();
    this.queue = [];
    this.pendingTransaction = null;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
    this.emitter.clear();
  }
}

/**
 * Every task in a subtree (the task itself first).
 * @param {string} id
 * @param {import("../engine/graph.js").Hierarchy} hierarchy
 * @returns {string[]}
 */
function leavesOfSubtree(id, hierarchy) {
  const result = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    result.push(current);
    const children = hierarchy.childrenOf.get(current) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

/**
 * @param {Record<string, any>} patch
 * @returns {{start?: string, finish?: string, duration?: number}}
 */
function pickDates(patch) {
  const dates = {};
  for (const key of DATE_KEYS) if (patch[key] !== undefined) dates[key] = patch[key];
  return dates;
}

/**
 * Whether an approval handler resolved with a changeset to apply in place of
 * the edit, rather than `true`, `false` or nothing.
 * @param {unknown} value
 * @returns {value is import("../engine/types.js").Changeset}
 */
function isChangeset(value) {
  return value !== null && typeof value === "object";
}
