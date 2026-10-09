// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { checkProgramme } from "./engine/health.js";

export { checkProgramme, MAX_ACTIVITY_DAYS } from "./engine/health.js";

/**
 * Programme health check, `streamlined-gantt/health`: an optional entry so the
 * core bundle stays small.
 *
 * @example
 * import { check } from "streamlined-gantt/health";
 * for (const finding of check(gantt)) console.warn(finding.code, finding.taskId, finding.message);
 *
 * @module streamlined-gantt/health
 */

/**
 * Checks a programme against the SCL Protocol and CIOB guidance: open ends,
 * activities and lags over 28 days, hard constraints, negative float, links
 * to summaries, milestones with a duration and out-of-sequence progress.
 * @param {import("./model/controller.js").ProgrammeController} controller a `Gantt` or `ProgrammeController`
 * @returns {import("./engine/health.js").HealthFinding[]}
 */
export function check(controller) {
  return checkProgramme(controller.analysis, controller.store.data);
}
