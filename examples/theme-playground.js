// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";

/**
 * Theme playground: presets, colour pickers and shape sliders that call
 * `gantt.setTheme()`, plus the CSS that reproduces the current theme.
 * `?preset=dark|brand|daisyui` selects a preset on load, `&trades` colours by
 * trade and `&bare` hides the controls (the visual tests use all three).
 */

const COLOUR_TOKENS = [
  ["bar", "Bars"],
  ["barCritical", "Critical path"],
  ["milestone", "Milestones"],
  ["payment", "Payments"],
  ["link", "Links"],
  ["today", "Today line"],
  ["bg", "Background"],
  ["fg", "Text"],
  ["headerBg", "Headers"],
  ["rowAlt", "Alternate rows"],
];

const SHAPE_TOKENS = [
  ["radius", "Corner radius", 0, 16, "px"],
  ["barRadius", "Bar radius", 0, 10, "px"],
  ["barHeight", "Bar height", 6, 26, "px"],
  ["rowHeight", "Row height", 24, 48, "px"],
  ["linkWidth", "Link width", 1, 4, "px"],
];

/** A fictional brand, to show a full plain-CSS re-skin. */
const BRAND = {
  paletteBg: "#fffdf7",
  paletteFg: "#1c1917",
  paletteLine: "#e7e5e4",
  paletteHeader: "#f5f0e6",
  palettePrimary: "#0f766e",
  paletteError: "#be123c",
  paletteWarning: "#a16207",
  rowAlt: "#faf6ee",
  font: "Georgia, 'Times New Roman', serif",
  radius: "2px",
  barRadius: "0px",
  barHeight: "14px",
  linkWidth: "1.5px",
};

const TRADES = {
  Scaffolding: "#475569",
  Roofing: "#c2410c",
  Carpentry: "#a16207",
};

const params = new URLSearchParams(location.search);
const data = await (await fetch("/examples/data/flat-roof.json")).json();
const stage = document.getElementById("stage");
const presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById("preset"));
const byTrade = /** @type {HTMLInputElement} */ (document.getElementById("by-trade"));
const output = document.getElementById("css-out");
/** @type {Record<string, string>} */
let overrides = {};

const gantt = new Gantt(document.getElementById("programme"), {
  data,
  height: "460px",
  zoom: "week",
  barLabels: "inside",
  today: () => "2026-11-09",
});
window.gantt = gantt;

/** @param {string} key camelCase token key */
function cssName(key) {
  return `--sg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderCSS() {
  const lines = Object.entries(overrides).map(([key, value]) => `  ${cssName(key)}: ${value};`);
  const categories = byTrade.checked
    ? Object.entries(TRADES).map(
        ([trade, colour]) => `  --sg-category-${trade.toLowerCase()}: ${colour};`,
      )
    : [];
  output.textContent = [".sg-root {", ...lines, ...categories, "}"].join("\n");
}

/** @param {string} key @param {string|null} value */
function setToken(key, value) {
  if (value === null) delete overrides[key];
  else overrides[key] = value;
  gantt.setTheme({ [key]: value });
  renderCSS();
}

function buildControls() {
  const colours = document.getElementById("colours");
  for (const [key, label] of COLOUR_TOKENS) {
    const input = Object.assign(document.createElement("input"), { type: "color", name: key });
    input.addEventListener("input", onColourInput);
    const wrapper = document.createElement("label");
    wrapper.append(label, input);
    colours.append(wrapper);
  }
  const shape = document.getElementById("shape");
  for (const [key, label, min, max, unit] of SHAPE_TOKENS) {
    const input = Object.assign(document.createElement("input"), {
      type: "range",
      name: key,
      min: String(min),
      max: String(max),
      step: "1",
    });
    input.dataset.unit = unit;
    input.addEventListener("input", onShapeInput);
    const wrapper = document.createElement("label");
    wrapper.append(label, input);
    shape.append(wrapper);
  }
}

/** @param {Event} event */
function onColourInput(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  setToken(input.name, input.value);
}

/** @param {Event} event */
function onShapeInput(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  setToken(input.name, `${input.value}${input.dataset.unit}`);
}

function clearOverrides() {
  gantt.setTheme(Object.fromEntries(Object.keys(overrides).map((key) => [key, null])));
  overrides = {};
}

/** @param {string} preset */
function applyPreset(preset) {
  clearOverrides();
  stage.removeAttribute("data-theme");
  stage.classList.remove("daisy-dracula");
  if (preset === "dark") stage.dataset.theme = "dark";
  if (preset === "daisyui") stage.classList.add("daisy-dracula");
  if (preset === "brand") {
    overrides = { ...BRAND };
    gantt.setTheme(BRAND);
  }
  gantt.refreshTheme();
  renderCSS();
}

function onTradeToggle() {
  gantt.options.categoryOf = byTrade.checked ? (task) => task.trade : undefined;
  gantt.setCategories(
    Object.fromEntries(
      Object.entries(TRADES).map(([trade, colour]) => [trade, byTrade.checked ? colour : null]),
    ),
  );
  renderCSS();
}

function onPresetChange() {
  applyPreset(presetSelect.value);
}

function onReset() {
  applyPreset(presetSelect.value === "brand" ? "light" : presetSelect.value);
  if (presetSelect.value === "brand") presetSelect.value = "light";
}

buildControls();
presetSelect.addEventListener("change", onPresetChange);
byTrade.addEventListener("change", onTradeToggle);
document.getElementById("reset").addEventListener("click", onReset);
presetSelect.value = params.get("preset") ?? "light";
applyPreset(presetSelect.value);
if (params.has("trades")) {
  byTrade.checked = true;
  onTradeToggle();
}
document.body.classList.toggle("bare", params.has("bare"));
document.body.dataset.ready = "true";
