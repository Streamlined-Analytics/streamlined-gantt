// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

/** Custom fields shared by the examples: cost, charge, quantity, profit and margin. */
export const FLAT_ROOF_FIELDS = [
  { key: "cost", label: "Cost", type: "currency", rollup: "sum", min: 0, column: { width: 96 } },
  {
    key: "charge",
    label: "Charge",
    type: "currency",
    rollup: "sum",
    min: 0,
    column: { width: 96 },
  },
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
    label: "Margin",
    type: "percent",
    readOnly: true,
    column: { width: 72 },
    compute: (task) =>
      task.fields.charge
        ? (task.fields.charge - (task.fields.cost ?? 0)) / task.fields.charge
        : null,
    rollup: (rows, sums) => (sums.charge ? (sums.charge - sums.cost) / sums.charge : null),
  },
];
