// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { describe, expect, test } from "vitest";
import {
  categoryKey,
  categoryTokens,
  lengthToken,
  readableText,
  taskAppearance,
  tokenName,
} from "../../src/ui/theme.js";

describe("theme helpers", () => {
  test.each([
    ["bar", "--sg-bar"],
    ["barCritical", "--sg-bar-critical"],
    ["bar-critical", "--sg-bar-critical"],
    ["--sg-bar-critical", "--sg-bar-critical"],
    ["--brand-colour", "--brand-colour"],
  ])("tokenName(%s) is %s", (key, name) => {
    expect(tokenName(key)).toBe(name);
  });

  test.each([
    ["Roofing & leadwork", "roofing-leadwork"],
    ["  M&E  ", "m-e"],
    ["Phase 2", "phase-2"],
    [undefined, ""],
    [null, ""],
    [42, "42"],
  ])("categoryKey(%j) is %j", (value, key) => {
    expect(categoryKey(value)).toBe(key);
  });

  test("readable text: WCAG luminance picks dark text on light colours and light text on dark", () => {
    expect(readableText("#ffffff")).toBe("var(--sg-text-on-light)");
    expect(readableText("#fde047")).toBe("var(--sg-text-on-light)");
    expect(readableText("#0f766e")).toBe("var(--sg-text-on-dark)");
    expect(readableText("#000")).toBe("var(--sg-text-on-dark)");
    expect(readableText(" #FA0 ")).toBe("var(--sg-text-on-light)");
    expect(readableText("#757575")).toBe("var(--sg-text-on-dark)");
    expect(readableText("#767676")).toBe("var(--sg-text-on-light)");
  });

  test("readable text is unknown for other colour syntaxes", () => {
    for (const colour of ["rgb(0 0 0)", "var(--brand)", "teal", "#12345", "", null]) {
      expect(readableText(colour)).toBeNull();
    }
  });

  test("category tokens carry a colour and a text colour (given, or chosen for contrast)", () => {
    expect(
      categoryTokens({
        Roofing: "#c2410c",
        "Scaffold hire": { color: "#334155", text: "#f8fafc" },
        brand: "var(--brand)",
        gone: null,
      }),
    ).toEqual({
      "--sg-category-roofing": "#c2410c",
      "--sg-category-roofing-text": "var(--sg-text-on-dark)",
      "--sg-category-scaffold-hire": "#334155",
      "--sg-category-scaffold-hire-text": "#f8fafc",
      "--sg-category-brand": "var(--brand)",
      "--sg-category-brand-text": null,
      "--sg-category-gone": null,
      "--sg-category-gone-text": null,
    });
    expect(categoryTokens(undefined)).toEqual({});
  });

  test("lengthToken reads px lengths, including zero, and falls back when unset", () => {
    const computed = (value) => /** @type {any} */ ({ getPropertyValue: () => value });
    expect(lengthToken(computed(" 28px"), "--x", 3)).toBe(28);
    expect(lengthToken(computed("0px"), "--x", 3)).toBe(0);
    expect(lengthToken(computed(""), "--x", 3)).toBe(3);
    expect(lengthToken(computed("-4px"), "--x", 3)).toBe(3);
  });
});

describe("task appearance", () => {
  test("no category, colour or callbacks: nothing to apply", () => {
    expect(taskAppearance({ id: "a" }, {})).toEqual({ classes: [], style: {}, colour: null });
  });

  test("a category maps to its token, with the category's text token", () => {
    expect(taskAppearance({ category: "Roofing" }, {})).toEqual({
      classes: ["sg-category-roofing"],
      colour: "var(--sg-category-roofing, var(--sg-bar))",
      style: {
        "--sg-task-color": "var(--sg-category-roofing, var(--sg-bar))",
        "--sg-task-text": "var(--sg-category-roofing-text, var(--sg-bar-text))",
      },
    });
  });

  test("categoryOf chooses the category from any field", () => {
    const appearance = taskAppearance(
      { trade: "Groundworker" },
      { categoryOf: (task) => task.trade },
    );
    expect(appearance.classes).toEqual(["sg-category-groundworker"]);
  });

  test("style.color beats the category; text is chosen for contrast unless given", () => {
    const light = taskAppearance({ category: "x", style: { color: "#fde047" } }, {});
    expect(light.colour).toBe("#fde047");
    expect(light.style["--sg-task-text"]).toBe("var(--sg-text-on-light)");
    const named = taskAppearance({ style: { color: "teal" } }, {});
    expect(named.style["--sg-task-text"]).toBe("var(--sg-bar-text)");
    const given = taskAppearance({ style: { color: "#fde047", textColor: "#123456" } }, {});
    expect(given.style["--sg-task-text"]).toBe("#123456");
  });

  test("taskClass and taskStyle callbacks win, in that order", () => {
    const appearance = taskAppearance(
      { category: "roofing", locked: true },
      {
        taskClass: (task) => (task.locked ? ["is-locked", "pinned  extra"] : null),
        taskStyle: () => ({ "--sg-task-color": "#64748b", opacity: "0.8" }),
      },
    );
    expect(appearance.classes).toEqual(["sg-category-roofing", "is-locked", "pinned", "extra"]);
    expect(appearance.colour).toBe("#64748b");
    expect(appearance.style).toMatchObject({ "--sg-task-color": "#64748b", opacity: "0.8" });
    expect(taskAppearance({}, { taskClass: () => "one two" }).classes).toEqual(["one", "two"]);
  });
});
