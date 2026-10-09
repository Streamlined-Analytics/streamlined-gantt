// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * The phone experience, `streamlined-gantt/mobile`: a readable summary in
 * place of the chart on narrow screens, a full-screen landscape chart with a
 * close, zoom and fit rail, rows fitted to the screen height, pinch zoom, and
 * `layout-change` / `fullscreen-change` events (ADR-0011). Optional, so the
 * core stays within its size budget; script-tag users load
 * `dist/mobile.iife.min.js` after the main bundle.
 *
 * @example
 * import { Gantt } from "streamlined-gantt";
 * import { mobileView } from "streamlined-gantt/mobile";
 * const gantt = new Gantt(host, { data, layout: "timeline", fit: "width" });
 * const mobile = mobileView(gantt, { breakpoint: 600 });
 * mobile.open();
 *
 * @module streamlined-gantt/mobile
 */

/** @typedef {import("./ui/mobile.js").MobileOptions} MobileOptions */

export { MOBILE_STRINGS, MobileView, installMobile, mobileView } from "./ui/mobile.js";
