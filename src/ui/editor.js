// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { formatMoney, minorUnitScale, parseMoney } from "../engine/format.js";
import { isLocked, isMilestone } from "../engine/model.js";
import { button, openDialog } from "./dialog.js";
import { html, setContent } from "./dom.js";

/**
 * The built-in task editor: a modal `<dialog>` with the configured fields,
 * inline validation (`aria-invalid` plus a described error per field) and
 * custom slots. Saving goes through `updateTask(…, {cause: "editor"})`, so
 * before-events, server approval and undo all apply; a rejected save keeps the
 * dialog open and shows why.
 *
 * Integrators replace it with `editor: "none"`, an `editor(task, context)`
 * function, or by preventing `before-editor-open` (for example to load an
 * htmx partial into their own modal).
 *
 * @module ui/editor
 */

/**
 * @typedef {object} EditorField
 * @property {string} [field] "name" | "start" | "finish" | "duration" | "progress" | "value" | "trade" | "crew" | "notes" | "fields.<key>"
 * @property {string} [label]
 * @property {"text"|"textarea"|"date"|"duration"|"number"|"integer"|"currency"|"percent"|"select"|"boolean"} [type]
 * @property {(string|{value: string, label: string})[]} [options]
 * @property {boolean} [required]
 * @property {boolean} [readOnly]
 * @property {string} [unit]
 * @property {string} [slot] a custom area instead of an input
 * @property {(task: Readonly<Record<string, any>>, context: object) => Node} [render] fills a slot
 */

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {Readonly<Record<string, any>>} task
 * @returns {EditorField[]}
 */
export function defaultEditorFields(gantt, task) {
  const s = gantt.strings;
  const milestone = isMilestone(task);
  /** @type {EditorField[]} */
  const fields = [{ field: "name", label: s.editorName, type: "text", required: true }];
  if (!task.summary)
    fields.push({ field: "start", label: milestone ? s.editorDate : s.columnStart, type: "date" });
  if (!task.summary && !milestone) {
    fields.push(
      { field: "finish", label: s.editorFinish, type: "date" },
      { field: "duration", label: s.editorDuration, type: "duration" },
      { field: "progress", label: s.columnProgress, type: "percent" },
    );
  }
  if (task.type === "payment")
    fields.push({ field: "value", label: s.columnValue, type: "currency" });
  for (const definition of gantt.fields.list()) {
    if (definition.editor === false || task.summary) continue;
    fields.push({
      field: `fields.${definition.key}`,
      label: definition.label ?? definition.key,
      type: definition.multiline
        ? "textarea"
        : definition.type === "integer"
          ? "integer"
          : (definition.type ?? "text"),
      options: definition.options,
      required: definition.required,
      readOnly: !gantt.fields.isEditable(definition.key),
      unit: definition.unit,
    });
  }
  fields.push({ field: "notes", label: s.editorNotes, type: "textarea" });
  return fields;
}

/**
 * @param {Readonly<Record<string, any>>} task
 * @param {string} field
 * @returns {unknown}
 */
function readValue(task, field) {
  return field.startsWith("fields.") ? task.fields?.[field.slice(7)] : task[field];
}

/**
 * Converts a stored value to the input's text.
 * @param {EditorField} spec
 * @param {unknown} value
 * @param {string} currency
 * @returns {string}
 */
function toInput(spec, value, currency) {
  if (value === null || value === undefined) return "";
  if (spec.type === "currency")
    return (Number(value) / minorUnitScale(currency)).toFixed(Math.log10(minorUnitScale(currency)));
  if (spec.type === "percent") return String(Math.round(Number(value) * 1000) / 10);
  return String(value);
}

/**
 * Converts the input's text back to a stored value, or returns `{error}`.
 * @param {EditorField} spec
 * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} input
 * @param {string} currency
 * @returns {{value: unknown}|{error: string}}
 */
function fromInput(spec, input, currency) {
  if (spec.type === "boolean") return { value: /** @type {HTMLInputElement} */ (input).checked };
  const text = input.value.trim();
  if (text === "") return spec.required ? { error: "required" } : { value: null };
  if (spec.type === "currency") {
    const minor = parseMoney(text, { currency });
    return Number.isNaN(minor) ? { error: "number" } : { value: minor };
  }
  if (spec.type === "percent") {
    const percent = Number(text);
    return Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? { value: Math.round(percent * 10) / 1000 }
      : { error: "percent" };
  }
  if (["duration", "integer"].includes(spec.type))
    return Number.isInteger(Number(text)) ? { value: Number(text) } : { error: "integer" };
  if (spec.type === "number")
    return Number.isFinite(Number(text)) ? { value: Number(text) } : { error: "number" };
  return { value: text };
}

/**
 * @param {EditorField} spec
 * @param {string} id
 * @param {boolean} disabled
 * @returns {HTMLElement}
 */
function inputFor(spec, id, disabled) {
  const common = {
    id,
    name: spec.field,
    "aria-describedby": `${id}-error`,
    disabled,
    required: spec.required ?? false,
  };
  if (spec.type === "textarea") return html("textarea", { ...common, rows: 3 });
  if (spec.type === "boolean") return html("input", { ...common, type: "checkbox" });
  if (spec.type === "select") {
    const options = (spec.options ?? []).map((option) =>
      typeof option === "string" ? { value: option, label: option } : option,
    );
    return html("select", common, [
      html("option", { value: "" }, [""]),
      ...options.map((option) => html("option", { value: option.value }, [option.label])),
    ]);
  }
  const typeMap = {
    date: "date",
    duration: "number",
    integer: "number",
    number: "number",
    percent: "number",
  };
  const input = html("input", {
    ...common,
    type: typeMap[spec.type] ?? "text",
    inputmode: spec.type === "currency" ? "decimal" : null,
    min: spec.type === "duration" ? 1 : spec.type === "percent" ? 0 : null,
    max: spec.type === "percent" ? 100 : null,
    step: spec.type === "percent" ? 5 : spec.type === "number" ? "any" : null,
  });
  return input;
}

/**
 * Opens the built-in editor for a task.
 * @param {import("./gantt.js").Gantt} gantt
 * @param {string} taskId
 * @returns {boolean}
 */
export function openTaskEditor(gantt, taskId) {
  const task = gantt.getTask(taskId);
  if (!task) return false;
  const s = gantt.strings;
  const viewOnly = gantt.readOnly || isLocked(task);
  const currency = gantt.currency;
  const handle = openDialog(gantt.root, {
    title: viewOnly ? s.editorViewTitle : s.editorTitle,
    className: "sg-editor",
  });
  const form = html("form", { class: "sg-form", novalidate: true });
  const status = html("p", { class: "sg-form-status", role: "alert" });
  const controls = buildControls(gantt, task, form, viewOnly);
  handle.body.append(status, form);
  const cancel = button(viewOnly ? s.close : s.cancel);
  cancel.addEventListener("click", () => handle.close("cancel"));
  handle.actions.append(cancel);
  if (!viewOnly) {
    const save = button(s.save, { class: "sg-button sg-button-primary" });
    save.addEventListener("click", (event) => {
      event.preventDefault();
      submit();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    handle.actions.append(save);
  }
  let saved = false;
  const submit = () => {
    const patch = collectPatch(gantt, task, controls, currency);
    if (!patch) return;
    if (Object.keys(patch).length === 0) {
      handle.close("cancel");
      return;
    }
    status.textContent = s.pending;
    gantt.updateTask(taskId, patch, { cause: "editor", label: s.editorTitle }).then((result) => {
      if (result.committed || result.reason === "no-change") {
        saved = true;
        gantt.emit("editor-save", { taskId, values: patch });
        handle.close("save");
        return;
      }
      status.textContent = gantt.lastRejection?.message ?? result.reason ?? "";
    });
  };
  handle.closed.then(() => gantt.emit("editor-close", { taskId, saved }));
  const first = /** @type {HTMLElement|undefined} */ (
    controls.find((control) => !control.input.disabled)?.input ?? cancel
  );
  first?.focus();
  gantt.emit("editor-open", { taskId, mode: viewOnly ? "view" : "edit" });
  gantt.activeDialog = handle;
  return true;
}

/**
 * Builds a labelled input (with affixes and an error message) for each field.
 * @param {import("./gantt.js").Gantt} gantt
 * @param {Readonly<Record<string, any>>} task
 * @param {HTMLElement} form
 * @param {boolean} viewOnly
 * @returns {{spec: EditorField, input: any, error: HTMLElement}[]}
 */
function buildControls(gantt, task, form, viewOnly) {
  const s = gantt.strings;
  const currency = gantt.currency;
  const specs = gantt.options.editorFields ?? defaultEditorFields(gantt, task);
  /** @type {{spec: EditorField, input: any, error: HTMLElement}[]} */
  const controls = [];
  for (const [index, spec] of specs.entries()) {
    if (spec.slot) {
      form.append(renderSlot(gantt, spec, task));
      continue;
    }
    const id = `${gantt.uid}-edit-${index}`;
    const input = /** @type {any} */ (inputFor(spec, id, viewOnly || spec.readOnly));
    const value = readValue(task, spec.field);
    if (spec.type === "boolean") input.checked = Boolean(value);
    else input.value = toInput(spec, value, currency);
    const error = html("span", { class: "sg-field-error", id: `${id}-error` });
    const prefix = spec.type === "currency" ? currencySymbol(currency, gantt.options.locale) : "";
    const suffix =
      spec.type === "percent"
        ? "%"
        : (spec.unit ?? (spec.type === "duration" ? s.workingDays : ""));
    const row = html("div", { class: `sg-field sg-field-${spec.type ?? "text"}` }, [
      html("label", { for: id }, [spec.label ?? spec.field]),
      html("span", { class: "sg-input" }, [
        prefix ? html("span", { class: "sg-affix", "aria-hidden": "true" }, [prefix]) : "",
        input,
        suffix ? html("span", { class: "sg-affix" }, [suffix]) : "",
      ]),
      error,
    ]);
    form.append(row);
    controls.push({ spec, input, error });
  }
  return controls;
}

/**
 * Reads and validates every control; returns the patch or null when invalid.
 * @param {import("./gantt.js").Gantt} gantt
 * @param {Readonly<Record<string, any>>} task
 * @param {{spec: EditorField, input: any, error: HTMLElement}[]} controls
 * @param {string} currency
 * @returns {Record<string, any>|null}
 */
function collectPatch(gantt, task, controls, currency) {
  const s = gantt.strings;
  /** @type {Record<string, any>} */
  const patch = {};
  const fields = {};
  let firstInvalid = null;
  for (const { spec, input, error } of controls) {
    if (input.disabled) continue;
    const parsed = fromInput(spec, input, currency);
    let message = "error" in parsed ? (s[`invalid_${parsed.error}`] ?? s.invalid_number) : null;
    if (!message && spec.field.startsWith("fields.")) {
      const key = spec.field.slice(7);
      message = gantt.fields.validate(key, /** @type {any} */ (parsed).value, {
        ...task,
        fields: { ...task.fields, [key]: /** @type {any} */ (parsed).value },
      });
    }
    error.textContent = message ?? "";
    input.toggleAttribute("aria-invalid", Boolean(message));
    if (message) {
      firstInvalid ??= input;
      continue;
    }
    const value = /** @type {any} */ (parsed).value;
    const before = readValue(task, spec.field);
    if ((before ?? null) === (value ?? null)) continue;
    if (spec.field.startsWith("fields.")) fields[spec.field.slice(7)] = value;
    else patch[spec.field] = value;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }
  if (patch.duration !== undefined) delete patch.finish;
  if (Object.keys(fields).length) patch.fields = fields;
  return patch;
}

/**
 * @param {import("./gantt.js").Gantt} gantt
 * @param {EditorField} spec
 * @param {Readonly<Record<string, any>>} task
 * @returns {HTMLElement}
 */
function renderSlot(gantt, spec, task) {
  const area = html("div", { class: "sg-slot", "data-slot": spec.slot });
  const template = /** @type {HTMLTemplateElement|null} */ (
    gantt.host.querySelector(`template[data-slot="${CSS.escape(spec.slot)}"]`)
  );
  if (spec.render) setContent(area, spec.render(task, { gantt }));
  else if (template) area.append(template.content.cloneNode(true));
  return area;
}

/**
 * @param {string} currency
 * @param {string} locale
 * @returns {string}
 */
function currencySymbol(currency, locale) {
  const formatted = formatMoney(0, { currency, locale });
  return formatted.replace(/[\d.,\s]/g, "") || currency;
}
