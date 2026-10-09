// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import { linkPath } from "../../../src/ui/link-path.js";

const a = { left: 100, right: 200, y: 16 };
const below = (left, right) => ({ left, right, y: 48 });

describe("dependency arrow routing", () => {
  test.each([
    ["FS", below(240, 300), "M200 16 L208 16 L208 48 L240 48"],
    ["FS", below(150, 300), "M200 16 L208 16 L208 32 L142 32 L142 48 L150 48"],
    ["SS", below(140, 300), "M100 16 L92 16 L92 48 L140 48"],
    ["SS", below(60, 300), "M100 16 L52 16 L52 48 L60 48"],
    ["FF", below(140, 260), "M200 16 L268 16 L268 48 L260 48"],
    ["FF", below(140, 180), "M200 16 L208 16 L208 48 L180 48"],
    ["SF", below(20, 80), "M100 16 L92 16 L92 48 L80 48"],
    ["SF", below(20, 160), "M100 16 L92 16 L92 32 L168 32 L168 48 L160 48"],
  ])("%s to a bar spanning %j", (type, target, expected) => {
    expect(linkPath(type, a, target)).toBe(expected);
  });

  test("routes upwards when the successor is above", () => {
    expect(linkPath("FS", { left: 100, right: 200, y: 80 }, { left: 150, right: 260, y: 16 })).toBe(
      "M200 80 L208 80 L208 64 L142 64 L142 16 L150 16",
    );
  });

  test("honours custom stub and row height", () => {
    expect(linkPath("FS", a, below(160, 300), { stub: 4, rowHeight: 40 })).toBe(
      "M200 16 L204 16 L204 36 L156 36 L156 48 L160 48",
    );
  });
});
