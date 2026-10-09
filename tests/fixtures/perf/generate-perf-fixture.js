// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Deterministic large programme for performance and virtualisation tests:
 * 50 phases of 19 tasks (1,000 tasks including the phase summaries) and
 * 1,500 links (an FS chain inside each phase plus seeded cross-links that
 * always point forward, so the network is acyclic). Same output every run.
 */

/** @param {number} seed */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * @param {{phases?: number, perPhase?: number, links?: number, seed?: number}} [options]
 */
export function generatePerfProgramme(options = {}) {
  const phases = options.phases ?? 50;
  const perPhase = options.perPhase ?? 19;
  const linkTarget = options.links ?? 1500;
  const next = random(options.seed ?? 20261109);
  const tasks = [];
  const leaves = [];
  const links = [];
  for (let phase = 0; phase < phases; phase += 1) {
    const summaryId = `p${phase}`;
    tasks.push({
      id: summaryId,
      wbs: String(phase + 1),
      name: `Phase ${phase + 1}`,
      type: "summary",
    });
    for (let index = 0; index < perPhase; index += 1) {
      const id = `p${phase}t${index}`;
      const milestone = index === perPhase - 1;
      const duration = milestone ? 0 : 1 + Math.floor(next() * 8);
      tasks.push({
        id,
        parent: summaryId,
        wbs: `${phase + 1}.${index + 1}`,
        name: milestone ? `Phase ${phase + 1} complete` : `Activity ${phase + 1}.${index + 1}`,
        ...(milestone ? { type: "milestone" } : {}),
        start: "2027-01-04",
        duration,
        fields: { cost: Math.floor(next() * 500000), charge: Math.floor(next() * 700000) },
      });
      leaves.push(id);
      if (index > 0)
        links.push({
          id: `l${links.length}`,
          from: `p${phase}t${index - 1}`,
          to: id,
          type: "FS",
          lag: 0,
        });
    }
  }
  const seen = new Set(links.map((link) => `${link.from}>${link.to}`));
  const types = ["FS", "FS", "FS", "SS", "FF"];
  while (links.length < linkTarget) {
    const from = Math.floor(next() * (leaves.length - 1));
    const to = from + 1 + Math.floor(next() * Math.min(60, leaves.length - from - 1));
    const key = `${leaves[from]}>${leaves[to]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      id: `l${links.length}`,
      from: leaves[from],
      to: leaves[to],
      type: types[Math.floor(next() * types.length)],
      lag: Math.floor(next() * 3),
    });
  }
  return {
    schema: "streamlined-gantt/1",
    name: "Performance fixture: 1,000 tasks, 1,500 links",
    defaultCalendar: "std",
    calendars: [{ id: "std", name: "Mon-Fri", workWeek: [1, 2, 3, 4, 5] }],
    tasks,
    links,
  };
}
