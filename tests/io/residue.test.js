// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { fc, test as property } from "@fast-check/vitest";
import { describe, expect, test } from "vitest";
import { applyPatch, diffValue } from "../../src/io/residue.js";
import { RUNS } from "../support/arbitraries.js";

describe("diffValue and applyPatch", () => {
  test("equal values need no patch", () => {
    expect(diffValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeUndefined();
    expect(applyPatch({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(applyPatch({ a: 1 }, 0)).toEqual({ a: 1 });
  });

  test("stores only what differs, nested through objects and same-length arrays", () => {
    const original = {
      id: "ew",
      nonWorking: [{ date: "2026-12-25", kind: "bank-holiday" }, { date: "2026-12-28" }],
      extra: { deep: true },
    };
    const rebuilt = {
      id: "cal-1",
      nonWorking: [{ date: "2026-12-25" }, { date: "2026-12-28" }],
      name: "x",
    };
    const patch = diffValue(original, rebuilt);
    expect(patch).toEqual({
      o: {
        extra: { "=": { deep: true } },
        id: { "=": "ew" },
        nonWorking: { a: [{ o: { kind: { "=": "bank-holiday" } } }, 0] },
      },
      d: ["name"],
    });
    expect(applyPatch(rebuilt, patch)).toEqual(original);
  });

  test("replaces arrays of a different length and values of a different kind", () => {
    expect(diffValue([1, 2, 3], [1, 2])).toEqual({ "=": [1, 2, 3] });
    expect(diffValue({ a: 1 }, [1])).toEqual({ "=": { a: 1 } });
    expect(diffValue(null, {})).toEqual({ "=": null });
  });

  test("serialises the same difference identically whatever the key order", () => {
    const first = JSON.stringify(diffValue({ b: 1, a: 2, c: 3 }, { z: 0, y: 0 }));
    const second = JSON.stringify(diffValue({ c: 3, a: 2, b: 1 }, { y: 0, z: 0 }));
    expect(first).toBe(second);
  });

  test("a stale array patch leaves the rebuilt value alone", () => {
    expect(applyPatch([1, 2, 3], { a: [{ "=": 9 }, 0] })).toEqual([1, 2, 3]);
    expect(applyPatch("text", { a: [0] })).toBe("text");
  });

  test("an object patch onto a non-object starts from an empty object", () => {
    expect(applyPatch("text", { o: { a: { "=": 1 } } })).toEqual({ a: 1 });
    expect(applyPatch({ a: 1 }, { o: "junk", d: "junk" })).toEqual({ a: 1 });
    expect(applyPatch({ a: 1, b: 2 }, { d: ["b", 7] })).toEqual({ a: 1 });
  });

  test("replacement values are copies, not shared references", () => {
    const patch = { "=": { nested: [1] } };
    const result = applyPatch(undefined, patch);
    result.nested.push(2);
    expect(patch["="].nested).toEqual([1]);
  });

  test("a hostile patch cannot pollute prototypes", () => {
    const hostile = JSON.parse(
      '{"o":{"__proto__":{"o":{"polluted":{"=":true}}},"constructor":{"=":1},"prototype":{"=":1},"ok":{"=":1}}}',
    );
    const result = applyPatch({}, hostile);
    expect(result).toEqual({ constructor: 1, prototype: 1, ok: 1 });
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(/** @type {any} */ ({}).polluted).toBeUndefined();
  });

  property.prop([fc.jsonValue(), fc.jsonValue()], { numRuns: RUNS })(
    "applying the diff of any two JSON values rebuilds the original (bar __proto__ keys, which are dropped)",
    (original, rebuilt) => {
      fc.pre(!JSON.stringify(original).includes('"__proto__"'));
      const normalised = JSON.parse(JSON.stringify(original));
      const patch = JSON.parse(JSON.stringify(diffValue(normalised, rebuilt) ?? 0));
      expect(applyPatch(rebuilt, patch)).toEqual(normalised);
    },
  );
});
