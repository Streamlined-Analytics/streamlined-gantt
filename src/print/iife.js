// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { installPrint } from "./index.js";

export * from "./index.js";

const global = /** @type {any} */ (globalThis).StreamlinedGantt;
if (global?.Gantt) installPrint(global.Gantt);
