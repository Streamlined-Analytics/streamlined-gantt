// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/** Fails when a source, test, script or example file lacks the SPDX header. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["src", "tests", "scripts", "examples"];
const EXTENSIONS = /\.(js|mjs|css|html|py)$/;
const HEADER = "SPDX-License-Identifier: Apache-2.0";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return EXTENSIONS.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

const files = (await Promise.all(ROOTS.map(walk))).flat();
const missing = [];
for (const file of files) {
  const head = (await readFile(file, "utf8")).split("\n").slice(0, 6).join("\n");
  if (!head.includes(HEADER)) missing.push(file);
}

if (missing.length) {
  console.error(`Missing "${HEADER}" header:\n${missing.map((file) => `  - ${file}`).join("\n")}`);
  process.exit(1);
}
console.log(`SPDX header present in ${files.length} files.`);
