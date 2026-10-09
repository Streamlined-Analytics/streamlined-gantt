// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "./dates.js";
import { leavesOf } from "./graph.js";
import {
  indexTree,
  isComplete,
  isMilestone,
  resolveLeafDates,
  schedulingCalendar,
} from "./model.js";
import { schedule } from "./scheduler.js";
import { FieldRegistry } from "./fields.js";

/**
 * Derived, read-only state computed from stored programme data after each
 * transaction: resolved dates for every task (summaries rolled up), row order
 * and depth, float and critical path (without moving anything), violations,
 * and custom-field roll-ups for summary rows.
 *
 * @module engine/analysis
 */

/**
 * @typedef {object} ResolvedTask
 * @property {number} start day number
 * @property {number} finish day number, inclusive
 * @property {number} duration working days
 * @property {boolean} milestone
 * @property {boolean} summary
 * @property {number} progress 0..1 (duration-weighted for summaries)
 */

/**
 * @typedef {object} Analysis
 * @property {import("./calendar.js").Calendar} calendar
 * @property {import("./model.js").TreeIndex} tree
 * @property {Map<string, import("./types.js").Task>} taskById
 * @property {Map<string, ResolvedTask>} resolved
 * @property {string[]} order every task id, depth-first in data order
 * @property {Map<string, number>} depth 1 for roots
 * @property {import("./scheduler.js").ScheduleResult} schedule
 * @property {Map<string, Record<string, unknown>>} fieldValues stored + computed values; roll-ups for summaries
 * @property {FieldRegistry} fields
 */

/**
 * @param {import("./model.js").TreeIndex} tree
 * @returns {{order: string[], depth: Map<string, number>}}
 */
function depthFirst(tree) {
  const order = [];
  const depth = new Map();
  /** @type {[string, number][]} */
  const stack = [...(tree.hierarchy.childrenOf.get(null) ?? [])].reverse().map((id) => [id, 1]);
  while (stack.length) {
    const [id, level] = stack.pop();
    order.push(id);
    depth.set(id, level);
    const children = tree.hierarchy.childrenOf.get(id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push([children[index], level + 1]);
    }
  }
  return { order, depth };
}

/**
 * @param {import("./types.js").Task[]} leaves
 * @param {Map<string, ResolvedTask>} resolved
 * @returns {number}
 */
export function weightedProgress(leaves, resolved) {
  let weight = 0;
  let done = 0;
  for (const task of leaves) {
    const duration = resolved.get(task.id)?.duration ?? 0;
    weight += duration;
    done += duration * progressOf(task);
  }
  if (weight > 0) return done / weight;
  if (leaves.length === 0) return 0;
  return leaves.reduce((sum, task) => sum + progressOf(task), 0) / leaves.length;
}

/**
 * A task's progress as the scheduler sees it: complete (1) when it has an
 * actual finish or 100%, else its stored fraction.
 * @param {import("./types.js").Task} task
 * @returns {number}
 */
export function progressOf(task) {
  return isComplete(task) ? 1 : Math.min(Math.max(task.progress ?? 0, 0), 1);
}

/**
 * @param {import("./types.js").Programme} programme
 * @param {object} [options]
 * @param {FieldRegistry} [options.fields]
 * @param {number} [options.criticalThreshold]
 * @param {string|null} [options.today]
 * @returns {Analysis}
 */
export function analyse(programme, options = {}) {
  const tasks = programme.tasks;
  const calendar = schedulingCalendar(programme);
  const fields = options.fields ?? new FieldRegistry();
  const tree = indexTree(tasks);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  /** @type {Map<string, ResolvedTask>} */
  const resolved = new Map();
  for (const task of tasks) {
    if (tree.summaries.has(task.id) || !task.start) continue;
    const dates = resolveLeafDates(task, calendar);
    resolved.set(task.id, { ...dates, summary: false, progress: task.progress ?? 0 });
  }
  const { order, depth } = depthFirst(tree);
  const fieldValues = new Map();
  for (const task of tasks) {
    if (!tree.summaries.has(task.id)) fieldValues.set(task.id, fields.valuesOf(task));
  }
  for (let position = order.length - 1; position >= 0; position -= 1) {
    const id = order[position];
    if (!tree.summaries.has(id)) continue;
    rollUpSummary(id, { tree, taskById, resolved, calendar, fields, fieldValues });
  }
  const scheduleResult = schedule({
    tasks,
    links: programme.links ?? [],
    calendar,
    dataDate: programme.dataDate ?? null,
    contractCompletion: programme.contractCompletion ?? null,
    mode: "off",
    criticalThreshold: options.criticalThreshold,
    today: options.today ?? null,
  });
  return {
    calendar,
    tree,
    taskById,
    resolved,
    order,
    depth,
    schedule: scheduleResult,
    fieldValues,
    fields,
  };
}

/**
 * @param {string} id
 * @param {{tree: import("./model.js").TreeIndex, taskById: Map<string, any>, resolved: Map<string, ResolvedTask>, calendar: import("./calendar.js").Calendar, fields: FieldRegistry, fieldValues: Map<string, Record<string, unknown>>}} context
 */
function rollUpSummary(id, context) {
  const { tree, taskById, resolved, calendar, fields, fieldValues } = context;
  const leafTasks = leavesOf(id, tree.hierarchy)
    .filter((leafId) => leafId !== id && resolved.has(leafId))
    .map((leafId) => taskById.get(leafId));
  const summaryTask = taskById.get(id);
  if (leafTasks.length === 0) {
    if (summaryTask.start) {
      const start = toDay(summaryTask.start);
      const finish = summaryTask.finish ? toDay(summaryTask.finish) : start;
      resolved.set(id, {
        start,
        finish,
        duration: calendar.workingDaysBetween(start, finish),
        milestone: false,
        summary: true,
        progress: summaryTask.progress ?? 0,
      });
    }
    fieldValues.set(id, {});
    return;
  }
  let start = Infinity;
  let finish = -Infinity;
  for (const leaf of leafTasks) {
    const dates = resolved.get(leaf.id);
    start = Math.min(start, dates.start);
    finish = Math.max(finish, dates.finish);
  }
  const duration = calendar.workingDaysBetween(start, finish);
  resolved.set(id, {
    start,
    finish,
    duration,
    milestone: false,
    summary: true,
    progress: weightedProgress(leafTasks, resolved),
  });
  const rows = leafTasks.map((leaf) => ({
    task: leaf,
    values: fieldValues.get(leaf.id) ?? {},
    duration: resolved.get(leaf.id).duration,
  }));
  const sums = fields.sums(rows.map((row) => row.values));
  /** @type {Record<string, unknown>} */
  const rolled = {};
  for (const definition of fields.list()) {
    const value = fields.rollup(definition, rows, sums);
    if (value !== null) rolled[definition.key] = value;
  }
  fieldValues.set(id, rolled);
}

/**
 * Leaf tasks with dates, in row order.
 * @param {Analysis} analysis
 * @returns {import("./types.js").Task[]}
 */
export function leafTasks(analysis) {
  return analysis.order
    .filter((id) => !analysis.tree.summaries.has(id) && analysis.resolved.has(id))
    .map((id) => analysis.taskById.get(id));
}

export { isMilestone };
