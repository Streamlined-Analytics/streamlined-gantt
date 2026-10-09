// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { toDay } from "../engine/dates.js";
import { formatDate, formatMoney } from "../engine/format.js";
import { buildColumns } from "../ui/columns.js";
import { SVG_NS, px, svg } from "../ui/dom.js";
import { linkPath } from "../ui/link-path.js";
import { TimeScale } from "../ui/scale.js";
import { barShape, linkColour, milestoneShape, summaryShape } from "../ui/timeline-view.js";

/**
 * Print and export (`streamlined-gantt/print`): a non-virtualised document
 * renderer that draws the whole programme (or the current lookahead or
 * filter) as one standalone SVG, with grid columns as text, the timeline, a
 * legend and a drawing-style title block. The same SVG backs `print()` (A3 or
 * A4, fitted to the page width), `exportPNG()` and server-side PDF (headless
 * Chrome loads the page and prints it).
 *
 * Colours are resolved from the chart's CSS custom properties at export time
 * and written into the SVG, so the file is standalone and follows the theme.
 *
 * @example
 * import { installPrint } from "streamlined-gantt/print";
 * installPrint(Gantt);
 * gantt.print({ paper: "A3", titleBlock: { client: "Main Co Ltd", drawnBy: "JS" } });
 *
 * @module streamlined-gantt/print
 */

/**
 * @typedef {object} TitleBlock
 * @property {string} [project]
 * @property {string} [client]
 * @property {string} [revision]
 * @property {string} [date]
 * @property {string} [drawnBy]
 * @property {string} [status]
 * @property {string} [notes]
 * @property {string} [logo] image URL; use a data: URL to keep the SVG standalone
 */

/**
 * @typedef {object} DocumentOptions
 * @property {"A3"|"A4"} [paper] default "A3"
 * @property {"landscape"|"portrait"} [orientation] default "landscape"
 * @property {(string|import("../ui/columns.js").ColumnConfig)[]} [columns] default WBS, name, start, finish, duration
 * @property {import("../ui/scale.js").ZoomLevel} [zoom] default chosen from the programme's length
 * @property {{from: string, to: string}} [range] limit the timeline to dates
 * @property {TitleBlock|false} [titleBlock]
 * @property {boolean} [legend] default true
 * @property {number} [rowHeight] default 22
 */

const TOKENS = [
  "--sg-bg",
  "--sg-fg",
  "--sg-muted",
  "--sg-grid-line",
  "--sg-header-bg",
  "--sg-bar",
  "--sg-bar-progress",
  "--sg-bar-critical",
  "--sg-summary",
  "--sg-milestone",
  "--sg-payment",
  "--sg-access",
  "--sg-need-by",
  "--sg-reference",
  "--sg-baseline",
  "--sg-link",
  "--sg-weekend",
  "--sg-holiday",
  "--sg-today",
  "--sg-data-date",
  "--sg-completion",
  "--sg-key-date",
  "--sg-delay",
  "--sg-progress-overlay",
  "--sg-bar-critical-stroke",
  "--sg-payment-stroke",
  "--sg-bar-label",
];
const HEADER = 44;
const FOOTER = 120;
const CHAR_WIDTH = 6.3;

/**
 * Resolves the theme's custom properties to literal colours.
 * @param {HTMLElement} root
 * @returns {Record<string, string>}
 */
export function resolveColours(root) {
  const resolve = colourResolver(root);
  /** @type {Record<string, string>} */
  const colours = {};
  for (const token of TOKENS) colours[token] = resolve(`var(${token})`);
  colours.font = getComputedStyle(root).fontFamily || "sans-serif";
  return colours;
}

/**
 * A function resolving any CSS colour expression (tokens, `color-mix()`,
 * category colours) in the chart's context to a literal colour, so the
 * exported SVG stands alone. Results are cached.
 * @param {HTMLElement} root
 * @returns {(expression: string) => string}
 */
export function colourResolver(root) {
  /** @type {Map<string, string>} */
  const cache = new Map();
  return (expression) => {
    if (!cache.has(expression)) {
      const probe = document.createElement("span");
      probe.style.setProperty("color", expression);
      root.append(probe);
      cache.set(expression, getComputedStyle(probe).color);
      probe.remove();
    }
    return /** @type {string} */ (cache.get(expression));
  };
}

/**
 * @param {Record<string, string>} c
 * @returns {string}
 */
function stylesheet(c) {
  return `
text{font-family:${c.font};font-size:11px;fill:${c["--sg-fg"]}}
.h{font-weight:600}.m{fill:${c["--sg-muted"]}}.s{font-size:9px}
.bg{fill:${c["--sg-bg"]}}.hdr{fill:${c["--sg-header-bg"]}}
.line{stroke:${c["--sg-grid-line"]};stroke-width:1}
.sg-nonworking{fill:${c["--sg-weekend"]}}.sg-nonworking-bank-holiday,.sg-nonworking-shutdown{fill:${c["--sg-holiday"]}}
.sg-bar{fill:${c["--sg-bar"]}}.sg-progress{fill:${c["--sg-bar-progress"]}}
.sg-critical .sg-bar{fill:${c["--sg-bar-critical"]};stroke:${c["--sg-bar-critical-stroke"]};stroke-width:1;stroke-dasharray:5 2}
.sg-summary-shape{fill:${c["--sg-summary"]}}.sg-milestone{fill:${c["--sg-milestone"]}}
.sg-milestone.sg-payment{fill:${c["--sg-payment"]};stroke:${c["--sg-payment-stroke"]}}.sg-flag{fill:${c["--sg-access"]};stroke:${c["--sg-access"]};stroke-width:1.5}
.sg-flag.sg-need-by{fill:${c["--sg-need-by"]};stroke:${c["--sg-need-by"]}}.sg-bar.sg-reference{fill:${c["--sg-reference"]}}
.sg-baseline{fill:${c["--sg-baseline"]}}.sg-link-line{fill:none;stroke:${c["--sg-link"]};stroke-width:1}
.arrow{fill:${c["--sg-link"]}}.sg-critical-pattern rect{fill:${c["--sg-progress-overlay"]}}
.mk-today{stroke:${c["--sg-today"]};stroke-dasharray:4 3}.mk-data-date{stroke:${c["--sg-data-date"]}}
.mk-completion{stroke:${c["--sg-completion"]};stroke-width:2}.mk-key-date{stroke:${c["--sg-key-date"]};stroke-dasharray:2 2}
.sg-delay{fill:${c["--sg-delay"]};opacity:.3}`;
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function fit(text, width) {
  const room = Math.max(1, Math.floor((width - 8) / CHAR_WIDTH));
  return text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`;
}

/**
 * @param {number} days
 * @returns {import("../ui/scale.js").ZoomLevel}
 */
function zoomFor(days) {
  if (days <= 42) return "day";
  if (days <= 240) return "week";
  if (days <= 900) return "month";
  return "quarter";
}

/**
 * Builds the document SVG element.
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {DocumentOptions} [options]
 * @returns {SVGSVGElement}
 */
export function buildDocument(gantt, options = {}) {
  const rows = gantt.rows();
  const rowHeight = options.rowHeight ?? 22;
  const columns = buildColumns(options.columns ?? ["wbs", "name", "start", "finish", "duration"], {
    locale: gantt.options.locale,
    currency: gantt.currency,
    strings: gantt.strings,
    fields: gantt.fields,
    hidden: gantt.options.hiddenColumns,
  });
  const scale = documentScale(gantt, rows, options);
  const gridWidth = columns.reduce((total, column) => total + column.width, 0);
  const width = gridWidth + scale.width;
  const bodyHeight = rows.length * rowHeight;
  const height =
    HEADER + bodyHeight + (options.legend === false && options.titleBlock === false ? 8 : FOOTER);
  const root = /** @type {SVGSVGElement} */ (
    svg("svg", {
      xmlns: SVG_NS,
      width: px(width),
      height,
      viewBox: `0 0 ${px(width)} ${height}`,
      role: "img",
      "aria-label": gantt.store.data.name ?? "Programme",
    })
  );
  const style = svg("style");
  const colours = resolveColours(gantt.root);
  style.textContent = stylesheet(colours);
  root.append(
    style,
    svg("defs", {}, [
      svg(
        "marker",
        {
          id: "doc-arrow",
          viewBox: "0 0 8 8",
          refX: 7,
          refY: 4,
          markerWidth: 6,
          markerHeight: 6,
          orient: "auto-start-reverse",
        },
        [svg("path", { class: "arrow", d: "M0 0 L8 4 L0 8 z" })],
      ),
      svg(
        "pattern",
        {
          id: "doc-critical",
          class: "sg-critical-pattern",
          width: 8,
          height: 8,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(-45)",
        },
        [svg("rect", { width: 3, height: 8 })],
      ),
    ]),
    svg("rect", { class: "bg", x: 0, y: 0, width: px(width), height }),
  );
  const resolve = colourResolver(gantt.root);
  const context = { gantt, rows, rowHeight, columns, scale, gridWidth, width, bodyHeight, resolve };
  drawGrid(root, context);
  drawTimeline(root, context);
  const footerTop = HEADER + bodyHeight + 16;
  if (options.legend !== false) root.append(legend(gantt, footerTop));
  if (options.titleBlock !== false)
    root.append(titleBlock(gantt, options.titleBlock ?? {}, width, footerTop));
  return root;
}

/**
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {import("../ui/columns.js").Row[]} rows
 * @param {DocumentOptions} options
 * @returns {TimeScale}
 */
function documentScale(gantt, rows, options) {
  const days = rows
    .filter((row) => row.dates)
    .flatMap((row) => [row.dates.start, row.dates.finish]);
  const data = gantt.store.data;
  for (const date of [data.contractCompletion, data.dataDate]) if (date) days.push(toDay(date));
  if (options.range) days.push(toDay(options.range.from), toDay(options.range.to));
  const start = options.range ? toDay(options.range.from) : Math.min(...days);
  const finish = options.range ? toDay(options.range.to) : Math.max(...days);
  const zoom = options.zoom ?? zoomFor(finish - start + 1);
  return new TimeScale({
    zoom,
    start,
    finish,
    locale: gantt.options.locale,
    strings: gantt.strings,
    padDays: 3,
  });
}

/**
 * @param {SVGElement} root
 * @param {any} context
 */
function drawGrid(root, context) {
  const { rows, rowHeight, columns, gridWidth, bodyHeight } = context;
  const group = svg("g", { class: "grid" });
  group.append(svg("rect", { class: "hdr", x: 0, y: 0, width: gridWidth, height: HEADER }));
  let x = 0;
  for (const column of columns) {
    group.append(svg("text", { class: "h", x: px(x + 4), y: HEADER - 8 }, [column.title]));
    x += column.width;
  }
  rows.forEach((row, index) => {
    const y = HEADER + index * rowHeight;
    let left = 0;
    for (const column of columns) {
      const indent = column.tree ? (row.level - 1) * 12 : 0;
      const text = fit(column.text(row), column.width - indent);
      const anchorEnd = column.align === "end";
      group.append(
        svg(
          "text",
          {
            class: row.summary ? "h" : null,
            x: px(anchorEnd ? left + column.width - 4 : left + 4 + indent),
            y: px(y + rowHeight / 2 + 4),
            "text-anchor": anchorEnd ? "end" : null,
          },
          [text],
        ),
      );
      left += column.width;
    }
    group.append(
      svg("line", {
        class: "line",
        x1: 0,
        x2: px(context.width),
        y1: px(y + rowHeight),
        y2: px(y + rowHeight),
      }),
    );
  });
  group.append(
    svg("line", { class: "line", x1: gridWidth, x2: gridWidth, y1: 0, y2: HEADER + bodyHeight }),
  );
  root.append(group);
}

/**
 * @param {SVGElement} root
 * @param {any} context
 */
function drawTimeline(root, context) {
  const { gantt, rows, rowHeight, scale, gridWidth, bodyHeight } = context;
  const timeline = svg("g", { transform: `translate(${gridWidth} 0)` });
  timeline.append(
    svg("rect", { class: "hdr", x: 0, y: 0, width: px(scale.width), height: HEADER }),
  );
  for (const [tier, top] of /** @type {[string, number][]} */ ([
    ["top", 0],
    ["bottom", HEADER / 2],
  ])) {
    for (const tick of scale.ticks(/** @type {"top"|"bottom"} */ (tier))) {
      timeline.append(
        svg("line", {
          class: "line",
          x1: px(tick.x),
          x2: px(tick.x),
          y1: top,
          y2: tier === "bottom" ? HEADER + bodyHeight : top + HEADER / 2,
        }),
      );
      timeline.append(
        svg("text", { class: tier === "top" ? "h s" : "s", x: px(tick.x + 3), y: top + 15 }, [
          fit(tick.label, tick.width + 6),
        ]),
      );
    }
  }
  const body = svg("g", { transform: `translate(0 ${HEADER})` });
  if (scale.dayWidth >= 6) {
    for (let day = scale.start; day < scale.end; day += 1) {
      if (gantt.calendar.isWorkingDayNumber(day)) continue;
      const kind = gantt.calendar.nonWorkingReason(day)?.kind;
      body.append(
        svg("rect", {
          class: `sg-nonworking${kind ? ` sg-nonworking-${kind}` : ""}`,
          x: px(scale.x(day)),
          y: 0,
          width: px(scale.dayWidth),
          height: bodyHeight,
        }),
      );
    }
  }
  for (const marker of gantt.markerLines(scale)) {
    body.append(
      svg("line", {
        class: `mk-${marker.kind}`,
        x1: px(marker.x),
        x2: px(marker.x),
        y1: 0,
        y2: bodyHeight,
      }),
    );
  }
  const index = new Map(rows.map((row, position) => [row.id, position]));
  const frame = { scale, rowHeight };
  const geometry = (row, position) => gantt.timeline.geometry(row, position, frame);
  for (const link of gantt.store.list("links")) {
    const from = index.get(link.from);
    const to = index.get(link.to);
    if (from === undefined || to === undefined) continue;
    const d = linkPath(link.type ?? "FS", geometry(rows[from], from), geometry(rows[to], to), {
      rowHeight,
      stub: 6,
    });
    const line = svg("path", { class: "sg-link-line", d, "marker-end": "url(#doc-arrow)" });
    const colour = linkColour(link);
    if (colour) line.style.setProperty("stroke", context.resolve(colour));
    body.append(line);
  }
  const baseline = gantt.visibleBaseline();
  rows.forEach((row, position) => {
    if (!row.dates) return;
    const shape = geometry(row, position);
    const dates = baseline?.tasks?.[row.id];
    if (dates)
      body.append(
        svg("rect", {
          class: "sg-baseline",
          x: px(scale.x(toDay(dates.start))),
          y: px(shape.top + shape.height + 1),
          width: px(Math.max(scale.x(toDay(dates.finish) + 1) - scale.x(toDay(dates.start)), 2)),
          height: 2,
        }),
      );
    const critical = gantt.showCriticalPath && row.schedule?.critical;
    const group = svg("g", { class: critical ? "sg-critical" : null });
    if (row.summary) group.append(...summaryShape(shape));
    else if (row.milestone) group.append(milestoneShape(row.task.type ?? "milestone", shape));
    else group.append(...barShape(row, shape, undefined, critical ? "doc-critical" : null));
    if (!critical) paintCustomColour(group, gantt.appearanceOf(row.task).colour, context.resolve);
    const label =
      row.task.type === "payment" && typeof row.task.value === "number"
        ? `${row.task.name} · ${formatMoney(row.task.value, { locale: gantt.options.locale, currency: gantt.currency })}`
        : "";
    if (label)
      group.append(
        svg("text", { class: "s", x: px(shape.right + 5), y: px(shape.y + 3) }, [label]),
      );
    body.append(group);
  });
  timeline.append(body);
  root.append(timeline);
}

/**
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {number} top
 * @returns {SVGElement}
 */
function legend(gantt, top) {
  const s = gantt.strings;
  const group = svg("g", { class: "legend", transform: `translate(8 ${top})` });
  group.append(svg("text", { class: "h", x: 0, y: 0 }, [s.legend]));
  const entries = [
    ["bar", s.legendTask],
    ["critical", s.critical],
    ["summary", s.summary],
    ["milestone", s.milestone],
    ["payment", s.payment],
    ["baseline", s.legendBaseline],
    ["mk-data-date", s.dataDate],
    ["mk-completion", s.contractCompletion],
  ];
  entries.forEach(([kind, label], position) => {
    const x = (position % 4) * 150;
    const y = 18 + Math.floor(position / 4) * 22;
    group.append(legendSwatch(kind, x, y), svg("text", { x: x + 30, y: y + 4 }, [label]));
  });
  return group;
}

/**
 * @param {string} kind
 * @param {number} x
 * @param {number} y
 * @returns {SVGElement}
 */
function legendSwatch(kind, x, y) {
  const box = { left: x, right: x + 22, top: y - 5, height: 10, y, point: false };
  if (kind === "milestone" || kind === "payment")
    return milestoneShape(kind === "payment" ? "payment" : "milestone", {
      ...box,
      left: x + 6,
      right: x + 16,
      height: 10,
      point: true,
    });
  if (kind === "summary") return svg("g", {}, summaryShape({ ...box, height: 5 }));
  if (kind === "baseline")
    return svg("rect", { class: "sg-baseline", x, y: y - 1, width: 22, height: 3 });
  if (kind.startsWith("mk-"))
    return svg("line", { class: kind, x1: x + 11, x2: x + 11, y1: y - 8, y2: y + 8 });
  return svg("g", { class: kind === "critical" ? "sg-critical" : null }, [
    svg("rect", { class: "sg-bar", x, y: y - 5, width: 22, height: 10, rx: 2 }),
  ]);
}

/**
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {TitleBlock} block
 * @param {number} width
 * @param {number} top
 * @returns {SVGElement}
 */
function titleBlock(gantt, block, width, top) {
  const data = gantt.store.data;
  const locale = gantt.options.locale;
  const boxWidth = 380;
  const left = Math.max(width - boxWidth - 8, 620);
  const fields = [
    ["Project", block.project ?? data.name ?? ""],
    ["Client", block.client ?? String(data.fields?.client ?? "")],
    [
      "Revision",
      block.revision ?? [data.revision?.code, data.revision?.note].filter(Boolean).join(" – "),
    ],
    ["Date", block.date ?? formatDate(toDay(data.revision?.date ?? gantt.todayISO()), locale)],
    ["Drawn by", block.drawnBy ?? data.revision?.author ?? ""],
    ["Status", block.status ?? ""],
  ];
  const group = svg("g", { class: "title-block", transform: `translate(${left} ${top - 8})` });
  group.append(
    svg("rect", {
      x: 0,
      y: 0,
      width: boxWidth,
      height: 104,
      fill: "none",
      class: "line",
      stroke: "currentColor",
    }),
  );
  const textLeft = block.logo ? 96 : 8;
  if (block.logo)
    group.append(
      svg("image", {
        href: block.logo,
        x: 8,
        y: 8,
        width: 80,
        height: 88,
        preserveAspectRatio: "xMidYMid meet",
      }),
    );
  fields.forEach(([label, value], position) => {
    const y = 18 + position * 15;
    group.append(
      svg("text", { class: "m s", x: textLeft, y }, [label]),
      svg("text", { x: textLeft + 64, y }, [fit(String(value), boxWidth - textLeft - 72)]),
    );
  });
  if (block.notes)
    group.append(
      svg("text", { class: "s", x: textLeft, y: 100 }, [fit(block.notes, boxWidth - textLeft - 8)]),
    );
  return group;
}

/**
 * Gives a task's shapes its custom colour (category, `style.color` or
 * `taskStyle`) as literal fills, as the screen does with `--sg-task-color`.
 * @param {SVGElement} group
 * @param {string|null} colour
 * @param {(expression: string) => string} resolve
 */
function paintCustomColour(group, colour, resolve) {
  if (!colour) return;
  const fill = resolve(colour);
  for (const shape of group.querySelectorAll(".sg-bar, .sg-milestone, .sg-summary-shape")) {
    /** @type {SVGElement} */ (shape).style.setProperty("fill", fill);
  }
  for (const flag of group.querySelectorAll(".sg-flag")) {
    /** @type {SVGElement} */ (flag).style.setProperty("fill", fill);
    /** @type {SVGElement} */ (flag).style.setProperty("stroke", fill);
  }
  const progress = resolve(`color-mix(in oklab, ${colour} 62%, var(--sg-shade))`);
  for (const bar of group.querySelectorAll(".sg-progress")) {
    /** @type {SVGElement} */ (bar).style.setProperty("fill", progress);
  }
}

/**
 * The programme as a standalone SVG string.
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function toSVG(gantt, options) {
  return new XMLSerializer().serializeToString(buildDocument(gantt, options));
}

/**
 * Renders the programme to a PNG Blob.
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {DocumentOptions & {scale?: number}} [options]
 * @returns {Promise<Blob>}
 */
export async function exportPNG(gantt, options = {}) {
  const element = buildDocument(gantt, options);
  const width = Number(element.getAttribute("width"));
  const height = Number(element.getAttribute("height"));
  const scale = options.scale ?? 2;
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.fillStyle = colourResolver(gantt.root)("var(--sg-bg)");
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The print document as HTML: the SVG fitted to the page width, with an
 * `@page` rule for the paper size. Used by `print()` and by server-side PDF.
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function printDocumentHTML(gantt, options = {}) {
  const paper = options.paper ?? "A3";
  const orientation = options.orientation ?? "landscape";
  const title = gantt.store.data.name ?? "Programme";
  const escapedTitle = title.replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
  );
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapedTitle}</title><style>@page{size:${paper} ${orientation};margin:8mm}html,body{margin:0;background:${colourResolver(gantt.root)("var(--sg-bg)")}}svg{display:block;width:100%;height:auto}</style></head><body>${toSVG(gantt, options)}</body></html>`;
}

/**
 * Prints the programme on its own page (A3 landscape by default), fitted to
 * the page width. Resolves once the print dialog has been shown.
 * @param {import("../ui/gantt.js").Gantt} gantt
 * @param {DocumentOptions} [options]
 * @returns {Promise<void>}
 */
export function printProgramme(gantt, options = {}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.setProperty("position", "fixed");
  frame.style.setProperty("width", "0");
  frame.style.setProperty("height", "0");
  frame.style.setProperty("border", "0");
  frame.srcdoc = printDocumentHTML(gantt, options);
  document.body.append(frame);
  return new Promise((resolve) => {
    frame.addEventListener(
      "load",
      () => {
        frame.contentWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
        frame.contentWindow.focus();
        frame.contentWindow.print();
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Adds `print()`, `toSVG()`, `exportPNG()` and `printDocumentHTML()` to a Gantt class.
 * @param {typeof import("../ui/gantt.js").Gantt} GanttClass
 */
export function installPrint(GanttClass) {
  const prototype = /** @type {any} */ (GanttClass.prototype);
  prototype.print = function print(options) {
    return printProgramme(this, options);
  };
  prototype.toSVG = function svgString(options) {
    return toSVG(this, options);
  };
  prototype.exportPNG = function png(options) {
    return exportPNG(this, options);
  };
  prototype.printDocumentHTML = function printHTML(options) {
    return printDocumentHTML(this, options);
  };
}
