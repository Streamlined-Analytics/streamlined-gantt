// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "coverage/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, __SG_VERSION__: "readonly" },
    },
    rules: {
      "max-depth": ["error", 3],
      complexity: ["error", 20],
      "no-else-return": ["error", { allowElseIf: false }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-implicit-coercion": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-restricted-properties": [
        "error",
        { object: "Element", property: "innerHTML", message: "Render text with textContent." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: "Use textContent or trustedHTML(); innerHTML is reserved for src/ui/dom.js.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=1]",
          message:
            "Use the day-number helpers in src/engine/dates.js; Date parsing drifts with time zones.",
        },
      ],
    },
  },
  {
    files: ["scripts/**", "tests/**", "examples/**/*.mjs", "playwright.config.js", "*.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-restricted-syntax": "off", complexity: "off" },
  },
];
