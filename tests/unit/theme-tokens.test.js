// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Guards the theming contract (docs/theming.md):
 * - no raw colour outside the CSS token block, nor in any JS that renders;
 * - every token the code uses is defined (or set from JS/data) and documented;
 * - every documented token exists.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const CSS = read("src/css/streamlined-gantt.css");
const DOCS = read("docs/theming.md");

const [beforeTokens, afterStart] = CSS.split("/* tokens:start");
const [tokenBlock, rules] = afterStart.split("/* tokens:end */");

/** CSS colour keywords that are not system colours or `transparent`/`currentColor`. */
const NAMED_COLOURS =
  "white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|brown|gold|indigo|violet|cyan|magenta|beige|ivory|tan|coral|salmon|crimson|khaki|lavender|plum|orchid|turquoise";
const CSS_COLOUR =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bcolor\(\s*(?:srgb|display-p3)/i;
const CSS_NAMED = new RegExp(`:\\s*[^;{}]*\\b(?:${NAMED_COLOURS})\\b`, "i");

/** JS files whose output is visual: the UI, the element, print/export. */
function renderingSources() {
  const files = ["src/element.js", "src/toolbar.js"];
  for (const directory of ["src/ui", "src/print"]) {
    for (const name of readdirSync(new URL(`${directory}/`, ROOT))) {
      if (name.endsWith(".js")) files.push(`${directory}/${name}`);
    }
  }
  return files;
}

/** String and template literals in JS source, ignoring comments (good enough for this codebase's style). */
function stringLiterals(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map(
    (match) => match[0],
  );
}

const definedTokens = new Set(
  [...tokenBlock.matchAll(/(--sg-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);
/** Tokens set from JS or data at run time, and documented as such. */
const RUNTIME_TOKENS = ["--sg-task-color", "--sg-task-text", "--sg-link-color"];
/** Geometry inputs read by JS; unset by default so JS can choose touch-friendly sizes. */
const GEOMETRY_INPUTS = [
  "--sg-row-height",
  "--sg-bar-height",
  "--sg-summary-height",
  "--sg-milestone-size",
];
/** Internal layout variables written by the renderer, not theme tokens. */
const INTERNAL = ["--sg-row-px", "--sg-level", "--sg-grid-columns", "--sg-grid-width"];
const documented = new Set(
  [...DOCS.matchAll(/^\| `(--sg-[a-z0-9<>-]+)`\s*\|/gm)].map((match) => match[1]),
);

describe("no hard-coded colours", () => {
  test("the stylesheet has its token block inside the cascade layer", () => {
    expect(beforeTokens).toContain("@layer streamlined-gantt {");
    expect(tokenBlock).toBeTruthy();
    expect(rules.trim().endsWith("}")).toBe(true);
  });

  test("no CSS rule outside the token block uses a raw colour", () => {
    const offending = rules
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(
        ({ line }) => CSS_COLOUR.test(line) || (CSS_NAMED.test(line) && !/white-space/.test(line)),
      );
    expect(offending).toEqual([]);
  });

  test.each(renderingSources())("%s has no colour literals", (path) => {
    const offending = stringLiterals(read(path)).filter(
      (literal) =>
        CSS_COLOUR.test(literal) ||
        new RegExp(`^["'\`](?:${NAMED_COLOURS})["'\`]$`, "i").test(literal),
    );
    expect(offending).toEqual([]);
  });
});

describe("token coverage", () => {
  const sources = [CSS, ...renderingSources().map(read)].join("\n");
  const used = new Set(
    [...sources.matchAll(/--sg-[a-z0-9-]+/g)]
      .map((match) => match[0])
      .filter((token) => !token.startsWith("--sg-category-")),
  );

  test("every token the code uses is defined, set at run time, or internal", () => {
    const known = new Set([...definedTokens, ...RUNTIME_TOKENS, ...GEOMETRY_INPUTS, ...INTERNAL]);
    expect([...used].filter((token) => !known.has(token)).sort()).toEqual([]);
  });

  test("every defined, run-time and geometry token is documented", () => {
    const tokens = [...definedTokens, ...RUNTIME_TOKENS, ...GEOMETRY_INPUTS];
    expect(tokens.filter((token) => !documented.has(token)).sort()).toEqual([]);
  });

  test("every documented token exists", () => {
    const known = new Set([
      ...definedTokens,
      ...RUNTIME_TOKENS,
      ...GEOMETRY_INPUTS,
      "--sg-category-<key>",
      "--sg-category-<key>-text",
    ]);
    expect([...documented].filter((token) => !known.has(token)).sort()).toEqual([]);
  });

  test("the print module resolves only defined tokens", () => {
    const listed = [...read("src/print/index.js").matchAll(/"(--sg-[a-z0-9-]+)"/g)].map(
      (match) => match[1],
    );
    expect(listed.length).toBeGreaterThan(20);
    expect(listed.filter((token) => !definedTokens.has(token))).toEqual([]);
  });

  test("the dark palette redefines every palette colour, in both the media query and [data-theme]", () => {
    const palette = [...definedTokens].filter((token) => token.startsWith("--sg-palette-"));
    const blocks = tokenBlock
      .split(/@media \(prefers-color-scheme: dark\)|\.sg-root\.sg-scheme-dark/)
      .slice(1);
    expect(blocks).toHaveLength(2);
    for (const block of blocks)
      expect(palette.filter((token) => !block.includes(`${token}:`))).toEqual([]);
  });
});
