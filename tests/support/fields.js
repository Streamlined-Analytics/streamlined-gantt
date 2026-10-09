// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/** The custom fields used by the flat-roof fixture and the examples. */
export const FLAT_ROOF_FIELDS = [
  { key: "cost", label: "Cost", type: "currency", rollup: "sum", min: 0, column: { width: 90 } },
  { key: "charge", label: "Charge", type: "currency", rollup: "sum", min: 0, column: true },
  { key: "qty", label: "Qty", type: "number", unit: "m²", step: 0.5, rollup: "sum" },
  {
    key: "profit",
    label: "Profit",
    type: "currency",
    readOnly: true,
    compute: (task) => (task.fields.charge ?? 0) - (task.fields.cost ?? 0),
    rollup: "sum",
  },
  {
    key: "margin",
    label: "Margin %",
    type: "percent",
    readOnly: true,
    column: true,
    compute: (task) =>
      task.fields.charge
        ? (task.fields.charge - (task.fields.cost ?? 0)) / task.fields.charge
        : null,
    rollup: (rows, sums) => (sums.charge ? (sums.charge - sums.cost) / sums.charge : null),
  },
  { key: "supplier", label: "Supplier", type: "select", options: ["Own labour", "Sub", "Hire"] },
];
