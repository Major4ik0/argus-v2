// Диаграммы дежурств (аналог 4 диаграмм листа «Дежурства»):
//   BarList — ранжированные горизонтальные столбцы одной величины (дежурств/нарядов на человека);
//   Heatmap — «человек × месяц», последовательная шкала одного оттенка (вместо 12-цветных столбцов книги).
// Цвета — эталонная палитра (одна серия: slot 1; последовательная шкала: синий 100→650).

import { Text } from "@mantine/core";

const SERIES_1 = "#2a78d6";
const SEQ = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];

export interface BarItem {
  label: string;
  value: number;
}

export function BarList({ title, items, unit }: { title: string; items: BarItem[]; unit: string }) {
  const sorted = [...items].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ru"));
  const max = Math.max(1, ...sorted.map((i) => i.value));
  return (
    <div className="viz">
      <Text fw={600} mb={6}>
        {title}
      </Text>
      {sorted.map((i) => (
        <div key={i.label} className="viz-bar-row" title={`${i.label}: ${i.value} ${unit}`}>
          <div className="viz-bar-label">{i.label}</div>
          <div className="viz-bar-track">
            {i.value > 0 && <div className="viz-bar" style={{ width: `${(i.value / max) * 100}%`, background: SERIES_1 }} />}
            <span className="viz-bar-value">{i.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Heatmap({ title, rows, columns, unit }: { title: string; rows: { label: string; values: number[] }[]; columns: string[]; unit: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const step = (v: number) => SEQ[Math.min(SEQ.length - 1, Math.round((v / max) * (SEQ.length - 1)))];
  return (
    <div className="viz">
      <Text fw={600} mb={6}>
        {title}
      </Text>
      <table className="viz-heat">
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>всего</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th className="viz-heat-label">{r.label}</th>
              {r.values.map((v, i) => (
                <td
                  key={i}
                  title={`${r.label}, ${columns[i]}: ${v} ${unit}`}
                  style={v ? { background: step(v), color: (v / max) * (SEQ.length - 1) >= 7 ? "#fff" : "#0b0b0b" } : undefined}
                >
                  {v || ""}
                </td>
              ))}
              <td className="viz-heat-total">{r.values.reduce((a, b) => a + b, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="viz-scale">
        <span>0</span>
        {SEQ.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
        <span>{max}</span>
      </div>
    </div>
  );
}
