// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay, toISO } from "./dates.js";
import { expandLinks, topologicalOrder } from "./graph.js";
import { indexTree, isComplete, isLocked, isStarted, resolveLeafDates } from "./model.js";

/**
 * Critical path method scheduler.
 *
 * Both passes run in *working-index space* (see {@link import("./calendar.js").Calendar#indexOf}):
 * a task occupies the half-open interval `[ES, EF)` of working indices, so
 * `EF = ES + duration` and every link rule is plain integer arithmetic. Dates
 * are converted back only at the end, with `finish` reported inclusively.
 *
 * A milestone is a point. It is *finish-anchored* (sits at the end of its
 * date, as MS Project shows a milestone after a task) when any incoming link
 * is FS or FF; otherwise it is *start-anchored* (sits at the start of its date,
 * like "start on site").
 *
 * Modes:
 * - `propagate`: tasks move later when their predecessors require it, never earlier.
 * - `tight`: tasks with predecessors are pulled back to the earliest date the
 *   logic allows (tasks the user has just moved are kept where they were put).
 * - `off`: nothing moves; floats and violations are still reported.
 *
 * Locked tasks, reference tasks and need-by dates keep their stored dates and
 * report a violation when logic would move them.
 *
 * Progress: complete tasks keep their dates; started tasks keep their start
 * and their remaining work cannot finish before the data date allows;
 * unstarted tasks cannot start before the data date.
 *
 * @module engine/scheduler
 */

/**
 * @typedef {object} ScheduleInput
 * @property {import("./types.js").Task[]} tasks
 * @property {import("./types.js").Link[]} links
 * @property {import("./calendar.js").Calendar} calendar
 * @property {string|null} [dataDate]
 * @property {string|null} [contractCompletion]
 * @property {"propagate"|"tight"|"off"} [mode]
 * @property {Iterable<string>} [pinned] tasks whose current start must be kept
 * @property {number} [criticalThreshold] total float at or below which a task is critical (default 0)
 * @property {string|null} [today] used for overdue need-by dates when there is no data date
 */

/**
 * @typedef {object} TaskSchedule
 * @property {string} start
 * @property {string} finish inclusive
 * @property {number} duration
 * @property {string} earlyStart
 * @property {string} earlyFinish
 * @property {string} lateStart
 * @property {string} lateFinish
 * @property {number} totalFloat working days; negative when the programme is late
 * @property {number} freeFloat working days
 * @property {boolean} critical
 */

/**
 * @typedef {object} Violation
 * @property {string} code
 * @property {string} taskId
 * @property {string} [linkId]
 * @property {string} message
 */

/**
 * @typedef {object} ScheduleResult
 * @property {{id: string, start: string, finish: string, duration: number}[]} changed
 * @property {Map<string, TaskSchedule>} tasks
 * @property {string[]} critical
 * @property {Violation[]} violations
 * @property {string|null} projectStart
 * @property {string|null} projectFinish
 * @property {number|null} terminalFloat working days between planned finish and contract completion
 */

/**
 * @typedef {object} Node
 * @property {import("./types.js").Task} task
 * @property {import("./model.js").ResolvedDates} dates
 * @property {number} duration
 * @property {number} currentStart
 * @property {"start"|"finish"} anchor
 * @property {import("./graph.js").Edge[]} incoming
 * @property {import("./graph.js").Edge[]} outgoing
 * @property {number} ES
 * @property {number} EF
 * @property {number} LS
 * @property {number} LF
 */

/**
 * Smallest early start the link allows for `node`.
 * @param {import("./graph.js").Edge} edge
 * @param {Node} predecessor
 * @param {number} duration
 * @returns {number}
 */
function requiredStart(edge, predecessor, duration) {
  if (edge.type === "SS") return predecessor.ES + edge.lag;
  if (edge.type === "FF") return predecessor.EF + edge.lag - duration;
  if (edge.type === "SF") return predecessor.ES + edge.lag - duration;
  return predecessor.EF + edge.lag;
}

/**
 * Largest late finish the link allows for the predecessor.
 * @param {import("./graph.js").Edge} edge
 * @param {Node} successor
 * @param {number} duration predecessor duration
 * @returns {number}
 */
function allowedFinish(edge, successor, duration) {
  if (edge.type === "SS") return successor.LS - edge.lag + duration;
  if (edge.type === "FF") return successor.LF - edge.lag;
  if (edge.type === "SF") return successor.LF - edge.lag + duration;
  return successor.LS - edge.lag;
}

/**
 * Slack on one link given early dates, for free float.
 * @param {import("./graph.js").Edge} edge
 * @param {Node} predecessor
 * @param {Node} successor
 * @returns {number}
 */
function linkSlack(edge, predecessor, successor) {
  if (edge.type === "SS") return successor.ES - edge.lag - predecessor.ES;
  if (edge.type === "FF") return successor.EF - edge.lag - predecessor.EF;
  if (edge.type === "SF") return successor.EF - edge.lag - predecessor.ES;
  return successor.ES - edge.lag - predecessor.EF;
}

/**
 * @param {import("./graph.js").Edge[]} incoming
 * @returns {"start"|"finish"}
 */
function milestoneAnchor(incoming) {
  return incoming.some((edge) => edge.type === "FS" || edge.type === "FF") ? "finish" : "start";
}

/**
 * Why a task that keeps its stored dates conflicts with its predecessors.
 * @param {string} mode
 * @param {import("./types.js").Task} task
 * @returns {string}
 */
function fixedViolationCode(mode, task) {
  if (isLocked(task)) return "locked-task-driven";
  if (task.type === "need-by" && mode !== "off") return "need-by-late";
  return "link-violated";
}

class Scheduler {
  /** @param {ScheduleInput} input */
  constructor(input) {
    this.input = input;
    this.calendar = input.calendar;
    this.mode = input.mode ?? "propagate";
    this.pinned = new Set(input.pinned ?? []);
    this.threshold = input.criticalThreshold ?? 0;
    this.dataDateIndex = input.dataDate ? this.calendar.indexOf(toDay(input.dataDate)) : null;
    /** @type {Violation[]} */
    this.violations = [];
    /** @type {Map<string, Node>} */
    this.nodes = new Map();
    this.projectEarlyFinish = 0;
  }

  /** @returns {ScheduleResult} */
  run() {
    const { tasks, links } = this.input;
    const { hierarchy, summaries } = indexTree(tasks);
    const leaves = tasks.filter((task) => !summaries.has(task.id) && task.start);
    const edges = expandLinks(tasks, links, hierarchy).filter((edge) => edge.from !== edge.to);
    this.buildNodes(leaves, edges);
    const { order, blocked } = topologicalOrder(
      [...this.nodes.keys()],
      edges.filter((edge) => this.nodes.has(edge.from) && this.nodes.has(edge.to)),
    );
    if (blocked.length) throw new RangeError(`Dependency cycle through: ${blocked.join(", ")}`);
    for (const id of order) this.forward(this.nodes.get(id));
    this.projectEarlyFinish = this.latestEarlyFinish();
    const terminal = this.terminalIndex();
    for (let position = order.length - 1; position >= 0; position -= 1) {
      this.backward(this.nodes.get(order[position]), terminal);
    }
    return this.result(order);
  }

  /**
   * @param {import("./types.js").Task[]} leaves
   * @param {import("./graph.js").Edge[]} edges
   */
  buildNodes(leaves, edges) {
    for (const task of leaves) {
      const dates = resolveLeafDates(task, this.calendar);
      this.nodes.set(task.id, {
        task,
        dates,
        duration: dates.milestone ? 0 : Math.max(1, dates.duration),
        currentStart: 0,
        anchor: "start",
        incoming: [],
        outgoing: [],
        ES: 0,
        EF: 0,
        LS: 0,
        LF: 0,
      });
    }
    for (const edge of edges) {
      const from = this.nodes.get(edge.from);
      const to = this.nodes.get(edge.to);
      if (!from || !to) continue;
      from.outgoing.push(edge);
      to.incoming.push(edge);
    }
    for (const node of this.nodes.values()) {
      node.anchor = node.dates.milestone ? milestoneAnchor(node.incoming) : "start";
      node.currentStart = this.startIndex(node.dates.start, node.anchor);
    }
  }

  /**
   * @param {number} day
   * @param {"start"|"finish"} anchor
   * @returns {number}
   */
  startIndex(day, anchor) {
    return anchor === "finish" ? this.calendar.indexOf(day + 1) : this.calendar.indexOf(day);
  }

  /** @param {Node} node */
  logicStart(node) {
    let earliest = -Infinity;
    for (const edge of node.incoming) {
      const predecessor = this.nodes.get(edge.from);
      earliest = Math.max(earliest, requiredStart(edge, predecessor, node.duration));
    }
    return earliest;
  }

  /** @param {Node} node */
  forward(node) {
    const { task } = node;
    if (this.placeProgressed(node)) return;
    const logic = this.logicStart(node);
    const fixed = this.keepsStoredDates(node);
    if (fixed && logic > node.currentStart) {
      this.addViolation(
        fixedViolationCode(this.mode, task),
        task,
        node.incoming,
        "Predecessor logic requires a later start than the task has",
      );
    }
    let start = node.currentStart;
    if (!fixed) start = this.unfixedStart(node, logic);
    node.ES = start;
    node.EF = start + node.duration;
  }

  /**
   * Earliest start allowed by logic, SNET and the data date. A finish-anchored
   * milestone sits at the end of its date, so its index is one more than the
   * start-of-day index of the date it must not precede.
   * @param {Node} node
   * @param {number} logic
   * @returns {number}
   */
  unfixedStart(node, logic) {
    const { task } = node;
    const pointOffset = node.anchor === "finish" ? 1 : 0;
    const pullBack = this.mode === "tight" && node.incoming.length > 0 && !this.pinned.has(task.id);
    let start = pullBack ? logic : Math.max(node.currentStart, logic);
    if (task.constraint?.type === "SNET") {
      start = Math.max(start, this.calendar.indexOf(toDay(task.constraint.date)) + pointOffset);
    }
    if (this.dataDateIndex !== null) start = Math.max(start, this.dataDateIndex + pointOffset);
    return start;
  }

  /**
   * Places complete and in-progress tasks. Returns false for unstarted tasks.
   * @param {Node} node
   * @returns {boolean}
   */
  placeProgressed(node) {
    const { task } = node;
    if (!isStarted(task)) return false;
    const startDay = task.actualStart ? toDay(task.actualStart) : node.dates.start;
    node.ES = node.dates.milestone ? node.currentStart : this.calendar.indexOf(startDay);
    if (isComplete(task)) {
      const finishDay = task.actualFinish ? toDay(task.actualFinish) : node.dates.finish;
      node.EF = node.dates.milestone
        ? node.ES
        : Math.max(node.ES, this.calendar.indexOf(finishDay + 1));
      return true;
    }
    node.EF = node.ES + node.duration;
    const remaining = node.duration - Math.round(node.duration * (task.progress ?? 0));
    const remainingFloor = this.dataDateIndex === null ? -Infinity : this.dataDateIndex + remaining;
    if (this.mode !== "off" && !isLocked(task)) node.EF = Math.max(node.EF, remainingFloor);
    return true;
  }

  /** @returns {number} */
  latestEarlyFinish() {
    let latest = -Infinity;
    for (const node of this.nodes.values()) latest = Math.max(latest, node.EF);
    return latest;
  }

  /**
   * The backward pass starts from the contract completion date when set (so a
   * late programme shows negative float), otherwise from the project early finish.
   * @returns {number}
   */
  terminalIndex() {
    if (this.input.contractCompletion) {
      return this.calendar.indexOf(toDay(this.input.contractCompletion) + 1);
    }
    return this.projectEarlyFinish;
  }

  /**
   * @param {Node} node
   * @param {number} terminal
   */
  backward(node, terminal) {
    let lateFinish = terminal;
    for (const edge of node.outgoing) {
      const successor = this.nodes.get(edge.to);
      lateFinish = Math.min(lateFinish, allowedFinish(edge, successor, node.EF - node.ES));
    }
    const constraint = node.task.constraint;
    if (constraint?.type === "FNLT") {
      const limit = this.calendar.indexOf(toDay(constraint.date) + 1);
      lateFinish = Math.min(lateFinish, limit);
      if (node.EF > limit)
        this.addViolation(
          "constraint-breached",
          node.task,
          [],
          `Finishes after its FNLT date ${constraint.date}`,
        );
    }
    node.LF = lateFinish;
    node.LS = lateFinish - (node.EF - node.ES);
  }

  /**
   * Free float: the smallest slack to any successor's early dates, treating
   * the project early finish as an implicit successor of every task, so it is
   * never negative from logic alone and never exceeds total float.
   * @param {Node} node
   * @param {number} projectEarlyFinish
   * @returns {number}
   */
  freeFloat(node, projectEarlyFinish) {
    let slack = projectEarlyFinish - node.EF;
    for (const edge of node.outgoing) {
      slack = Math.min(slack, linkSlack(edge, node, this.nodes.get(edge.to)));
    }
    return slack;
  }

  /**
   * @param {string} code
   * @param {import("./types.js").Task} task
   * @param {import("./graph.js").Edge[]} edges
   * @param {string} message
   */
  addViolation(code, task, edges, message) {
    const linkId = edges.find((edge) => edge.linkId)?.linkId;
    this.violations.push({ code, taskId: task.id, ...(linkId ? { linkId } : {}), message });
  }

  /**
   * @param {Node} node
   * @returns {{start: number, finish: number}}
   */
  datesOf(node) {
    if (node.dates.milestone) {
      const day = this.milestoneDayAt(node, node.ES);
      return { start: day, finish: day };
    }
    return { start: this.calendar.dayAt(node.ES), finish: this.calendar.dayAt(node.EF - 1) };
  }

  /**
   * @param {Node} node
   * @returns {boolean}
   */
  keepsStoredDates(node) {
    const { task } = node;
    return this.mode === "off" || isLocked(task) || task.type === "need-by" || isComplete(task);
  }

  /**
   * @param {string[]} order
   * @returns {ScheduleResult}
   */
  result(order) {
    /** @type {Map<string, TaskSchedule>} */
    const schedules = new Map();
    const changed = [];
    const critical = [];
    let projectStart = Infinity;
    let projectFinish = -Infinity;
    for (const id of order) {
      const node = this.nodes.get(id);
      const kept = this.keepsStoredDates(node);
      const dates = kept
        ? { start: node.dates.start, finish: node.dates.finish }
        : this.datesOf(node);
      const duration = node.dates.milestone
        ? 0
        : this.calendar.workingDaysBetween(dates.start, dates.finish);
      const totalFloat = node.LS - node.ES;
      const isCritical = totalFloat <= this.threshold && !isComplete(node.task);
      if (isCritical) critical.push(id);
      schedules.set(id, {
        start: toISO(dates.start),
        finish: toISO(dates.finish),
        duration,
        earlyStart: toISO(this.startDayAt(node, node.ES)),
        earlyFinish: toISO(this.finishDayAt(node, node.EF)),
        lateStart: toISO(this.startDayAt(node, node.LS)),
        lateFinish: toISO(this.finishDayAt(node, node.LF)),
        totalFloat,
        freeFloat: this.freeFloat(node, this.projectEarlyFinish),
        critical: isCritical,
      });
      projectStart = Math.min(projectStart, dates.start);
      projectFinish = Math.max(projectFinish, dates.finish);
      this.collectChange(node, dates, duration, changed);
      this.checkDates(node, dates);
    }
    return {
      changed,
      tasks: schedules,
      critical,
      violations: this.violations,
      projectStart: Number.isFinite(projectStart) ? toISO(projectStart) : null,
      projectFinish: Number.isFinite(projectFinish) ? toISO(projectFinish) : null,
      terminalFloat: this.terminalFloat(projectFinish),
    };
  }

  /**
   * The day a milestone at working index `index` is shown on.
   * @param {Node} node
   * @param {number} index
   * @returns {number}
   */
  milestoneDayAt(node, index) {
    return node.anchor === "finish" ? this.calendar.dayAt(index - 1) : this.calendar.dayAt(index);
  }

  /**
   * @param {Node} node
   * @param {number} index start index
   * @returns {number}
   */
  startDayAt(node, index) {
    return node.dates.milestone ? this.milestoneDayAt(node, index) : this.calendar.dayAt(index);
  }

  /**
   * @param {Node} node
   * @param {number} index exclusive finish index
   * @returns {number}
   */
  finishDayAt(node, index) {
    return node.dates.milestone ? this.milestoneDayAt(node, index) : this.calendar.dayAt(index - 1);
  }

  /**
   * @param {number} projectFinish
   * @returns {number|null}
   */
  terminalFloat(projectFinish) {
    if (!this.input.contractCompletion || !Number.isFinite(projectFinish)) return null;
    const completion = toDay(this.input.contractCompletion);
    return this.calendar.indexOf(completion + 1) - this.calendar.indexOf(projectFinish + 1);
  }

  /**
   * @param {Node} node
   * @param {{start: number, finish: number}} dates
   * @param {number} duration
   * @param {ScheduleResult["changed"]} changed
   */
  collectChange(node, dates, duration, changed) {
    const { task } = node;
    const start = toISO(dates.start);
    const finish = toISO(dates.finish);
    const unchanged =
      task.start === start &&
      (task.finish ?? finish) === finish &&
      (task.duration ?? duration) === duration;
    if (unchanged) return;
    if (this.keepsStoredDates(node)) return;
    changed.push({ id: task.id, start, finish, duration });
  }

  /**
   * @param {Node} node
   * @param {{start: number, finish: number}} dates
   */
  checkDates(node, dates) {
    const { task } = node;
    const startsOff = !this.calendar.isWorkingDayNumber(dates.start);
    const finishesOff = !this.calendar.isWorkingDayNumber(dates.finish);
    if (startsOff || finishesOff) {
      this.addViolation("non-working-day", task, [], "Starts or finishes on a non-working day");
    }
    const notStarted = !isStarted(task) && !isLocked(task);
    if (
      this.mode === "off" &&
      notStarted &&
      this.dataDateIndex !== null &&
      node.ES - (node.anchor === "finish" ? 1 : 0) < this.dataDateIndex
    ) {
      this.addViolation(
        "before-data-date",
        task,
        [],
        "Unstarted work is scheduled before the data date",
      );
    }
    const overdueReference = this.input.dataDate ?? this.input.today ?? null;
    const isOverdueNeedBy =
      task.type === "need-by" &&
      !task.actualFinish &&
      overdueReference !== null &&
      toISO(dates.start) < overdueReference;
    if (isOverdueNeedBy) {
      this.addViolation(
        "need-by-overdue",
        task,
        [],
        `Needed by ${toISO(dates.start)} and not yet received`,
      );
    }
  }
}

/**
 * Runs the forward and backward passes and returns new dates, floats,
 * the critical path and violations. Pure: the input is not modified.
 * @param {ScheduleInput} input
 * @returns {ScheduleResult}
 */
export function schedule(input) {
  return new Scheduler(input).run();
}
