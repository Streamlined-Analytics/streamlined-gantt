// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/**
 * Development-only static server and mock backend for the examples and the
 * Playwright suite. Node standard library only; never shipped in the package.
 *
 * Usage: node examples/server.mjs [--port 4173]
 *
 * Static routes: /dist/*, /examples/*, /schema/*, /tests/fixtures/*, and
 * /vendor/{htmx,echarts}.min.js (served from node_modules for offline runs).
 * The mock programme API lives in examples/mock-backend.mjs.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./mock-backend.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const STATIC_PREFIXES = ["/dist/", "/examples/", "/schema/", "/tests/fixtures/", "/docs/"];
const VENDOR = {
  "/vendor/htmx.min.js": "node_modules/htmx.org/dist/htmx.min.js",
  "/vendor/echarts.min.js": "node_modules/echarts/dist/echarts.min.js",
};
/** A strict policy: no inline scripts or styles, no eval, same-origin only. */
const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function portFromArgs() {
  const index = process.argv.indexOf("--port");
  if (index === -1) return Number(process.env.PORT || 4173);
  return Number(process.argv[index + 1]);
}

function resolveStaticPath(pathname) {
  if (pathname === "/") return join(ROOT, "examples/index.html");
  if (VENDOR[pathname]) return join(ROOT, VENDOR[pathname]);
  const allowed = STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!allowed) return null;
  const candidate = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!candidate.startsWith(ROOT)) return null;
  return pathname.endsWith("/") ? join(candidate, "index.html") : candidate;
}

async function serveStatic(response, pathname) {
  const path = resolveStaticPath(pathname);
  if (!path) return sendText(response, 404, "Not found");
  try {
    const body = await readFile(path);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...(pathname === "/examples/strict-csp.html"
        ? { "Content-Security-Policy": STRICT_CSP }
        : {}),
    });
    response.end(body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  await serveStatic(response, url.pathname);
});

const port = portFromArgs();
server.listen(port, "127.0.0.1", () => {
  console.log(`streamlined-gantt examples: http://127.0.0.1:${port}/`);
});
