// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Naive CPM oracle in working-index space (EF exclusive), after the research
 * reference script. Early starts are floored at 0; free float is the smallest
 * slack to successors' early dates and to the project early finish.
 *
 * @param {Record<string, number>} durations
 * @param {{from: string, to: string, type: string, lag?: number}[]} links
 * @param {number} [deadline] exclusive working index of the contract completion
 */
export function oracleCpm(durations, links, deadline) {
  const ids = Object.keys(durations);
  const predecessors = Object.fromEntries(ids.map((id) => [id, []]));
  const successors = Object.fromEntries(ids.map((id) => [id, []]));
  for (const link of links) {
    predecessors[link.to].push(link);
    successors[link.from].push(link);
  }
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    predecessors[id].forEach((link) => visit(link.from));
    order.push(id);
  };
  ids.forEach(visit);
  const ES = {};
  const EF = {};
  const requiredStart = (link) => {
    const lag = link.lag ?? 0;
    const d = durations[link.to];
    return {
      FS: EF[link.from] + lag,
      SS: ES[link.from] + lag,
      FF: EF[link.from] + lag - d,
      SF: ES[link.from] + lag - d,
    }[link.type];
  };
  for (const id of order) {
    ES[id] = Math.max(0, ...predecessors[id].map(requiredStart));
    EF[id] = ES[id] + durations[id];
  }
  const projectFinish = Math.max(...ids.map((id) => EF[id]));
  const end = deadline ?? projectFinish;
  const LS = {};
  const LF = {};
  const allowedFinish = (link) => {
    const lag = link.lag ?? 0;
    const d = durations[link.from];
    return {
      FS: LS[link.to] - lag,
      SS: LS[link.to] - lag + d,
      FF: LF[link.to] - lag,
      SF: LF[link.to] - lag + d,
    }[link.type];
  };
  for (const id of [...order].reverse()) {
    LF[id] = Math.min(end, ...successors[id].map(allowedFinish));
    LS[id] = LF[id] - durations[id];
  }
  const result = {};
  for (const id of ids) {
    const freeFloat = Math.min(
      projectFinish - EF[id],
      ...successors[id].map((link) => ES[link.to] - requiredStart(link)),
    );
    result[id] = {
      ES: ES[id],
      EF: EF[id],
      LS: LS[id],
      LF: LF[id],
      TF: LS[id] - ES[id],
      FF: freeFloat,
    };
  }
  return { projectFinish, tasks: result };
}
