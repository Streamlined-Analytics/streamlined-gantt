// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Counts live global listeners, observers, timers and animation frames so
 * leak tests can assert that destroy() releases everything. Import this
 * module before the library.
 */

export const counters = {
  globalListeners: 0,
  observers: 0,
  timers: 0,
  frames: 0,
};

const globalTargets = () => [window, document, document.documentElement, document.body];
const activeListeners = new WeakMap();

const originalAdd = EventTarget.prototype.addEventListener;
const originalRemove = EventTarget.prototype.removeEventListener;

EventTarget.prototype.addEventListener = function add(type, listener, options) {
  if (globalTargets().includes(this) && listener) {
    const key = `${type}|${typeof options === "boolean" ? options : Boolean(options?.capture)}`;
    const set = activeListeners.get(listener) ?? new Set();
    const tagged = `${key}|${globalTargets().indexOf(this)}`;
    if (!set.has(tagged)) {
      set.add(tagged);
      activeListeners.set(listener, set);
      counters.globalListeners += 1;
      if (options && typeof options === "object" && options.once) {
        originalAdd.call(
          this,
          type,
          () => {
            if (set.delete(tagged)) counters.globalListeners -= 1;
          },
          { once: true, capture: Boolean(options.capture) },
        );
      }
    }
  }
  return originalAdd.call(this, type, listener, options);
};

EventTarget.prototype.removeEventListener = function remove(type, listener, options) {
  if (globalTargets().includes(this) && listener) {
    const key = `${type}|${typeof options === "boolean" ? options : Boolean(options?.capture)}|${globalTargets().indexOf(this)}`;
    const set = activeListeners.get(listener);
    if (set?.delete(key)) counters.globalListeners -= 1;
  }
  return originalRemove.call(this, type, listener, options);
};

const OriginalResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends OriginalResizeObserver {
  constructor(callback) {
    super(callback);
    counters.observers += 1;
    this.counted = true;
  }

  disconnect() {
    if (this.counted) counters.observers -= 1;
    this.counted = false;
    super.disconnect();
  }
};

const pendingTimers = new Set();
const originalSetTimeout = window.setTimeout.bind(window);
const originalClearTimeout = window.clearTimeout.bind(window);
window.setTimeout = (callback, delay, ...rest) => {
  const id = originalSetTimeout(
    (...args) => {
      if (pendingTimers.delete(id)) counters.timers -= 1;
      if (typeof callback === "function") callback(...args);
    },
    delay,
    ...rest,
  );
  pendingTimers.add(id);
  counters.timers += 1;
  return id;
};
window.clearTimeout = (id) => {
  if (pendingTimers.delete(id)) counters.timers -= 1;
  originalClearTimeout(id);
};

const pendingFrames = new Set();
const originalRequestFrame = window.requestAnimationFrame.bind(window);
const originalCancelFrame = window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => {
  const id = originalRequestFrame((time) => {
    if (pendingFrames.delete(id)) counters.frames -= 1;
    callback(time);
  });
  pendingFrames.add(id);
  counters.frames += 1;
  return id;
};
window.cancelAnimationFrame = (id) => {
  if (pendingFrames.delete(id)) counters.frames -= 1;
  originalCancelFrame(id);
};

/** @returns {typeof counters} */
export function snapshot() {
  return { ...counters };
}
