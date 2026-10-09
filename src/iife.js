// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { defineElement } from "./element.js";
import { setDefaultToolbar } from "./ui/gantt.js";
import { buildToolbar } from "./ui/toolbar.js";

export * from "./index.js";
export { buildToolbar };

setDefaultToolbar(buildToolbar);
defineElement();
