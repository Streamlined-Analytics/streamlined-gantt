// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/** The library version, replaced at build time from package.json. */
export const VERSION = typeof __SG_VERSION__ === "string" ? __SG_VERSION__ : "0.0.0-dev";
