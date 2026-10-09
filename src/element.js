// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "./ui/gantt.js";

/**
 * `<streamlined-gantt>`: the declarative, htmx-friendly way to use the library.
 *
 * ```html
 * <streamlined-gantt src="/jobs/42/programme.json" zoom="week" read-only></streamlined-gantt>
 * ```
 *
 * - Data comes from `src` (fetched same-origin, aborted on removal) or a child
 *   `<script type="application/json">`.
 * - JavaScript options (fields, columns, handlers) come from `element.options`
 *   set before insertion, or from a named configuration registered with
 *   `defineConfig(name, options)` and referenced as `config="name"`.
 * - It initialises when connected (including by an htmx swap) and destroys
 *   itself when removed. A move within the document (disconnect and reconnect
 *   in the same task) keeps the instance.
 * - With `listen-patch`, `gantt:patch` events on the document (for example
 *   from an `HX-Trigger` response header) are applied with `applyPatch()`.
 *   A patch whose detail names a `target` id only applies to that element.
 *
 * Light DOM, not Shadow DOM, so Tailwind, DaisyUI and print styles apply.
 *
 * @module element
 */

/** @type {Map<string, import("./ui/gantt.js").GanttOptions>} */
const configurations = new Map();

/**
 * Registers named options for `<streamlined-gantt config="name">`.
 * @param {string} name
 * @param {import("./ui/gantt.js").GanttOptions} options
 */
export function defineConfig(name, options) {
  configurations.set(name, options);
}

const BOOLEAN_ATTRIBUTES = {
  "read-only": "readOnly",
  "critical-path": "showCriticalPath",
  toolbar: "toolbar",
};

export class StreamlinedGanttElement extends HTMLElement {
  static get observedAttributes() {
    return ["zoom", "read-only", "src", "show-baseline", "critical-path"];
  }

  constructor() {
    super();
    /** @type {Gantt|null} */
    this.instance = null;
    /** @type {import("./ui/gantt.js").GanttOptions} */
    this.options = {};
    this.abort = null;
    this.teardownQueued = false;
    this.onPatch = (event) => this.applyPatchEvent(event);
    this.onReady = () => this.initialise();
  }

  /** The Gantt instance (null until data has loaded). */
  get gantt() {
    return this.instance;
  }

  connectedCallback() {
    this.teardownQueued = false;
    if (this.instance || this.abort) return;
    if (document.readyState === "loading" && !this.getAttribute("src") && !this.dataScript()) {
      document.addEventListener("DOMContentLoaded", this.onReady, { once: true });
      return;
    }
    this.initialise();
  }

  disconnectedCallback() {
    this.teardownQueued = true;
    queueMicrotask(() => {
      if (this.teardownQueued && !this.isConnected) this.teardown();
    });
  }

  /**
   * @param {string} name
   * @param {string|null} previous
   * @param {string|null} value
   */
  attributeChangedCallback(name, previous, value) {
    if (previous === value || !this.instance) return;
    if (name === "zoom" && value) this.instance.setZoom(/** @type {any} */ (value));
    if (name === "read-only") this.instance.setReadOnly(value !== null);
    if (name === "critical-path") this.instance.setCriticalPathVisible(value !== "false");
    if (name === "show-baseline") this.instance.setBaselineVisible(value);
    if (name === "src" && value) this.reload(value);
  }

  /** @returns {HTMLScriptElement|null} */
  dataScript() {
    return this.querySelector(':scope > script[type="application/json"]');
  }

  /** @returns {import("./ui/gantt.js").GanttOptions} */
  collectOptions() {
    const named = this.getAttribute("config");
    const options = { ...(named ? (configurations.get(named) ?? {}) : {}), ...this.options };
    const zoom = this.getAttribute("zoom");
    if (zoom) options.zoom = /** @type {any} */ (zoom);
    for (const [attribute, key] of Object.entries(BOOLEAN_ATTRIBUTES)) {
      if (this.hasAttribute(attribute)) options[key] = this.getAttribute(attribute) !== "false";
    }
    for (const [attribute, key] of [
      ["locale", "locale"],
      ["show-baseline", "showBaseline"],
      ["edit-mode", "editMode"],
      ["auto-schedule", "autoSchedule"],
      ["height", "height"],
      ["color-scheme", "colorScheme"],
      ["layout", "layout"],
      ["fit", "fit"],
      ["mobile", "mobile"],
    ]) {
      const value = this.getAttribute(attribute);
      if (value !== null) options[key] = value;
    }
    return options;
  }

  async initialise() {
    if (this.instance || !this.isConnected) return;
    if (this.hasAttribute("listen-patch")) document.addEventListener("gantt:patch", this.onPatch);
    const source = this.getAttribute("src");
    const script = this.dataScript();
    try {
      const data = source
        ? await this.fetchData(source)
        : script
          ? JSON.parse(script.textContent ?? "{}")
          : null;
      if (!this.isConnected || this.teardownQueued) return;
      this.instance = new Gantt(this, { ...this.collectOptions(), data: data ?? undefined });
    } catch (error) {
      if (/** @type {any} */ (error)?.name === "AbortError") return;
      this.dispatchEvent(
        new CustomEvent("gantt:error", {
          bubbles: true,
          detail: { error, message: String(/** @type {any} */ (error)?.message ?? error) },
        }),
      );
    }
  }

  /**
   * @param {string} url
   * @returns {Promise<unknown>}
   */
  async fetchData(url) {
    this.abort = new AbortController();
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        signal: this.abort.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
      return await response.json();
    } finally {
      this.abort = null;
    }
  }

  /** @param {string} url */
  async reload(url) {
    try {
      const data = await this.fetchData(url);
      if (this.instance && this.isConnected) this.instance.load(data);
    } catch (error) {
      if (/** @type {any} */ (error)?.name !== "AbortError")
        this.instance?.emit("error", {
          error,
          message: String(/** @type {any} */ (error)?.message ?? error),
        });
    }
  }

  /** @param {Event} event */
  applyPatchEvent(event) {
    const detail = /** @type {CustomEvent} */ (event).detail ?? {};
    if (detail.target && String(detail.target).replace(/^#/, "") !== this.id) return;
    const { target: _target, elt: _elt, ...changeset } = detail;
    this.instance?.applyPatch(changeset.changes ?? changeset, { cause: "patch" });
  }

  teardown() {
    document.removeEventListener("DOMContentLoaded", this.onReady);
    document.removeEventListener("gantt:patch", this.onPatch);
    this.abort?.abort();
    this.abort = null;
    this.instance?.destroy();
    this.instance = null;
  }
}

/**
 * Registers `<streamlined-gantt>` (idempotent; safe to call from several bundles).
 * @param {string} [name]
 */
export function defineElement(name = "streamlined-gantt") {
  if (typeof customElements === "undefined" || customElements.get(name)) return;
  customElements.define(name, class extends StreamlinedGanttElement {});
}
