// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Fails when any built bundle lost its licence banner, or when the NOTICE and
 * LICENSE files a redistributor must carry are missing.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const BANNER_PREFIX = "/*! streamlined-gantt v";
const REQUIRED_FILES = { LICENSE: "Apache License", NOTICE: "Streamlined Analytics Ltd" };

async function listBundles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "types" ? [] : listBundles(path);
      return /\.(m?js|css)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

const problems = [];
for (const [file, phrase] of Object.entries(REQUIRED_FILES)) {
  const text = await readFile(file, "utf8").catch(() => "");
  if (!text.includes(phrase)) problems.push(`${file} is missing or does not mention "${phrase}"`);
}

await stat("dist").catch(() => problems.push("dist/ does not exist: run npm run build first"));
const bundles = problems.length ? [] : await listBundles("dist");
if (!problems.length && bundles.length === 0) problems.push("dist/ contains no bundles");
for (const bundle of bundles) {
  const head = (await readFile(bundle, "utf8")).slice(0, 200);
  if (!head.startsWith(BANNER_PREFIX)) problems.push(`${bundle} does not start with the banner`);
  if (!head.includes("Apache-2.0")) problems.push(`${bundle} banner does not name Apache-2.0`);
}

if (problems.length) {
  console.error(problems.map((problem) => `  - ${problem}`).join("\n"));
  process.exit(1);
}
console.log(`Licence banner present in ${bundles.length} bundles; LICENSE and NOTICE present.`);
