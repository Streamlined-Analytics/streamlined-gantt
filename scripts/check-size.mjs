// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Enforces the gzip size budgets from the spec (core <= 45 KB, CSS <= 6 KB,
 * each IO module <= 10 KB) and prints the measured sizes for the PR log.
 */
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const KB = 1024;
const BUDGETS = [
  { file: "dist/streamlined-gantt.js", limit: 45 * KB },
  { file: "dist/streamlined-gantt.iife.min.js", limit: 46 * KB },
  { file: "dist/streamlined-gantt.css", limit: 6 * KB },
  { file: "dist/engine.js", limit: 15 * KB },
  { file: "dist/io/mspdi.js", limit: 10 * KB },
  { file: "dist/io/csv.js", limit: 10 * KB },
  { file: "dist/print.js", limit: 10 * KB },
];

let failed = false;
const rows = [];
for (const { file, limit } of BUDGETS) {
  const source = await readFile(file);
  const gzipped = gzipSync(source, { level: 9 }).length;
  const over = gzipped > limit;
  failed ||= over;
  rows.push({
    file,
    "raw KB": (source.length / KB).toFixed(1),
    "gzip KB": (gzipped / KB).toFixed(2),
    "budget KB": (limit / KB).toFixed(0),
    status: over ? "OVER" : "ok",
  });
}
console.table(rows);
if (failed) {
  console.error("One or more bundles exceed their gzip budget.");
  process.exit(1);
}
