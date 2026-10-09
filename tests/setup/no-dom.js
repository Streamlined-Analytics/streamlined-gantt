// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

if (typeof globalThis.document !== "undefined" || typeof globalThis.window !== "undefined") {
  throw new Error("The engine test project must run without DOM globals.");
}
