// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Checks what `npm pack` would publish (the package is private and is not
 * published; this keeps it publishable): the file list matches the committed
 * snapshot in tests/pack/files.txt, no runtime dependencies are declared, and
 * publint and attw (ESM-only profile; the CSS entry is not JavaScript) pass.
 * `--update` rewrites the snapshot.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const SNAPSHOT = new URL("../tests/pack/files.txt", import.meta.url);
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const [packed] = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]));
const files = packed.files
  .map((file) => file.path)
  .filter((path) => !path.endsWith(".map"))
  .sort()
  .join("\n");

if (process.argv.includes("--update")) {
  await writeFile(SNAPSHOT, `${files}\n`);
  console.log(`Wrote ${packed.files.length} paths to tests/pack/files.txt`);
} else {
  const expected = (await readFile(SNAPSHOT, "utf8")).trim();
  if (expected !== files) {
    console.error(
      "The packed file list changed. Review it, then run: node scripts/pack-smoke.mjs --update",
    );
    process.exit(1);
  }
}

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.peerDependencies ?? {}).length) {
  console.error("streamlined-gantt must have no runtime dependencies");
  process.exit(1);
}
run("npx", ["publint", "--strict"]);
run("npx", [
  "attw",
  "--pack",
  ".",
  "--profile",
  "esm-only",
  "--exclude-entrypoints",
  "./css",
  "--format",
  "ascii",
]);
console.log(
  `Pack smoke passed: ${packed.files.length} files, ${(packed.size / 1024).toFixed(0)} KB packed.`,
);
