// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Theming from JavaScript. Every visual value is a `--sg-*` custom property
 * (see docs/theming.md); this module sets them on the chart root, maps task
 * categories to `--sg-category-<key>` colours, picks a readable text colour
 * for custom bar colours, and reads the geometry tokens the renderer needs.
 *
 * @module ui/theme
 */

/**
 * `"barCritical"`, `"bar-critical"` and `"--sg-bar-critical"` all name `--sg-bar-critical`.
 * @param {string} key
 * @returns {string}
 */
export function tokenName(key) {
  if (key.startsWith("--")) return key;
  return `--sg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * A category value as a safe CSS identifier fragment: "Roofing & leadwork" -> "roofing-leadwork".
 * @param {unknown} value
 * @returns {string}
 */
export function categoryKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Sets (or, for `null`/`undefined`/`""`, removes) theme tokens as inline
 * custom properties on `element`.
 * @param {HTMLElement} element
 * @param {Record<string, string|number|null|undefined>} theme
 */
export function applyTheme(element, theme) {
  for (const [key, value] of Object.entries(theme ?? {})) {
    const name = tokenName(key);
    if (value === null || value === undefined || value === "") element.style.removeProperty(name);
    else element.style.setProperty(name, String(value));
  }
}

/**
 * @typedef {string|{color: string, text?: string}} CategoryColour
 */

/**
 * Category colours as tokens: `{roofing: "#c2410c"}` sets `--sg-category-roofing`
 * and `--sg-category-roofing-text` (given, or chosen for contrast).
 * @param {Record<string, CategoryColour|null>} categories
 * @returns {Record<string, string|null>}
 */
export function categoryTokens(categories) {
  /** @type {Record<string, string|null>} */
  const tokens = {};
  for (const [name, colour] of Object.entries(categories ?? {})) {
    const token = `--sg-category-${categoryKey(name)}`;
    const detailed = typeof colour === "object" && colour !== null;
    const value = detailed ? colour.color : /** @type {string|null} */ (colour);
    tokens[token] = value;
    tokens[`${token}-text`] = (detailed ? colour.text : null) ?? readableText(value);
  }
  return tokens;
}

/**
 * The text colour token with the better contrast on a hex background: light
 * text (`--sg-text-on-dark`) or dark text (`--sg-text-on-light`), using WCAG
 * 2.2 relative luminance; white text wins down to a luminance of about 0.18,
 * where both reach the same contrast. Other colour syntaxes return null, and
 * the theme's `--sg-bar-text` (or a category's `-text` token) applies.
 * @param {unknown} colour e.g. "#c2410c" or "#fa0"
 * @returns {string|null} a `var(...)` reference
 */
export function readableText(colour) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(String(colour).trim())?.[1];
  if (!hex) return null;
  const digits = hex.length === 3 ? [...hex].map((digit) => digit + digit) : hex.match(/../g);
  const [red, green, blue] = /** @type {string[]} */ (digits).map((pair) => {
    const value = Number.parseInt(pair, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? "var(--sg-text-on-light)" : "var(--sg-text-on-dark)";
}

/**
 * @typedef {object} AppearanceOptions
 * @property {(task: Readonly<Record<string, any>>) => unknown} [categoryOf] the category of a task (default `task.category`)
 * @property {(task: Readonly<Record<string, any>>) => string|string[]|null|undefined} [taskClass]
 * @property {(task: Readonly<Record<string, any>>) => Record<string, string>|null|undefined} [taskStyle]
 */

/**
 * @typedef {object} Appearance
 * @property {string[]} classes extra classes for the task's group
 * @property {Record<string, string>} style custom properties and styles for the group
 * @property {string|null} colour the task's custom colour expression, if any
 */

/**
 * How one task is coloured: its category, `style.color`, then the host's
 * `taskClass` and `taskStyle` callbacks, in increasing precedence. Text on a
 * custom colour is `style.textColor`, else chosen for contrast (hex colours).
 * @param {Readonly<Record<string, any>>} task
 * @param {AppearanceOptions} options
 * @returns {Appearance}
 */
export function taskAppearance(task, options) {
  /** @type {Appearance} */
  const appearance = { classes: [], style: {}, colour: null };
  const key = categoryKey((options.categoryOf ?? ((item) => item.category))(task));
  if (key) {
    appearance.classes.push(`sg-category-${key}`);
    appearance.colour = `var(--sg-category-${key}, var(--sg-bar))`;
    appearance.style["--sg-task-text"] = `var(--sg-category-${key}-text, var(--sg-bar-text))`;
  }
  if (task.style?.color) {
    appearance.colour = String(task.style.color);
    appearance.style["--sg-task-text"] = readableText(appearance.colour) ?? "var(--sg-bar-text)";
  }
  if (task.style?.textColor) appearance.style["--sg-task-text"] = String(task.style.textColor);
  const extra = options.taskClass?.(task);
  if (extra)
    appearance.classes.push(
      ...[extra]
        .flat()
        .flatMap((name) => String(name).split(/\s+/))
        .filter(Boolean),
    );
  const style = options.taskStyle?.(task);
  if (style) {
    Object.assign(appearance.style, style);
    if (style["--sg-task-color"]) appearance.colour = style["--sg-task-color"];
  }
  if (appearance.colour) appearance.style["--sg-task-color"] = appearance.colour;
  return appearance;
}

/**
 * Pixel value of a length token on the root, or `fallback` when unset.
 * @param {CSSStyleDeclaration} computed
 * @param {string} token
 * @param {number} fallback
 * @returns {number}
 */
export function lengthToken(computed, token, fallback) {
  const value = Number.parseFloat(computed.getPropertyValue(token));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
