// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { History } from "../../src/model/history.js";

const entry = (name, ...ids) => ({
  transactionId: name,
  label: name,
  cause: "api",
  records: ids.map((id) => ({ collection: "tasks", id, before: null, after: { id } })),
});

describe("History", () => {
  test("empty entries are not recorded and empty stacks return undefined", () => {
    const history = new History();
    history.push(entry("nothing"));
    expect(history.canUndo()).toBe(false);
    expect(history.takeUndo()).toBeUndefined();
    expect(history.takeRedo()).toBeUndefined();
    expect(history.canRedo()).toBe(false);
  });

  test("undo moves to redo and back; a new edit clears redo", () => {
    const history = new History();
    history.push(entry("one", "A"));
    history.push(entry("two", "B"));
    expect(history.takeUndo()?.label).toBe("two");
    expect(history.canRedo()).toBe(true);
    expect(history.takeRedo()?.label).toBe("two");
    history.takeUndo();
    history.push(entry("three", "C"));
    expect(history.canRedo()).toBe(false);
    expect(history.undoStack.map((item) => item.label)).toEqual(["one", "three"]);
  });

  test("the stack is capped, dropping the oldest entries", () => {
    const history = new History({ limit: 2 });
    for (const name of ["a", "b", "c"]) history.push(entry(name, name));
    expect(history.undoStack.map((item) => item.label)).toEqual(["b", "c"]);
  });

  test("protect drops the newest entry touching a patched entity and everything older (ADR-0006)", () => {
    const history = new History();
    history.push(entry("one", "A"));
    history.push(entry("two", "B"));
    history.push(entry("three", "C"));
    history.takeUndo();
    history.protect([
      { collection: "tasks", id: "A", before: null, after: null },
      ...entry("x", "B").records,
    ]);
    expect(history.undoStack).toEqual([]);
    expect(history.canRedo()).toBe(false);
  });

  test("protect keeps entries that touch only other entities, and ignores an empty patch", () => {
    const history = new History();
    history.push(entry("one", "A"));
    history.push(entry("two", "B"));
    history.protect([]);
    expect(history.undoStack).toHaveLength(2);
    history.protect(entry("x", "A").records);
    expect(history.undoStack.map((item) => item.label)).toEqual(["two"]);
    history.protect(entry("x", "Z").records);
    expect(history.undoStack.map((item) => item.label)).toEqual(["two"]);
    history.clear();
    expect(history.canUndo()).toBe(false);
  });
});
