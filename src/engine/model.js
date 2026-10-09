// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Calendar } from "./calendar.js";
import { toDay, toISO } from "./dates.js";
import { buildHierarchy, hasChildren } from "./graph.js";

/**
 * Helpers that interpret stored task objects: milestone and summary rules,
 * resolving a task's full start/finish/duration from whatever subset was
 * stored, and choosing the scheduling calendar.
 *
 * @module engine/model
 */

/** Task types drawn as zero-duration points. */
export const MILESTONE_TYPES = new Set(["milestone", "payment", "access", "need-by"]);

/**
 * @param {{type?: string, duration?: number}} task
 * @returns {boolean}
 */
export function isMilestone(task) {
  if (task.type === "summary") return false;
  return MILESTONE_TYPES.has(task.type) || task.duration === 0;
}

/**
 * Locked tasks keep their dates: the scheduler never moves them and the UI
 * refuses to drag them. Reference tasks (another party's programme) are always locked.
 * @param {{type?: string, locked?: boolean}} task
 * @returns {boolean}
 */
export function isLocked(task) {
  return task.locked === true || task.type === "reference";
}

/**
 * @param {{progress?: number, actualFinish?: string|null}} task
 * @returns {boolean}
 */
export function isComplete(task) {
  return (task.progress ?? 0) >= 1 || Boolean(task.actualFinish);
}

/**
 * @param {{progress?: number, actualStart?: string|null, actualFinish?: string|null}} task
 * @returns {boolean}
 */
export function isStarted(task) {
  return (task.progress ?? 0) > 0 || Boolean(task.actualStart) || Boolean(task.actualFinish);
}

/**
 * The calendar used for scheduling. Version 1 schedules every task on the
 * programme's default calendar; per-task calendars are planned for v2.
 * @param {import("./types.js").Programme} programme
 * @returns {Calendar}
 */
export function schedulingCalendar(programme) {
  const calendars = programme.calendars ?? [];
  const chosen =
    calendars.find((calendar) => calendar.id === programme.defaultCalendar) ?? calendars[0];
  return new Calendar(chosen ?? { id: "default" });
}

/**
 * @typedef {object} ResolvedDates
 * @property {number} start day number of the first working day (milestone: its date)
 * @property {number} finish day number of the last working day, inclusive (milestone: its date)
 * @property {number} duration working days (0 for milestones)
 * @property {boolean} milestone
 */

/**
 * Resolves a leaf task's full date triple from the stored subset.
 * `finish` wins over `duration` when both are stored.
 * @param {import("./types.js").Task} task
 * @param {Calendar} calendar
 * @returns {ResolvedDates}
 */
export function resolveLeafDates(task, calendar) {
  const start = toDay(task.start);
  if (isMilestone(task)) return { start, finish: start, duration: 0, milestone: true };
  if (task.finish) {
    const finish = toDay(task.finish);
    return {
      start,
      finish,
      duration: calendar.workingDaysBetween(start, finish),
      milestone: false,
    };
  }
  const duration = Math.max(1, task.duration ?? 1);
  const first = calendar.nextWorkingDay(start);
  return {
    start,
    finish: calendar.addWorkingDays(first, duration - 1),
    duration,
    milestone: false,
  };
}

/**
 * Computes the stored date fields for a leaf task after an edit.
 *
 * Rules, in order: a milestone keeps `start = finish` and `duration = 0`;
 * when both `start` and `finish` are given, `duration` is derived; when
 * `duration` is given, `finish` is derived from `start`; otherwise the
 * previous duration is kept and `finish` follows `start` (a move).
 *
 * @param {import("./types.js").Task} task the task before the edit
 * @param {{start?: string, finish?: string, duration?: number}} patch
 * @param {Calendar} calendar
 * @returns {{start: string, finish: string, duration: number}}
 */
export function normaliseDatePatch(task, patch, calendar) {
  const previous = resolveLeafDates(task, calendar);
  const merged = { ...task, ...patch };
  const startDay = patch.start ? toDay(patch.start) : previous.start;
  if (isMilestone(merged)) {
    const day = patch.finish && !patch.start ? toDay(patch.finish) : startDay;
    return { start: toISO(day), finish: toISO(day), duration: 0 };
  }
  if (patch.finish && patch.duration === undefined) {
    const finishDay = Math.max(toDay(patch.finish), startDay);
    const duration = Math.max(1, calendar.workingDaysBetween(startDay, finishDay));
    return { start: toISO(startDay), finish: toISO(finishDay), duration };
  }
  const duration = Math.max(1, patch.duration ?? previous.duration);
  const first = calendar.nextWorkingDay(startDay);
  const finish = calendar.addWorkingDays(first, duration - 1);
  return { start: toISO(first), finish: toISO(finish), duration };
}

/**
 * @typedef {object} TreeIndex
 * @property {import("./graph.js").Hierarchy} hierarchy
 * @property {Set<string>} summaries ids of tasks that have children or are typed "summary"
 */

/**
 * @param {import("./types.js").Task[]} tasks
 * @returns {TreeIndex}
 */
export function indexTree(tasks) {
  const hierarchy = buildHierarchy(tasks);
  const summaries = new Set(
    tasks
      .filter((task) => task.type === "summary" || hasChildren(task.id, hierarchy))
      .map((task) => task.id),
  );
  return { hierarchy, summaries };
}
