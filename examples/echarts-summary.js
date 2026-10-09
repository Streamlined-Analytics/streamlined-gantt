// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Streamlined Analytics Ltd and contributors

import { Gantt } from "/dist/streamlined-gantt.js";
import { builtinEditor } from "/dist/editor.js";
import { FLAT_ROOF_FIELDS } from "/examples/fields.js";

const data = await (await fetch("/examples/data/flat-roof.json")).json();
const gantt = new Gantt(document.getElementById("programme"), {
  editor: builtinEditor,
  data,
  fields: FLAT_ROOF_FIELDS,
  zoom: "week",
  height: "420px",
  today: () => "2026-11-09",
});
window.gantt = gantt;
window.summaryRenders = { change: 0, preview: 0 };

const echarts = window.echarts;
const cashflow = echarts.init(document.getElementById("cashflow"));
const weekly = echarts.init(document.getElementById("weekly"));

/** Reads a library colour token so the charts follow the page theme. */
function token(name, fallback) {
  return getComputedStyle(gantt.root).getPropertyValue(name).trim() || fallback;
}

function kpiRows(summary) {
  const money = gantt.formatMoney;
  const margin =
    summary.derived.margin === null ? "–" : `${(summary.derived.margin * 100).toFixed(1)}%`;
  const float = summary.terminalFloat === null ? "–" : `${summary.terminalFloat} working days`;
  const nextPayment = summary.payments.find((payment) => payment.date >= "2026-11-09");
  return [
    ["Duration", `${summary.workingDays} working days (${summary.start} to ${summary.finish})`],
    ["Total cost", money(summary.sums.cost)],
    ["Total charge", money(summary.sums.charge)],
    ["Profit", `${money(summary.derived.profit)} (${margin})`],
    ["Float to completion date", float],
    [
      "Next stage payment",
      nextPayment ? `${money(nextPayment.value)} on ${nextPayment.date}` : "–",
    ],
  ];
}

function render(preview) {
  const summary = gantt.getProjectSummary({ bucket: "week", preview });
  window.summaryRenders[preview ? "preview" : "change"] += 1;
  document.getElementById("kpis").replaceChildren(
    ...kpiRows(summary).map(([label, value]) => {
      const row = document.createElement("tr");
      const heading = Object.assign(document.createElement("th"), {
        scope: "row",
        textContent: label,
      });
      row.append(heading, Object.assign(document.createElement("td"), { textContent: value }));
      return row;
    }),
  );
  const series = summary.series;
  const pounds = (values) => values.map((minor) => minor / 100);
  const cashPosition = series.paymentsCumulative.map(
    (paid, index) => (paid - series.costCumulative[index]) / 100,
  );
  cashflow.setOption({
    animation: !preview,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => gantt.formatMoney(Math.round(value * 100)),
    },
    legend: { top: 0 },
    grid: { left: 70, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: series.buckets.map((bucket) => `w/c ${bucket.slice(8)}/${bucket.slice(5, 7)}`),
    },
    yAxis: { type: "value", axisLabel: { formatter: (value) => `£${(value / 1000).toFixed(0)}k` } },
    series: [
      {
        name: "Cost (cumulative)",
        type: "line",
        data: pounds(series.costCumulative),
        color: token("--sg-bar", "#2563eb"),
      },
      {
        name: "Stage payments (cumulative)",
        type: "line",
        step: "end",
        data: pounds(series.paymentsCumulative),
        color: token("--sg-payment", "#d97706"),
      },
      {
        name: "Cash position",
        type: "bar",
        data: cashPosition,
        color: token("--sg-baseline", "#9ca3af"),
      },
    ],
  });
  weekly.setOption({
    animation: !preview,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => gantt.formatMoney(Math.round(value * 100)),
    },
    legend: { top: 0 },
    grid: { left: 70, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: series.buckets.map((bucket) => `w/c ${bucket.slice(8)}/${bucket.slice(5, 7)}`),
    },
    yAxis: { type: "value", axisLabel: { formatter: (value) => `£${(value / 1000).toFixed(0)}k` } },
    series: [
      { name: "Cost", type: "bar", data: pounds(series.cost), color: token("--sg-bar", "#2563eb") },
      {
        name: "Charge",
        type: "bar",
        data: pounds(series.charge),
        color: token("--sg-completion", "#15803d"),
      },
    ],
  });
}

render(false);
gantt.on("change", () => render(false));
gantt.on("drag-move", () => render(true));
gantt.on("drag-end", (event) => {
  if (event.cancelled) render(false);
});
window.addEventListener("resize", () => {
  cashflow.resize();
  weekly.resize();
});
document.body.dataset.ready = "true";
