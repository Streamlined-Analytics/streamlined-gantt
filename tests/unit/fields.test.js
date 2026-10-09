// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { FieldRegistry } from "../../src/engine/index.js";
import { typeProblem, isNumericField } from "../../src/engine/fields.js";
import { FLAT_ROOF_FIELDS } from "../support/fields.js";
import { lazy } from "../support/lazy.js";

const registry = lazy(() => new FieldRegistry(FLAT_ROOF_FIELDS));

describe("field definitions", () => {
  test("defaults the type to text and exposes lookups", () => {
    const plain = new FieldRegistry([{ key: "note" }]);
    expect(plain.get("note").type).toBe("text");
    expect(plain.list()).toHaveLength(1);
    expect(registry.computed().map((field) => field.key)).toEqual(["profit", "margin"]);
    expect(registry.isEditable("cost")).toBe(true);
    expect(registry.isEditable("margin")).toBe(false);
    expect(registry.isEditable("nope")).toBe(false);
    expect(new FieldRegistry().list()).toEqual([]);
  });

  test("numeric field detection", () => {
    expect(isNumericField({ key: "a", type: "currency" })).toBe(true);
    expect(isNumericField({ key: "a" })).toBe(false);
  });
});

describe("values and computed fields", () => {
  const task = { id: "t", fields: { cost: 60000, charge: 100000 } };

  test("computed values are derived, never stored", () => {
    expect(registry.valueOf(task, "margin")).toBeCloseTo(0.4);
    expect(registry.valueOf(task, "cost")).toBe(60000);
    expect(registry.valuesOf(task)).toEqual({
      cost: 60000,
      charge: 100000,
      profit: 40000,
      margin: 0.4,
    });
    expect(task.fields).toEqual({ cost: 60000, charge: 100000 });
  });

  test("a computed value that is not finite becomes null", () => {
    const odd = new FieldRegistry([
      { key: "ratio", type: "number", compute: (t) => t.fields.a / t.fields.b },
      { key: "nothing", compute: () => undefined },
    ]);
    expect(odd.valueOf({ fields: { a: 1, b: 0 } }, "ratio")).toBeNull();
    expect(odd.valueOf({}, "nothing")).toBeNull();
    expect(odd.valueOf({}, "missing")).toBeUndefined();
  });
});

describe("validation layers", () => {
  test.each([
    ["currency", 12.5, "must be a whole number"],
    ["integer", "3", "must be a whole number"],
    ["number", "3", "must be a number"],
    ["percent", Number.NaN, "must be a number"],
    ["date", "2026-02-30", "must be a date (YYYY-MM-DD)"],
    ["boolean", "true", "must be true or false"],
    ["text", 5, "must be text"],
  ])("%s rejects %j", (type, value, message) => {
    expect(typeProblem({ key: "f", type }, value)).toBe(message);
  });

  test("empty values pass the type check", () => {
    expect(typeProblem({ key: "f", type: "currency" }, null)).toBeNull();
    expect(typeProblem({ key: "f", type: "currency" }, "")).toBeNull();
  });

  test("select accepts plain and labelled options", () => {
    expect(typeProblem({ key: "s", type: "select", options: ["Sub"] }, "Sub")).toBeNull();
    expect(
      typeProblem(
        { key: "s", type: "select", options: [{ value: "own", label: "Own labour" }] },
        "own",
      ),
    ).toBeNull();
    expect(typeProblem({ key: "s", type: "select", options: ["Sub"] }, "Hire")).toBe(
      "is not one of the options",
    );
    expect(typeProblem({ key: "s", type: "select" }, "Hire")).toBe("is not one of the options");
  });

  test("declarative rules: required, min, max, step, pattern", () => {
    const rules = new FieldRegistry([
      { key: "qty", label: "Qty", type: "number", required: true, min: 0, max: 100, step: 0.5 },
      { key: "ref", label: "PO", type: "text", pattern: "^PO-\\d+$" },
    ]);
    expect(rules.validate("qty", null, {})).toBe("Qty is required");
    expect(rules.validate("qty", -1, {})).toBe("Qty must be at least 0");
    expect(rules.validate("qty", 101, {})).toBe("Qty must be at most 100");
    expect(rules.validate("qty", 1.25, {})).toBe("Qty must be a multiple of 0.5");
    expect(rules.validate("qty", 1.5, {})).toBeNull();
    expect(rules.validate("ref", "PO-12", {})).toBeNull();
    expect(rules.validate("ref", "12", {})).toBe("PO is not in the expected format");
    expect(rules.validate("unknown", "anything", {})).toBeNull();
  });

  test("validate() hooks run after the declarative rules and receive the task", () => {
    const hooked = new FieldRegistry([
      {
        key: "charge",
        type: "currency",
        validate: (value, task) => (value < task.fields.cost ? "Charge is below cost" : null),
      },
    ]);
    expect(hooked.validate("charge", 50, { fields: { cost: 100 } })).toBe("Charge is below cost");
    expect(hooked.validate("charge", 150, { fields: { cost: 100 } })).toBeNull();
    expect(hooked.validate("charge", 1.5, { fields: { cost: 100 } })).toBe(
      "charge must be a whole number",
    );
  });

  test("stored values are type-checked on load; unknown keys are ignored", () => {
    const problems = [];
    registry.checkStored(
      { fields: { cost: "lots", margin: "ignored", unknown: 1 } },
      "/tasks/0/fields",
      { add: (path, message) => problems.push({ path, message }) },
    );
    expect(problems).toEqual([{ path: "/tasks/0/fields.cost", message: "must be a whole number" }]);
    registry.checkStored({}, "/x", { add: () => problems.push("unexpected") });
    expect(problems).toHaveLength(1);
  });
});

describe("roll-ups", () => {
  const rows = [
    { task: { id: "a" }, values: { cost: 100, charge: 150, qty: 2 }, duration: 1 },
    { task: { id: "b" }, values: { cost: 300, charge: 350, qty: 6 }, duration: 3 },
  ];
  const sums = lazy(() => registry.sums(rows.map((row) => row.values)));

  test("sums cover every stored numeric field", () => {
    expect(sums).toEqual({ cost: 400, charge: 500, qty: 8 });
  });

  test.each([
    ["sum", 8],
    ["min", 2],
    ["max", 6],
    ["avg", 4],
    ["weighted", 5],
  ])("%s", (rule, expected) => {
    expect(registry.rollup({ key: "qty", type: "number", rollup: rule }, rows, sums)).toBe(
      expected,
    );
  });

  test("weighted falls back to the mean when every duration is zero", () => {
    const zero = rows.map((row) => ({ ...row, duration: 0 }));
    expect(registry.rollup({ key: "qty", type: "number", rollup: "weighted" }, zero, sums)).toBe(4);
  });

  test("function roll-ups receive rows with computed values and the sums", () => {
    expect(registry.rollup(registry.get("margin"), rows, sums)).toBeCloseTo(0.2);
    expect(registry.rollup({ key: "x", rollup: () => undefined }, rows, sums)).toBeNull();
  });

  test("no rule or no numbers gives null", () => {
    expect(registry.rollup({ key: "qty", type: "number" }, rows, sums)).toBeNull();
    expect(
      registry.rollup({ key: "missing", type: "number", rollup: "sum" }, rows, sums),
    ).toBeNull();
  });
});
