// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { afterEach, describe, expect, test, vi } from "vitest";
import officeFitOut from "../fixtures/programmes/office-fit-out-sa446.json";
import { Gantt } from "../../src/index.js";
import { defineElement } from "../../src/element.js";
import { buildToolbar } from "../../src/toolbar.js";
import { installMobile, mobileView, MobileView } from "../../src/mobile.js";
import { cleanup, frame, mount } from "./support.js";

afterEach(() => {
  cleanup();
  Gantt.extensions.length = 0;
  document.documentElement.style.overflow = "";
});

/** Mounts the 14-row office fit-out in the timeline layout, as the website does. */
/**
 * Whether this browser can build synthetic touches. Desktop Firefox has no
 * `TouchEvent` and desktop WebKit refuses `new Touch()`, so pinch zoom (which
 * listens for touch events) is only exercised where touches exist.
 */
function canConstructTouches() {
  try {
    new Touch({ identifier: 0, target: document.body });
    return typeof TouchEvent === "function";
  } catch {
    return false;
  }
}

function mountSample(options = {}) {
  return mount(structuredClone(officeFitOut), {
    layout: "timeline",
    fit: "width",
    markers: { today: false, dataDate: false, contractCompletion: false },
    ...options,
  });
}

async function settle() {
  await frame();
  await frame();
}

describe("the phone summary below the breakpoint", () => {
  test("replaces the chart with one readable row per task and an open button", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    const layouts = [];
    gantt.on("layout-change", (event) => layouts.push(event));
    const mobile = mobileView(gantt);
    await settle();
    expect(mobile.mode).toBe("preview");
    expect(gantt.root.hidden).toBe(true);
    expect(getComputedStyle(gantt.root).display).toBe("none");
    const preview = host.querySelector(".sg-preview");
    expect(preview.hidden).toBe(false);
    expect(preview.getAttribute("aria-label")).toBe("Programme summary");
    const items = preview.querySelectorAll(".sg-preview-list > li");
    expect(items).toHaveLength(14);
    expect(preview.querySelector(".sg-preview-range").textContent).toBe("1 Mar 2027 to 7 May 2027");
    const first = items[0].querySelector(".sg-preview-task");
    expect(first.querySelector(".sg-preview-dates").textContent).toBe("1 Mar – 2 Mar · 2 days");
    expect(first.getAttribute("aria-label")).toContain("Site set-up and protection");
    const payment = preview.querySelector('[data-task-id="pay-strip"]');
    expect(payment.querySelector(".sg-preview-name").textContent).toMatch(/Stage 1.*£/);
    expect(payment.closest("li").className).toContain("sg-preview-payment");
    expect(payment.closest("li").className).not.toContain("sg-type-");
    expect(preview.querySelector(".sg-cta").textContent).toBe("Open the chart");
    expect(layouts.at(-1)).toMatchObject({ mode: "preview", previous: "inline" });
  });

  test("has no inner scroll: the summary grows with its rows", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    mobileView(gantt);
    await settle();
    const preview = host.querySelector(".sg-preview");
    expect(preview.scrollHeight).toBeLessThanOrEqual(preview.clientHeight + 1);
    expect(preview.getBoundingClientRect().height).toBeGreaterThan(14 * 40);
  });

  test("mini bars sit on a shared track in programme order", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    mobileView(gantt);
    await settle();
    const left = (id) =>
      host.querySelector(`[data-task-id="${id}"] .sg-preview-bar`).getBoundingClientRect().left;
    expect(left("setup")).toBeLessThan(left("strip"));
    expect(left("strip")).toBeLessThan(left("snagging"));
    const track = host.querySelector('[data-task-id="pay-handover"] .sg-preview-track');
    const diamond = host.querySelector('[data-task-id="pay-handover"] .sg-preview-bar');
    expect(diamond.getBoundingClientRect().right).toBeLessThanOrEqual(
      track.getBoundingClientRect().right + 3,
    );
  });

  test("updates after an edit and follows the chart's colour scheme and inline theme", async () => {
    const { gantt, host } = mountSample({
      width: "380px",
      colorScheme: "dark",
      theme: { bar: "#0f766e" },
    });
    mobileView(gantt);
    await settle();
    const preview = host.querySelector(".sg-preview");
    expect(preview.classList.contains("sg-scheme-dark")).toBe(true);
    expect(preview.style.getPropertyValue("--sg-bar")).toBe("#0f766e");
    await gantt.updateTask("setup", { duration: 3 });
    expect(preview.querySelector('[data-task-id="setup"] .sg-preview-dates').textContent).toContain(
      "3 days",
    );
  });

  test("switches to the chart when the host widens, and back", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    const modes = [];
    gantt.on("layout-change", (event) => modes.push(event.mode));
    const mobile = mobileView(gantt);
    await settle();
    host.style.width = "900px";
    await settle();
    expect(mobile.mode).toBe("inline");
    expect(gantt.root.hidden).toBe(false);
    expect(host.querySelector(".sg-preview").hidden).toBe(true);
    expect(getComputedStyle(host.querySelector(".sg-preview")).display).toBe("none");
    host.style.width = "380px";
    await settle();
    expect(modes).toEqual(["preview", "inline", "preview"]);
  });

  test("preview: false keeps the chart on narrow hosts", async () => {
    const { gantt } = mountSample({ width: "380px" });
    const mobile = mobileView(gantt, { preview: false });
    await settle();
    expect(mobile.mode).toBe("inline");
    expect(gantt.root.hidden).toBe(false);
  });
});

describe("the inline chart", () => {
  test("gets an expand button, unless expandButton is false", async () => {
    const { gantt } = mountSample();
    mobileView(gantt);
    await settle();
    const expand = gantt.root.querySelector(".sg-expand");
    expect(expand.getAttribute("aria-label")).toBe("Open the chart full screen");
    const other = mountSample();
    mobileView(other.gantt, { expandButton: false });
    expect(other.gantt.root.querySelector(".sg-expand")).toBeNull();
  });
});

describe("full screen", () => {
  test("moves the chart into a modal dialog in the host and fits every row to the height", async () => {
    const { gantt, host } = mountSample({ width: "900px" });
    const events = [];
    gantt.on("fullscreen-change", (event) => events.push(event));
    const mobile = mobileView(gantt);
    await settle();
    gantt.root.querySelector(".sg-expand").focus();
    await mobile.open();
    await settle();
    const sheet = host.querySelector("dialog.sg-sheet");
    expect(sheet.open).toBe(true);
    expect(sheet.matches(":modal")).toBe(true);
    expect(sheet.contains(gantt.root)).toBe(true);
    expect(host.contains(sheet)).toBe(true);
    expect(gantt.root.classList.contains("sg-fullscreen")).toBe(true);
    expect(gantt.root.querySelector(".sg-rail").getAttribute("role")).toBe("toolbar");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(mobile.closeButton);
    expect(gantt.rowHeight).toBeGreaterThanOrEqual(24);
    expect(gantt.rowHeight).toBeLessThanOrEqual(44);
    const fits =
      gantt.rows().length * gantt.rowHeight <= gantt.scroller.clientHeight - gantt.headerHeight;
    if (gantt.rowHeight > 24) expect(fits).toBe(true);
    expect(events.at(-1)).toMatchObject({ open: true, native: false });
    expect(mobile.mode).toBe("fullscreen");
  });

  test("Escape closes it and puts everything back", async () => {
    const { gantt, host } = mountSample({ width: "900px", height: "420px" });
    const mobile = mobileView(gantt);
    await settle();
    const expand = gantt.root.querySelector(".sg-expand");
    expand.focus();
    const rowHeight = gantt.rowHeight;
    await mobile.open();
    const sheet = host.querySelector("dialog.sg-sheet");
    sheet.dispatchEvent(new Event("cancel", { cancelable: true }));
    await settle();
    expect(sheet.open).toBe(false);
    expect(gantt.root.parentElement).toBe(host);
    expect(gantt.root.classList.contains("sg-fullscreen")).toBe(false);
    expect(gantt.root.querySelector(".sg-rail")).toBeNull();
    expect(gantt.root.style.getPropertyValue("--sg-height")).toBe("420px");
    expect(gantt.rowHeight).toBe(rowHeight);
    expect(gantt.fitWidth).toBe(true);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(expand);
    expect(mobile.mode).toBe("inline");
  });

  test("closing from a phone returns to the summary and focuses its button", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    const mobile = mobileView(gantt);
    await settle();
    const scrollY = window.scrollY;
    host.querySelector(".sg-cta").click();
    await settle();
    expect(mobile.opened).toBe(true);
    expect(host.querySelector(".sg-preview").hidden).toBe(false);
    expect(window.scrollY).toBe(scrollY);
    mobile.closeButton.click();
    await settle();
    expect(mobile.mode).toBe("preview");
    expect(gantt.root.hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".sg-cta"));
  });

  test("tapping a summary row opens the chart with that task selected", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    const mobile = mobileView(gantt);
    await settle();
    host.querySelector('.sg-preview-task[data-task-id="decoration"]').click();
    await settle();
    expect(mobile.opened).toBe(true);
    expect(gantt.getSelection()).toEqual(["decoration"]);
  });

  test("zoom in leaves fit-to-width; zoom out returns to it; Fit is pressed when fitted", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    await mobile.open();
    await settle();
    expect(mobile.fitButton.getAttribute("aria-pressed")).toBe("true");
    expect(mobile.zoomOutButton.disabled).toBe(true);
    const fitted = gantt.scale.dayWidth;
    mobile.zoomInButton.click();
    expect(gantt.fitWidth).toBe(false);
    expect(gantt.root.classList.contains("sg-fullscreen")).toBe(true);
    expect(gantt.scale.dayWidth).toBeGreaterThan(fitted);
    expect(mobile.fitButton.getAttribute("aria-pressed")).toBe("false");
    mobile.zoomInButton.click();
    expect(gantt.zoom).toBe("day");
    expect(mobile.zoomInButton.disabled).toBe(true);
    mobile.zoomOutButton.click();
    mobile.zoomOutButton.click();
    expect(gantt.fitWidth).toBe(true);
    mobile.zoomInButton.click();
    mobile.fitButton.click();
    expect(gantt.fitWidth).toBe(true);
  });

  test("zooming in at the finest level stays there instead of fitting", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    await mobile.open();
    gantt.setZoom("day");
    mobile.zoom(-1);
    expect(gantt.fitWidth).toBe(false);
    expect(gantt.zoom).toBe("day");
  });

  test.skipIf(!canConstructTouches())(
    "a two-finger pinch zooms in, and the browser's own pinch is suppressed",
    async () => {
      const { gantt } = mountSample({ width: "900px" });
      const mobile = mobileView(gantt);
      await mobile.open();
      await settle();
      const scroller = gantt.scroller;
      const touch = (id, x) =>
        new Touch({ identifier: id, target: scroller, clientX: x, clientY: 100 });
      scroller.dispatchEvent(
        new TouchEvent("touchstart", { touches: [touch(1, 100), touch(2, 140)], bubbles: true }),
      );
      const move = new TouchEvent("touchmove", {
        touches: [touch(1, 60), touch(2, 200)],
        bubbles: true,
        cancelable: true,
      });
      scroller.dispatchEvent(move);
      expect(move.defaultPrevented).toBe(true);
      expect(gantt.fitWidth).toBe(false);
    },
  );

  test("falls back to the full-viewport dialog when the Fullscreen API refuses", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    const request = vi.fn(() => Promise.reject(new TypeError("no user gesture")));
    mobile.stage.requestFullscreen = request;
    await mobile.open();
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(mobile.sheet.open).toBe(true);
    expect(mobile.sheet.contains(gantt.root)).toBe(true);
    expect(mobile.stage.hasAttribute("role")).toBe(false);
  });

  test('fullscreen: "overlay" never calls the Fullscreen API', async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt, { fullscreen: "overlay" });
    const request = vi.fn(() => Promise.resolve());
    mobile.stage.requestFullscreen = request;
    await mobile.open();
    expect(request).not.toHaveBeenCalled();
    expect(mobile.sheet.open).toBe(true);
  });

  test("closing a zoomed chart restores its zoom, and fit-to-width is used while open", async () => {
    const { gantt } = mountSample({ width: "900px", fit: null, zoom: "day" });
    const mobile = mobileView(gantt);
    await mobile.open();
    expect(gantt.fitWidth).toBe(true);
    mobile.close();
    expect(gantt.fitWidth).toBe(false);
    expect(gantt.zoom).toBe("day");
  });

  test("destroying the mobile view while open restores the chart", async () => {
    const { gantt, host } = mountSample({ width: "900px", height: "420px" });
    const rowHeight = gantt.rowHeight;
    const mobile = mobileView(gantt);
    await mobile.open();
    mobile.zoom(-1);
    mobile.destroy();
    expect(gantt.root.parentElement).toBe(host);
    expect(gantt.rowHeight).toBe(rowHeight);
    expect(gantt.options.rowHeight).toBeUndefined();
    expect(gantt.root.style.getPropertyValue("--sg-height")).toBe("420px");
    expect(gantt.fitWidth).toBe(true);
    expect(document.documentElement.style.overflow).toBe("");
  });

  test("destroying the chart while open removes the dialog and restores the page", async () => {
    const { gantt, host } = mountSample({ width: "380px" });
    const mobile = mobileView(gantt);
    await mobile.open();
    gantt.destroy();
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.querySelector(".sg-preview")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(/** @type {any} */ (gantt).mobile).toBeUndefined();
    mobile.destroy();
  });
});

describe("native fullscreen (the Fullscreen API on the stage)", () => {
  /** Fakes an element-fullscreen browser: request, document.fullscreenElement and exit. */
  function fakeFullscreenApi(mobile) {
    const state = { element: null };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => state.element,
    });
    mobile.stage.requestFullscreen = vi.fn(() => {
      state.element = mobile.stage;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    document.exitFullscreen = vi.fn(() => {
      state.element = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    return state;
  }

  afterEach(() => {
    delete document.fullscreenElement;
    delete document.exitFullscreen;
  });

  test("the stage goes fullscreen as a labelled modal dialog, with the chart fitted", async () => {
    const { gantt, host } = mountSample({ width: "900px", fit: null });
    const events = [];
    gantt.on("fullscreen-change", (event) => events.push(event));
    const mobile = mobileView(gantt);
    fakeFullscreenApi(mobile);
    await mobile.open();
    expect(mobile.stage.requestFullscreen).toHaveBeenCalled();
    expect(mobile.sheet.open).toBe(false);
    expect(mobile.stage.parentElement).toBe(host);
    expect(mobile.stage.contains(gantt.root)).toBe(true);
    expect(mobile.stage.getAttribute("role")).toBe("dialog");
    expect(mobile.stage.getAttribute("aria-modal")).toBe("true");
    expect(mobile.stage.getAttribute("aria-label")).toBe("Programme chart");
    expect(gantt.fitWidth).toBe(true);
    expect(gantt.root.classList.contains("sg-fullscreen")).toBe(true);
    expect(events.at(-1)).toMatchObject({ open: true, native: true });
    expect(gantt.isFullscreen).toBe(true);
  });

  test("focus stays inside, and Escape closes and leaves fullscreen", async () => {
    const { gantt, host } = mountSample({ width: "900px" });
    const outside = document.createElement("button");
    document.body.append(outside);
    const mobile = mobileView(gantt);
    fakeFullscreenApi(mobile);
    await mobile.open();
    outside.focus();
    expect(document.activeElement).toBe(mobile.closeButton);
    mobile.closeButton.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(mobile.opened).toBe(false);
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(gantt.root.parentElement).toBe(host);
    expect(mobile.stage.hidden).toBe(true);
    outside.remove();
  });

  test("leaving fullscreen from the browser closes the chart", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const events = [];
    gantt.on("fullscreen-change", (event) => events.push(event.open));
    const mobile = mobileView(gantt);
    const state = fakeFullscreenApi(mobile);
    await mobile.open();
    state.element = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(mobile.opened).toBe(false);
    expect(events).toEqual([true, false]);
  });

  test("a second toggle while the request is pending closes once it settles", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    const state = fakeFullscreenApi(mobile);
    let grant;
    mobile.stage.requestFullscreen = vi.fn(
      () =>
        new Promise((resolve) => {
          grant = () => {
            state.element = mobile.stage;
            resolve(undefined);
          };
        }),
    );
    const opening = mobile.toggle();
    const closing = mobile.toggle();
    grant();
    await opening;
    await closing;
    expect(mobile.opened).toBe(false);
    expect(state.element).toBeNull();
    expect(gantt.root.classList.contains("sg-fullscreen")).toBe(false);
  });

  test("the landscape lock is asked for only on touch screens", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    fakeFullscreenApi(mobile);
    const lock = vi.fn(() => Promise.resolve());
    screen.orientation.lock = lock;
    try {
      await mobile.open();
      expect(lock).not.toHaveBeenCalled();
      mobile.close();
      vi.spyOn(gantt, "coarsePointer").mockReturnValue(true);
      await mobile.open();
      expect(lock).toHaveBeenCalledWith("landscape");
    } finally {
      delete screen.orientation.lock;
    }
  });
});

describe("the F shortcut and the Gantt API", () => {
  const press = (target, key = "f") =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  test("F toggles full screen from the chart, but not while typing in a field", async () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt);
    const cell = gantt.root.querySelector(".sg-grid [role=gridcell]");
    press(cell);
    await vi.waitFor(() => expect(mobile.sheet.open).toBe(true));
    press(mobile.closeButton, "F");
    await vi.waitFor(() => expect(mobile.opened).toBe(false));
    const input = document.createElement("input");
    gantt.root.append(input);
    press(input);
    expect(mobile.opened).toBe(false);
    mobileView(mountSample({ width: "900px" }).gantt, { shortcut: false });
  });

  test("shortcut: false leaves F alone", () => {
    const { gantt } = mountSample({ width: "900px" });
    const mobile = mobileView(gantt, { shortcut: false });
    press(gantt.root.querySelector(".sg-grid [role=gridcell]"));
    expect(mobile.opened).toBe(false);
    expect(mobile.expand.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  test("enterFullscreen, exitFullscreen, toggleFullscreen and isFullscreen", async () => {
    const { gantt } = mountSample({ width: "900px" });
    await expect(gantt.enterFullscreen()).rejects.toThrow(/streamlined-gantt\/mobile/);
    mobileView(gantt);
    await gantt.enterFullscreen({ taskId: "joinery" });
    expect(gantt.isFullscreen).toBe(true);
    expect(gantt.getSelection()).toEqual(["joinery"]);
    gantt.exitFullscreen();
    expect(gantt.isFullscreen).toBe(false);
    await gantt.toggleFullscreen();
    expect(gantt.isFullscreen).toBe(true);
    await gantt.toggleFullscreen();
    expect(gantt.isFullscreen).toBe(false);
  });

  test("with the built-in toolbar, the button is a labelled Full screen button in it", () => {
    const { gantt } = mountSample({ width: "1100px", toolbar: buildToolbar });
    const mobile = mobileView(gantt);
    const button = gantt.root.querySelector(".sg-toolbar .sg-toolbar-fullscreen");
    expect(button).toBe(mobile.expand);
    expect(button.textContent).toBe("Full screen");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("F");
    expect(gantt.root.querySelector(".sg-expand")).toBeNull();
  });
});

describe("installing", () => {
  test("mobileView is idempotent per chart", () => {
    const { gantt } = mountSample();
    expect(mobileView(gantt)).toBe(mobileView(gantt));
  });

  test("installMobile makes the mobile option and the element's mobile attribute work", async () => {
    installMobile(Gantt);
    installMobile(Gantt);
    expect(Gantt.extensions).toHaveLength(1);
    const withOption = mountSample({ mobile: { breakpoint: 2000 } });
    expect(withOption.gantt.mobile).toBeInstanceOf(MobileView);
    await settle();
    expect(withOption.gantt.mobile.mode).toBe("preview");
    expect(mountSample({ mobile: false }).gantt.mobile).toBeUndefined();
    expect(mountSample().gantt.mobile).toBeUndefined();
    defineElement();
    const element = document.createElement("streamlined-gantt");
    element.setAttribute("mobile", "");
    element.append(
      Object.assign(document.createElement("script"), {
        type: "application/json",
        textContent: JSON.stringify(officeFitOut),
      }),
    );
    document.body.append(element);
    await vi.waitFor(() => expect(element.gantt?.mobile).toBeInstanceOf(MobileView));
    element.remove();
  });
});

describe("the built-in toolbar on a narrow chart", () => {
  test("folds everything after Today behind a More button", async () => {
    const { gantt } = mountSample({ width: "380px", toolbar: buildToolbar });
    const more = gantt.root.querySelector(".sg-toolbar-more");
    const extra = gantt.root.querySelector(".sg-toolbar-extra");
    expect(getComputedStyle(more).display).not.toBe("none");
    expect(getComputedStyle(extra).display).toBe("none");
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(getComputedStyle(extra).display).toBe("flex");
    const wide = mountSample({ width: "1100px", toolbar: buildToolbar });
    expect(getComputedStyle(wide.gantt.root.querySelector(".sg-toolbar-more")).display).toBe(
      "none",
    );
    expect(getComputedStyle(wide.gantt.root.querySelector(".sg-toolbar-extra")).display).toBe(
      "contents",
    );
  });
});
