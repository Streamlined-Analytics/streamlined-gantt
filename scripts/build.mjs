// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Builds every distributable bundle with esbuild.
 *
 * The licence banner is injected through esbuild's `banner` option, which is
 * prepended after minification, so no minifier setting can drop it. The
 * banner check script then asserts every output still starts with it.
 */
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

export const BANNER =
  `/*! streamlined-gantt v${pkg.version} | (c) 2026 Streamlined Analytics Ltd and contributors\n` +
  ` *  Apache-2.0 | https://github.com/Streamlined-Analytics/streamlined-gantt | See NOTICE */`;

const shared = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2022", "safari16.4"],
  legalComments: "inline",
  banner: { js: BANNER, css: BANNER },
  define: { __SG_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
};

const builds = [
  { entryPoints: ["src/index.js"], outfile: "dist/streamlined-gantt.js", format: "esm" },
  {
    entryPoints: ["src/iife.js"],
    outfile: "dist/streamlined-gantt.iife.min.js",
    format: "iife",
    globalName: "StreamlinedGantt",
  },
  { entryPoints: ["src/engine/index.js"], outfile: "dist/engine.js", format: "esm" },
  { entryPoints: ["src/events.js"], outfile: "dist/events.js", format: "esm" },
  { entryPoints: ["src/print/index.js"], outfile: "dist/print.js", format: "esm" },
  {
    entryPoints: ["src/print/iife.js"],
    outfile: "dist/print.iife.min.js",
    format: "iife",
    globalName: "StreamlinedGanttPrint",
  },
  { entryPoints: ["src/io/mspdi.js"], outfile: "dist/io/mspdi.js", format: "esm" },
  {
    entryPoints: ["src/io/mspdi.js"],
    outfile: "dist/io/mspdi.iife.min.js",
    format: "iife",
    globalName: "StreamlinedGanttMSPDI",
  },
  { entryPoints: ["src/css/streamlined-gantt.css"], outfile: "dist/streamlined-gantt.css" },
];

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await Promise.all(builds.map((options) => build({ ...shared, ...options })));
console.log(`Built ${builds.length} bundles for streamlined-gantt v${pkg.version}`);
