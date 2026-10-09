// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { EVENT_NAMES, isCancelable } from "./event-catalogue.js";

/**
 * The event object every handler receives. The same object is passed to
 * `gantt.on()` handlers and is the `detail` of the mirrored DOM CustomEvent.
 *
 * Only `before-*` events are cancelable. A handler vetoes with
 * `preventDefault()` (on this object or on the DOM event), or asks the library
 * to wait for a server decision with `waitUntil(promise)`, the Service Worker
 * `ExtendableEvent` idiom. The promise resolving to `false` (or rejecting)
 * vetoes, resolving to a changeset object replaces the local result, and
 * resolving to anything else accepts.
 */
export class GanttEvent {
  /**
   * @param {string} type
   * @param {Record<string, unknown>} [payload]
   */
  constructor(type, payload = {}) {
    for (const [key, value] of Object.entries(payload)) {
      if (key !== "type") /** @type {any} */ (this)[key] = value;
    }
    this.type = type;
    this.cancelable = isCancelable(type);
    this.defaultPrevented = false;
    /** @type {Promise<unknown>[]} */
    this.pending = [];
    this.dispatching = true;
  }

  /** Vetoes a cancelable event. No effect on other events. */
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  /**
   * Defers the decision on a cancelable event until `promise` settles. Must be
   * called synchronously from a handler, as with `ExtendableEvent`.
   * @param {Promise<unknown>|unknown} promise
   * @throws {DOMException} InvalidStateError when called after dispatch or on a non-cancelable event
   */
  waitUntil(promise) {
    if (!this.cancelable) {
      throw new DOMException(
        `"${this.type}" is not cancelable, so waitUntil() is not available`,
        "InvalidStateError",
      );
    }
    if (!this.dispatching) {
      throw new DOMException(
        "waitUntil() must be called while the event is being dispatched",
        "InvalidStateError",
      );
    }
    this.pending.push(Promise.resolve(promise));
  }
}

/**
 * One internal emitter with two faces: `on`/`off`/`once` handlers, and DOM
 * CustomEvents re-dispatched on the host element as `<prefix>:<name>` with
 * `bubbles: true` and the same event object as `detail`.
 */
export class Emitter {
  /**
   * @param {{target?: EventTarget|null, prefix?: string, strict?: boolean}} [options]
   */
  constructor(options = {}) {
    this.target = options.target ?? null;
    this.prefix = options.prefix ?? "gantt";
    this.strict = options.strict ?? true;
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /**
   * @param {string} name
   */
  assertKnown(name) {
    if (this.strict && !EVENT_NAMES.has(name))
      throw new TypeError(`Unknown streamlined-gantt event "${name}"`);
  }

  /**
   * Subscribes and returns an unsubscribe function.
   * @param {string} name
   * @param {(event: GanttEvent) => void} handler
   * @returns {() => void}
   */
  on(name, handler) {
    this.assertKnown(name);
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    return () => this.off(name, handler);
  }

  /**
   * @param {string} name
   * @param {(event: GanttEvent) => void} handler
   */
  off(name, handler) {
    this.handlers.get(name)?.delete(handler);
  }

  /**
   * @param {string} name
   * @param {(event: GanttEvent) => void} handler
   * @returns {() => void}
   */
  once(name, handler) {
    const unsubscribe = this.on(name, (event) => {
      unsubscribe();
      handler(event);
    });
    return unsubscribe;
  }

  /**
   * Dispatches to handlers, then to the DOM. A handler that throws does not
   * stop the others; its error is re-thrown asynchronously so it still reaches
   * the console and error trackers.
   * @param {string} name
   * @param {Record<string, unknown>} [payload]
   * @returns {GanttEvent}
   */
  emit(name, payload) {
    this.assertKnown(name);
    const event = new GanttEvent(name, payload);
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      try {
        handler(event);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    this.dispatchDom(event);
    event.dispatching = false;
    return event;
  }

  /** @param {GanttEvent} event */
  dispatchDom(event) {
    if (!this.target || typeof CustomEvent === "undefined") return;
    const domEvent = new CustomEvent(`${this.prefix}:${event.type}`, {
      bubbles: true,
      cancelable: event.cancelable,
      detail: event,
    });
    const notPrevented = this.target.dispatchEvent(domEvent);
    if (!notPrevented) event.preventDefault();
  }

  /** Removes every handler. */
  clear() {
    this.handlers.clear();
  }
}
