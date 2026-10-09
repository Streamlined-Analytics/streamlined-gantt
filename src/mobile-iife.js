// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { installMobile } from "./ui/mobile.js";

export * from "./mobile.js";

const global = /** @type {any} */ (globalThis).StreamlinedGantt;
if (global?.Gantt?.extensions) installMobile(global.Gantt);
