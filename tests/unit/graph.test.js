// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  buildHierarchy,
  expandLinks,
  findCycle,
  wouldCreateCycle,
} from "../../src/engine/index.js";
import { ancestorsOf, leavesOf, topologicalOrder } from "../../src/engine/graph.js";

const tasks = [
  { id: "s", name: "S" },
  { id: "a", name: "a", parent: "s" },
  { id: "s2", name: "S2", parent: "s" },
  { id: "b", name: "b", parent: "s2" },
  { id: "c", name: "c" },
  { id: "orphan", name: "o", parent: "missing" },
];

describe("hierarchy", () => {
  const hierarchy = buildHierarchy(tasks);

  test("children in data order; unknown parents become roots", () => {
    expect(hierarchy.childrenOf.get(null)).toEqual(["s", "c", "orphan"]);
    expect(hierarchy.childrenOf.get("s")).toEqual(["a", "s2"]);
    expect(hierarchy.parentOf.get("orphan")).toBeNull();
  });

  test("leaves and ancestors", () => {
    expect(leavesOf("s", hierarchy)).toEqual(["a", "b"]);
    expect(leavesOf("c", hierarchy)).toEqual(["c"]);
    expect(ancestorsOf("b", hierarchy)).toEqual(["s2", "s"]);
    expect(ancestorsOf("c", hierarchy)).toEqual([]);
  });
});

describe("links and cycles", () => {
  test("summary links expand to leaf edges with defaults", () => {
    expect(expandLinks(tasks, [{ id: "l", from: "s", to: "c" }])).toEqual([
      { linkId: "l", from: "a", to: "c", type: "FS", lag: 0 },
      { linkId: "l", from: "b", to: "c", type: "FS", lag: 0 },
    ]);
  });

  test("SS/SF links leave a summary from its earliest leaf; FF/SF links enter its latest-finishing leaf", () => {
    const dated = [
      { id: "S", name: "S" },
      { id: "early", name: "e", parent: "S", start: "2026-11-02", finish: "2026-11-03" },
      { id: "late", name: "l", parent: "S", start: "2026-11-09", finish: "2026-11-20" },
      { id: "x", name: "x", start: "2026-11-02", finish: "2026-11-02" },
    ];
    expect(
      expandLinks(dated, [{ id: "1", from: "S", to: "x", type: "SS" }]).map((edge) => edge.from),
    ).toEqual(["early"]);
    expect(
      expandLinks(dated, [{ id: "1", from: "S", to: "x", type: "FS" }]).map((edge) => edge.from),
    ).toEqual(["early", "late"]);
    expect(
      expandLinks(dated, [{ id: "1", from: "x", to: "S", type: "FF" }]).map((edge) => edge.to),
    ).toEqual(["late"]);
    expect(
      expandLinks(dated, [{ id: "1", from: "x", to: "S", type: "SS" }]).map((edge) => edge.to),
    ).toEqual(["early", "late"]);
  });

  test("topological order ignores edges to unknown nodes", () => {
    const { order, blocked } = topologicalOrder(
      ["x", "y"],
      [
        { linkId: "1", from: "x", to: "zz", type: "FS", lag: 0 },
        { linkId: "2", from: "x", to: "y", type: "FS", lag: 0 },
      ],
    );
    expect(order).toEqual(["x", "y"]);
    expect(blocked).toEqual([]);
  });

  test("finds cycles, including a summary linked to its own child", () => {
    expect(findCycle(tasks, [{ id: "l", from: "c", to: "a" }])).toBeNull();
    expect(findCycle(tasks, [{ id: "l", from: "s", to: "a" }])).toEqual(["a", "a"]);
    expect(wouldCreateCycle(tasks, [{ id: "1", from: "a", to: "c" }], { from: "c", to: "s" })).toBe(
      true,
    );
    expect(wouldCreateCycle(tasks, [{ id: "1", from: "a", to: "c" }], { from: "b", to: "c" })).toBe(
      false,
    );
  });
});
