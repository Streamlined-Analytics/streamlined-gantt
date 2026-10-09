// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { MILESTONE_TYPES, isComplete, isLocked, isStarted } from "./model.js";
import { leafTasks } from "./analysis.js";
import { ancestorsOf, leavesOf } from "./graph.js";

/**
 * Programme health check, after the SCL Delay and Disruption Protocol
 * (B1.43-1.46) and the CIOB time-management QA checklist: logic, not fixed
 * dates; no activity or lag longer than 28 days; no hard constraints; no
 * negative float; no logic on summaries; progress in sequence.
 *
 * @module engine/health
 */

/**
 * @typedef {object} HealthFinding
 * @property {string} code
 * @property {"error"|"warning"|"info"} severity
 * @property {string} [taskId]
 * @property {string} [linkId]
 * @property {string} message
 */

export const MAX_ACTIVITY_DAYS = 28;

/**
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Programme} programme
 * @param {{maxDuration?: number}} [options]
 * @returns {HealthFinding[]}
 */
export function checkProgramme(analysis, programme, options = {}) {
  const maxDuration = options.maxDuration ?? MAX_ACTIVITY_DAYS;
  const links = programme.links ?? [];
  const leaves = leafTasks(analysis);
  const context = {
    analysis,
    maxDuration,
    hasPredecessor: new Set(links.map((link) => link.to)),
    hasSuccessor: new Set(links.map((link) => link.from)),
    startDay: Math.min(...leaves.map((task) => analysis.resolved.get(task.id).start)),
    finishDay: Math.max(...leaves.map((task) => analysis.resolved.get(task.id).finish)),
  };
  /** @type {HealthFinding[]} */
  const findings = [];
  for (const task of leaves)
    findings.push(...logicFindings(task, context), ...taskFindings(task, context));
  for (const link of links) findings.push(...linkFindings(link, context));
  for (const violation of analysis.schedule.violations) {
    findings.push({
      code: violation.code,
      severity: "warning",
      taskId: violation.taskId,
      ...(violation.linkId ? { linkId: violation.linkId } : {}),
      message: violation.message,
    });
  }
  return findings;
}

/**
 * @typedef {object} HealthContext
 * @property {import("./analysis.js").Analysis} analysis
 * @property {number} maxDuration
 * @property {Set<string>} hasPredecessor
 * @property {Set<string>} hasSuccessor
 * @property {number} startDay
 * @property {number} finishDay
 */

/**
 * A task counts as linked when it, or a summary above it, carries the link.
 * @param {string} id
 * @param {Set<string>} linked
 * @param {HealthContext} context
 * @returns {boolean}
 */
function isLinkedViaSelfOrAncestor(id, linked, context) {
  return [id, ...ancestorsOf(id, context.analysis.tree.hierarchy)].some((candidate) =>
    linked.has(candidate),
  );
}

/**
 * Open starts and open ends. The first and last activities, and externally
 * fixed (locked/reference) tasks, are exempt from the open-start rule.
 * @param {import("./types.js").Task} task
 * @param {HealthContext} context
 * @returns {HealthFinding[]}
 */
function logicFindings(task, context) {
  const dates = context.analysis.resolved.get(task.id);
  const findings = [];
  const isOpenStart =
    !isLocked(task) &&
    dates.start !== context.startDay &&
    !isLinkedViaSelfOrAncestor(task.id, context.hasPredecessor, context);
  if (isOpenStart)
    findings.push(finding("open-start", "warning", task, "Has no predecessor (open start)"));
  const isOpenEnd =
    dates.finish !== context.finishDay &&
    !isLinkedViaSelfOrAncestor(task.id, context.hasSuccessor, context);
  if (isOpenEnd) findings.push(finding("open-end", "warning", task, "Has no successor (open end)"));
  return findings;
}

/**
 * @param {import("./types.js").Task} task
 * @param {HealthContext} context
 * @returns {HealthFinding[]}
 */
function taskFindings(task, context) {
  const { analysis, maxDuration } = context;
  const dates = analysis.resolved.get(task.id);
  const findings = [];
  if (!dates.milestone && dates.duration > maxDuration) {
    findings.push(
      finding(
        "long-duration",
        "warning",
        task,
        `Lasts ${dates.duration} working days (more than ${maxDuration})`,
      ),
    );
  }
  if (task.constraint?.type === "FNLT") {
    findings.push(
      finding(
        "hard-constraint",
        "info",
        task,
        `Has a hard constraint: finish no later than ${task.constraint.date}`,
      ),
    );
  }
  if (MILESTONE_TYPES.has(task.type) && (task.duration ?? 0) > 0) {
    findings.push(finding("milestone-duration", "error", task, "Milestone has a duration"));
  }
  const totalFloat = analysis.schedule.tasks.get(task.id)?.totalFloat ?? 0;
  if (totalFloat < 0) {
    findings.push(
      finding("negative-float", "error", task, `Negative float of ${totalFloat} working days`),
    );
  }
  return findings;
}

/**
 * @param {import("./types.js").Link} link
 * @param {HealthContext} context
 * @returns {HealthFinding[]}
 */
function linkFindings(link, context) {
  /** @type {HealthFinding[]} */
  const findings = [];
  if (Math.abs(link.lag ?? 0) > context.maxDuration) {
    findings.push({
      code: "long-lag",
      severity: "warning",
      linkId: link.id,
      message: `Lag of ${link.lag} working days (more than ${context.maxDuration})`,
    });
  }
  const summaries = context.analysis.tree.summaries;
  if (summaries.has(link.from) || summaries.has(link.to)) {
    findings.push({
      code: "summary-link",
      severity: "warning",
      linkId: link.id,
      message: "Logic is attached to a summary task",
    });
  }
  findings.push(...outOfSequence(context.analysis, link));
  return findings;
}

/**
 * @param {string} code
 * @param {HealthFinding["severity"]} severity
 * @param {{id: string}} task
 * @param {string} message
 * @returns {HealthFinding}
 */
function finding(code, severity, task, message) {
  return { code, severity, taskId: task.id, message };
}

/**
 * A successor has started although its finish-to-start predecessor is not
 * complete. For summaries, progress rolls up from their leaves: a summary has
 * started when any leaf has, and is complete when every leaf is.
 * @param {import("./analysis.js").Analysis} analysis
 * @param {import("./types.js").Link} link
 * @returns {HealthFinding[]}
 */
function outOfSequence(analysis, link) {
  /** @type {HealthFinding["severity"]} */
  const severity = "warning";
  if ((link.type ?? "FS") !== "FS") return [];
  const predecessor = analysis.taskById.get(link.from);
  const successor = analysis.taskById.get(link.to);
  if (!successor || !predecessor) return [];
  const leaves = (id) =>
    leavesOf(id, analysis.tree.hierarchy)
      .map((leaf) => analysis.taskById.get(leaf))
      .filter(Boolean);
  const startedTooEarly =
    leaves(successor.id).some(isStarted) && !leaves(predecessor.id).every(isComplete);
  if (!startedTooEarly) return [];
  return [
    {
      code: "out-of-sequence",
      severity,
      taskId: successor.id,
      linkId: link.id,
      message: `Started before predecessor "${predecessor.name}" finished`,
    },
  ];
}
