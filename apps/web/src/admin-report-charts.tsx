import { fitAxisLabels, yearAxisLabels } from "./chart-labels";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { decimalText, scoreText } from "./display-format";
import { layoutZoom } from "./page-scale";

// Charts of the admin reports (AD-REPORT-01…12), drawn without a library. Since the redesign of 2026-11-22 (preview the
// user approved: "Triển khai đi") every page has its own composition, so the set is wider: line chart, donuts, gauges,
// rings, a sparkline, stacked columns (counts on an axis, or 100% per cohort), a radar and a heat table.
// Colours (the three lists below pass the dataviz palette validator on a white card, 2026-11-22: lightness band, chroma,
// colour-blind separation of neighbours and the normal-vision floor; amber and green are under 3:1 on white, so every
// chart that uses them prints its counts in a legend):
// - statuses (đúng tiến độ / trễ / nguy cơ / chưa có dữ liệu) use the shared status colours;
// - ordered levels (Xuất sắc … Yếu, Rất phù hợp … Không phù hợp) run from teal (best) to red (worst), neighbours stepped
//   far enough apart to tell in a donut, always beside a legend that names each level with its count;
// - the careers of a donut take a fixed categorical order, "Vị trí khác" last in a neutral grey;
// - the heat table uses one blue, darker = more.
// Every mark has a tooltip (data-tip, shown by TooltipLayer) and an accessible name; a stacked column prints a part's
// count inside the part when it is tall enough, the total always above the column.

export const STATUS_COLORS = { good: "#2f8a63", warn: "#d4901f", bad: "#c4352b", unknown: "#7d8697", none: "#b8bfcb" } as const;
/** Xuất sắc, Giỏi, Khá, Trung bình, Yếu. */
export const BAND_COLORS = ["#0d8f86", "#6cc08f", "#3a6ad4", "#d4901f", "#c4352b"] as const;
/** Rất phù hợp, Phù hợp, Trung bình, Ít phù hợp, Không phù hợp. */
export const FIT_COLORS = ["#0d8f86", "#6cc08f", "#dcaa30", "#da6426", "#ae272c"] as const;
/** The five biggest parts of a donut of names, then every other one together. */
export const CATEGORY_COLORS = ["#3a6ad4", "#0d8f86", "#d4901f", "#a33ea1", "#c4352b", "#8a94a6"] as const;
export const SERIES_COLORS = { cumulative: "#3a6ad4", term: "#a33ea1", violet: "#a33ea1", amber: "#d4901f", blue: "#3a6ad4", teal: "#0f7c79", brand: "#b51639" } as const;

/** The background and text colour of a heat cell holding `value` out of `max` (0 stays clear). */
export function heatColor(value: number, max: number): { background: string; color: string } {
  if (!value || max <= 0) return { background: "transparent", color: "#667085" };
  return { background: `rgba(58, 106, 212, ${(0.14 + (0.48 * value) / max).toFixed(2)})`, color: "#1f2330" };
}

/** "45%" of a whole, 0 when the whole is empty. */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** A count with the Vietnamese thousands separator. */
export const countText = (value: number) => value.toLocaleString("vi-VN");
/** A GPA on the 4-point scale: "2,87"; "—" without one. */
export const gpaText = (value: number | null | undefined) => (value === null || value === undefined ? "—" : decimalText(value, 2));
/** A 0–100 score as every page shows it ("59,8"); "—" without one. */
export const scoreOrDash = (value: number | null | undefined) => (value === null || value === undefined ? "—" : scoreText(value));

/** A round number of steps for an axis that must reach `max`: 0, 5, 10 … */
export function axisStep(max: number): number {
  if (max <= 5) return 1;
  if (max <= 12) return 2;
  if (max <= 30) return 5;
  if (max <= 60) return 10;
  if (max <= 150) return 25;
  if (max <= 300) return 50;
  return Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
}

/* ------------------------------------------------------------------ tooltip */

/**
 * The one tooltip of the report pages: any element inside `root` with data-tip shows it on hover and on keyboard focus.
 * Lines are separated by "\n". The page is painted with CSS zoom on desktop, so pointer coordinates are divided by it.
 */
export function TooltipLayer({ root }: { root: string }) {
  const tip = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const place = (x: number, y: number) => {
      const element = tip.current;
      if (!element) return;
      const zoom = layoutZoom(element);
      const box = element.getBoundingClientRect();
      const width = box.width, height = box.height;
      const left = Math.max(8, Math.min(x + 14, window.innerWidth - width - 8));
      const top = Math.max(8, y - height - 12);
      element.style.left = `${left / zoom}px`;
      element.style.top = `${top / zoom}px`;
    };
    const target = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement | SVGElement>(`.${root} [data-tip]`) : null);
    const onMove = (event: PointerEvent) => {
      const element = target(event.target);
      if (!element) { setText(null); return; }
      setText(element.getAttribute("data-tip"));
      requestAnimationFrame(() => place(event.clientX, event.clientY));
    };
    const onFocus = (event: FocusEvent) => {
      const element = target(event.target);
      if (!element) return;
      setText(element.getAttribute("data-tip"));
      const box = element.getBoundingClientRect();
      requestAnimationFrame(() => place(box.left + box.width / 2, box.top));
    };
    const hide = () => setText(null);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [root]);
  return <div ref={tip} className="rp-tip" role="tooltip" hidden={!text}>{text}</div>;
}

/* ------------------------------------------------------------------ small pieces */

/** The legend: a swatch and a name per part, with its count when one is given, so the value reads without a hover. */
export function Legend({ items, label, lines = false }: { items: readonly (readonly [string, string] | readonly [string, string, number | string])[]; label?: string; lines?: boolean }) {
  return <ul className={`rp-legend${lines ? " rp-legend-lines" : ""}`} aria-label={label ?? "Chú giải"}>{items.map(([name, color, count]) => <li key={name}><i style={{ background: color }} aria-hidden="true" />{name}
    {count !== undefined && <b>{typeof count === "number" ? countText(count) : count}</b>}</li>)}</ul>;
}

/** A segmented choice of a few values (level tabs, grouping): each button can carry a count. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void; label: string }) {
  return <div className="rp-seg" role="group" aria-label={label}>{options.map((option) =>
    <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <b>{countText(option.count)}</b>}</button>)}</div>;
}

export type BarPart = { value: number; color: string; label: string };
const sumOf = (parts: readonly BarPart[]) => parts.reduce((sum, part) => sum + part.value, 0);
/** "Đúng tiến độ 9, Trễ kế hoạch 2": every part in one line, for the accessible name of a bar or column. */
export const partsText = (parts: readonly BarPart[]) => parts.map((part) => `${part.label} ${countText(part.value)}`).join(", ");

/** One thin bar of parts in a row (a pipeline, a distribution): the parts share the width by their values. */
export function StackBar({ parts, label, className = "", rest = 0, tip }: { parts: readonly BarPart[]; label: string; className?: string; rest?: number; tip?: string }) {
  const total = sumOf(parts);
  return <span className={`rp-stack-bar ${className}`} role="img" aria-label={`${label}: ${total ? partsText(parts) : "chưa có"}`} data-tip={tip} tabIndex={tip ? 0 : undefined}>
    {parts.map((part) => part.value > 0 && <i key={part.label} style={{ flexGrow: part.value, background: part.color }} data-tip={tip ? undefined : `${part.label}: ${countText(part.value)} (${percent(part.value, total)}%)`} />)}
    {rest > 0 && <i className="rp-stack-rest" style={{ flexGrow: rest }} />}
  </span>;
}

/* ------------------------------------------------------------------ gauges, ring, sparkline, donut */

/**
 * A half-circle gauge on 0–100 with the value in the middle. ticks: the Khá 62,5 and Giỏi 80 marks, "labels" with
 * their numbers, "marks" as two short lines (the page's Cách tính names them).
 */
export function Gauge({ value, color = SERIES_COLORS.teal, ticks = false, size = "big", label }: { value: number | null; color?: string; ticks?: boolean | "labels" | "marks"; size?: "big" | "mini"; label: string }) {
  const r = 48, cx = 60, cy = 62, length = Math.PI * r, shown = value === null ? 0 : Math.min(100, Math.max(0, value));
  const point = (share: number, radius: number) => { const angle = Math.PI * (1 - share / 100); return [cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius] as const; };
  const mini = size === "mini";
  const labels = ticks === true || ticks === "labels";
  return <svg className={mini ? "rp-gauge-mini" : "rp-gauge"} viewBox={labels ? "0 -12 120 88" : "0 0 120 70"} width={mini ? 76 : 150} height={mini ? 44 : labels ? 110 : 88} role="img" aria-label={`${label}: ${value === null ? "chưa có" : scoreText(value)} / 100`}>
    <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="#e9ecf3" strokeWidth="10" strokeLinecap="round" />
    {value !== null && shown > 0 && <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(length * shown) / 100} ${length}`} />}
    {ticks && ([[62.5, "62,5"], [80, "80"]] as const).map(([mark, text]) => {
      const [x1, y1] = point(mark, 40), [x2, y2] = point(mark, 56), [lx, ly] = point(mark, 66);
      return <g key={text}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1f2330" strokeOpacity={labels ? 1 : 0.55} strokeWidth="1.5" />{labels && <text x={lx} y={ly + 3} textAnchor="middle" className="rp-gauge-tick">{text}</text>}</g>;
    })}
    {!mini && <text x="60" y="60" textAnchor="middle" className="rp-gauge-value">{value === null ? "—" : scoreText(value)}</text>}
  </svg>;
}

/** A ring with the share in the middle ("45%"). */
export function Ring({ share, label, size = 52, color = SERIES_COLORS.blue }: { share: number; label: string; size?: number; color?: string }) {
  const r = 20, circumference = 2 * Math.PI * r, shown = Math.min(1, Math.max(0, share));
  return <svg className="rp-ring" width={size} height={size} viewBox="0 0 52 52" role="img" aria-label={`${label}: ${Math.round(shown * 100)}%`}>
    <circle cx="26" cy="26" r={r} fill="none" stroke="#e1e5ee" strokeWidth="6" />
    {shown > 0 && <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${circumference * shown} ${circumference}`} transform="rotate(-90 26 26)" />}
    <text x="26" y="30" textAnchor="middle" className="rp-ring-text">{`${Math.round(shown * 100)}%`}</text>
  </svg>;
}

/** A sparkline: area, line and the last point marked. Fewer than two values draw nothing. */
export function Sparkline({ values, color = SERIES_COLORS.violet, label }: { values: readonly number[]; color?: string; label: string }) {
  if (values.length < 2) return null;
  const width = 110, height = 40, low = Math.min(...values) - 0.05, high = Math.max(...values) + 0.05;
  const points = values.map((value, index) => [(index / (values.length - 1)) * (width - 8) + 4, height - 5 - ((value - low) / (high - low)) * (height - 11)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const last = points.at(-1)!;
  return <svg className="rp-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <path d={`M${line} L${last[0].toFixed(1)},${height} L${points[0]![0].toFixed(1)},${height} Z`} fill={color} opacity="0.12" />
    <path d={`M${line}`} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
  </svg>;
}

export type DonutPart = { label: string; value: number; color: string };
/** A donut of a few parts with a figure in the middle; each segment has its tooltip. `size` is the drawn width in px. */
export function Donut({ parts, center, sub, label, size = 150, unit = "sinh viên" }: { parts: readonly DonutPart[]; center: string; sub: string; label: string; size?: number; unit?: string }) {
  const half = size / 2, stroke = Math.round(size * 0.118), r = half - stroke / 2 - 3;
  const circumference = 2 * Math.PI * r, total = parts.reduce((sum, part) => sum + part.value, 0);
  const gap = parts.filter((part) => part.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return <svg className="rp-donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`}>
    <circle cx={half} cy={half} r={r} fill="none" stroke="#e9ecf3" strokeWidth={stroke} />
    {total > 0 && parts.map((part) => {
      if (!part.value) return null;
      const length = (circumference * part.value) / total;
      const segment = <circle key={part.label} cx={half} cy={half} r={r} fill="none" stroke={part.color} strokeWidth={stroke} strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
        strokeDashoffset={-offset} transform={`rotate(-90 ${half} ${half})`} data-tip={`${part.label}: ${countText(part.value)} ${unit} (${percent(part.value, total)}%)`} style={{ pointerEvents: "stroke" }} />;
      offset += length;
      return segment;
    })}
    <text x={half} y={half + 2} textAnchor="middle" className="rp-donut-value" style={{ fontSize: Math.round(size * 0.165) }}>{center}</text>
    <text x={half} y={half + 2 + Math.round(size * 0.115)} textAnchor="middle" className="rp-donut-sub">{sub}</text>
  </svg>;
}

/* ------------------------------------------------------------------ measured frames */

/**
 * The width a chart frame has in CSS px, so the SVG is drawn at that width and keeps its 12 px text at every card
 * width; null before measuring.
 */
export function useFrameWidth(): [(element: HTMLElement | null) => void, number | null] {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  return [setFrame, width];
}

/* ------------------------------------------------------------------ line chart (SVG) */

export type LineSeries = { key: string; label: string; color: string; values: readonly (number | null)[]; area?: boolean };
/**
 * Lines over terms on one GPA scale (steps of 0,5 or 0,25), a crosshair and a tooltip per term listing every series.
 * The series are named by the card's legend, so the chart itself carries no names. `columnTip` writes the tooltip of a term.
 */
export function LineChart({ terms, series, label, columnTip, emptyText }: {
  terms: readonly { code: string; label: string }[]; series: readonly LineSeries[]; label: string; columnTip: (index: number) => string; emptyText: string;
}) {
  const [frame, measured] = useFrameWidth();
  const values = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  if (!terms.length || !values.length) return <p className="rp-empty">{emptyText}</p>;
  const width = Math.max(420, measured ?? 720), height = 300, left = 44, right = 18, top = 14, bottom = 46;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  // A close range reads better on steps of 0,25; a wide one on steps of 0,5.
  const span = Math.max(...values) - Math.min(...values);
  const unit = span <= 0.6 ? 0.25 : 0.5;
  let low = Math.floor((Math.min(...values) - 0.05) / unit) * unit, high = Math.ceil((Math.max(...values) + 0.05) / unit) * unit;
  if (high - low < unit * 2) high = low + unit * 2;
  low = Math.max(0, low); high = Math.min(4, Math.max(high, low + unit));
  const step = terms.length > 1 ? plotWidth / (terms.length - 1) : plotWidth;
  const x = (index: number) => left + (terms.length === 1 ? plotWidth / 2 : index * step);
  const y = (value: number) => top + (1 - (value - low) / (high - low)) * plotHeight;
  const grid: number[] = [];
  for (let value = low; value <= high + 1e-9; value += unit) grid.push(Math.round(value * 100) / 100);
  // Only the axis labels that fit (user 2026-11-04: "Lỗi chữ đè lên nhau"): every other term when they are close, one
  // school year under the middle of its terms, short ("23–24") when the full years would touch.
  const heads = terms.map((term) => term.label.split(" ")[0] ?? term.label);
  const headShown = fitAxisLabels(terms.map((_, index) => ({ x: x(index), text: heads[index]! })));
  const groups: { year: string; first: number; last: number }[] = [];
  terms.forEach((term, index) => {
    const year = term.label.split(" ")[1] ?? "", group = groups.at(-1);
    if (group && group.year === year) group.last = index; else groups.push({ year, first: index, last: index });
  });
  const years = yearAxisLabels(groups.map((group) => ({ ...group, x: (x(group.first) + x(group.last)) / 2 })));
  return <div ref={frame} className="rp-line-frame">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="rp-line">
      {grid.map((value, index) => <g key={value}><line x1={left} x2={width - right + 6} y1={y(value)} y2={y(value)} className={index === 0 ? "rp-grid rp-grid-base" : "rp-grid"} /><text x={left - 8} y={y(value) + 4} textAnchor="end">{decimalText(value, unit === 0.25 ? 2 : 1)}</text></g>)}
      {series.filter((line) => line.area).map((line) => {
        const points = line.values.map((value, index) => (value === null ? null : [x(index), y(value)] as const)).filter((point): point is readonly [number, number] => point !== null);
        if (points.length < 2) return null;
        return <path key={`${line.key}-area`} d={`M${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L")} L${points.at(-1)![0].toFixed(1)},${top + plotHeight} L${points[0]![0].toFixed(1)},${top + plotHeight} Z`} fill={line.color} opacity="0.1" />;
      })}
      {terms.map((term, index) => <g key={term.code} className="rp-col" tabIndex={0} data-tip={columnTip(index)}>
        <rect x={x(index) - step / 2} y={top} width={step} height={plotHeight + bottom} fill="transparent" />
        <line className="rp-cross" x1={x(index)} x2={x(index)} y1={top} y2={top + plotHeight} />
        {headShown[index] && <text x={x(index)} y={height - 26} textAnchor="middle">{heads[index]}</text>}
      </g>)}
      {years.map((item) => item.shown && <text key={item.first} x={item.x} y={height - 10} textAnchor="middle" pointerEvents="none" className="rp-line-year">{item.text}</text>)}
      {series.map((line) => {
        // A gap (a term without data) breaks the line into pieces.
        const pieces: (readonly [number, number])[][] = [[]];
        line.values.forEach((value, index) => { if (value === null) { if (pieces.at(-1)!.length) pieces.push([]); } else pieces.at(-1)!.push([x(index), y(value)]); });
        return <g key={line.key} pointerEvents="none">
          {pieces.filter((piece) => piece.length > 1).map((piece, index) => <path key={index} d={`M${piece.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L")}`} fill="none" stroke={line.color} strokeWidth={line.area ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />)}
          {line.values.map((value, index) => value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r="3.5" fill="#fff" stroke={line.color} strokeWidth="2" />)}
        </g>;
      })}
    </svg>
  </div>;
}

/* ------------------------------------------------------------------ columns */

/** Dark text on the light greys and ambers, white on the rest: the count printed inside a column part. */
const inkOn = (color: string) => {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.48 ? "#1f2330" : "#fff";
};

export type Column = { key: string; label: string; sub?: string; parts: BarPart[]; strong?: boolean; name?: string };
/**
 * Stacked columns of counts on one axis from 0: the total above each column, a part's count inside the part when it is
 * tall enough, a tooltip on every part. `ranks` writes each column's label in a numbered circle (the rank of a ranking
 * the page lists below); with `onSelect` a column is a button and the selected one is marked.
 */
export function ColumnChart({ columns, label, unit = "sinh viên", height = 290, ranks = false, selected, onSelect }: {
  columns: readonly Column[]; label: string; unit?: string; height?: number; ranks?: boolean; selected?: string | null; onSelect?: (key: string) => void;
}) {
  const [frame, measured] = useFrameWidth();
  const left = 44, right = 10, top = 26, bottom = ranks ? 44 : columns.some((column) => column.sub) ? 48 : 32;
  const width = Math.max(measured ?? 760, left + right + columns.length * 38);
  const plotWidth = width - left - right, plotHeight = height - top - bottom, base = top + plotHeight;
  const max = Math.max(1, ...columns.map((column) => sumOf(column.parts)));
  const step = axisStep(max), axisMax = Math.ceil(max / step) * step;
  const band = plotWidth / Math.max(1, columns.length), barWidth = Math.min(48, Math.max(14, band * 0.56));
  const ticks = Array.from({ length: Math.floor(axisMax / step) + 1 }, (_, index) => index * step);
  const press = (key: string) => (event: KeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(key); } };
  return <div ref={frame} className="rp-colchart-frame">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} className="rp-colchart">
      {ticks.map((tick) => { const y = base - (tick / axisMax) * plotHeight; return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} className={tick === 0 ? "rp-grid rp-grid-base" : "rp-grid"} /><text x={left - 8} y={y + 4} textAnchor="end">{countText(tick)}</text></g>; })}
      {columns.map((column, index) => {
        const cx = left + band * (index + 0.5), total = sumOf(column.parts), name = column.name ?? column.label;
        const picked = selected === column.key;
        let y = base;
        const shown = column.parts.filter((part) => part.value > 0);
        return <g key={column.key} className={`rp-colchart-col${onSelect ? " rp-colchart-button" : ""}`} role={onSelect ? "button" : "img"} tabIndex={0} aria-pressed={onSelect ? picked : undefined}
          aria-label={`${ranks ? `Hạng ${index + 1}: ` : ""}${name}: ${countText(total)} ${unit}${shown.length > 1 ? ` (${partsText(shown)})` : ""}`}
          data-tip={`${name}: ${countText(total)} ${unit}${shown.length > 1 ? `\n${shown.map((part) => `${part.label}: ${countText(part.value)}`).join("\n")}` : ""}`}
          onClick={onSelect ? () => onSelect(column.key) : undefined} onKeyDown={onSelect ? press(column.key) : undefined}>
          <rect x={cx - band / 2 + 3} y={top - 18} width={Math.max(0, band - 6)} height={height - top + 14} rx="10" className={picked ? "rp-colchart-band rp-picked" : "rp-colchart-band"} />
          {shown.map((part) => {
            const partHeight = (part.value / axisMax) * plotHeight;
            y -= partHeight;
            const drawn = Math.max(1.5, partHeight - 2);
            return <g key={part.label}>
              <rect x={cx - barWidth / 2} y={y} width={barWidth} height={drawn} rx="4" fill={part.color} data-tip={`${name}\n${part.label}: ${countText(part.value)} ${unit}`} />
              {shown.length > 1 && drawn >= 18 && barWidth >= 22 && <text x={cx} y={y + drawn / 2 + 4} textAnchor="middle" className="rp-colchart-inside" style={{ fill: inkOn(part.color) }} pointerEvents="none">{countText(part.value)}</text>}
            </g>;
          })}
          <text x={cx} y={y - 7} textAnchor="middle" className="rp-colchart-total">{countText(total)}</text>
          {ranks ? <><circle cx={cx} cy={height - 22} r="12" className={picked ? "rp-colchart-rank rp-picked" : "rp-colchart-rank"} /><text x={cx} y={height - 18} textAnchor="middle" className={picked ? "rp-colchart-ranktext rp-picked" : "rp-colchart-ranktext"}>{index + 1}</text></>
            : <><text x={cx} y={base + 20} textAnchor="middle" className={column.strong ? "rp-colchart-label rp-strong" : "rp-colchart-label"}>{column.label}</text>{column.sub && <text x={cx} y={base + 37} textAnchor="middle" className="rp-colchart-sub">{column.sub}</text>}</>}
        </g>;
      })}
    </svg>
  </div>;
}

/** One 100% column per item (a cohort): each part's share of the column, the item's name and total below, a tooltip with the counts. */
export function ShareColumns({ columns, label, unit = "sinh viên" }: { columns: readonly Column[]; label: string; unit?: string }) {
  return <div className="rp-sharecols" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>{columns.map((column) => {
    const total = sumOf(column.parts);
    return <div key={column.key} className="rp-sharecol" role="img" tabIndex={0} aria-label={`${column.label}: ${countText(total)} ${unit}${total ? ` (${partsText(column.parts.filter((part) => part.value > 0))})` : ""}`}
      data-tip={`${column.label}: ${countText(total)} ${unit}${total ? `\n${column.parts.filter((part) => part.value > 0).map((part) => `${part.label}: ${countText(part.value)} (${percent(part.value, total)}%)`).join("\n")}` : ""}`}>
      <span className="rp-sharecol-bar">{column.parts.map((part) => part.value > 0 && <i key={part.label} style={{ flexGrow: part.value, background: part.color }} />)}</span>
      <b className={column.strong ? "rp-strong" : undefined}>{column.label}</b>{column.sub && <small>{column.sub}</small>}
    </div>;
  })}</div>;
}

/* ------------------------------------------------------------------ radar */

export type RadarAxis = { key: string; name: string; share: number };
/**
 * A radar of 3–8 shares (0–100): the farther a vertex from the centre, the bigger the share. The vertices carry their
 * rank in a circle (the names are in the ranking beside the chart); a vertex number is a button when `onSelect` is given.
 */
export function Radar({ axes, label, selected, onSelect, what }: { axes: readonly RadarAxis[]; label: string; selected?: string | null; onSelect?: (key: string) => void; what: string }) {
  const count = axes.length, cx = 160, cy = 152, radius = 104;
  const scaleMax = Math.min(100, Math.max(15, Math.ceil(Math.max(1, ...axes.map((axis) => axis.share)) / 15) * 15));
  const at = (index: number, factor: number) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return [Math.round((cx + radius * factor * Math.cos(angle)) * 10) / 10, Math.round((cy + radius * factor * Math.sin(angle)) * 10) / 10] as const;
  };
  const ring = (factor: number) => axes.map((_, index) => at(index, factor).join(",")).join(" ");
  const press = (key: string) => (event: KeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(key); } };
  return <svg className="rp-radar" viewBox="18 10 284 284" role="group" aria-label={label}>
    {[1, 2, 3].map((level) => <polygon key={level} points={ring(level / 3)} className="rp-radar-ring" />)}
    {axes.map((axis, index) => { const [x, y] = at(index, 1); return <line key={axis.key} x1={cx} y1={cy} x2={x} y2={y} className="rp-radar-ring" />; })}
    <polygon points={axes.map((axis, index) => at(index, Math.min(1, axis.share / scaleMax)).join(",")).join(" ")} className="rp-radar-shape" />
    {axes.map((axis, index) => {
      const [x, y] = at(index, Math.min(1, axis.share / scaleMax)), [lx, ly] = at(index, 1.2), picked = selected === axis.key;
      const tip = `${axis.name}: ${Math.round(axis.share)}% ${what}`;
      return <g key={axis.key}>
        <circle cx={x} cy={y} r="4" className="rp-radar-dot" data-tip={tip} />
        <g className={`rp-radar-mark${picked ? " rp-picked" : ""}${onSelect ? " rp-radar-button" : ""}`} role={onSelect ? "button" : "img"} tabIndex={0} aria-pressed={onSelect ? picked : undefined} aria-label={`Hạng ${index + 1}: ${tip}`} data-tip={tip}
          onClick={onSelect ? () => onSelect(axis.key) : undefined} onKeyDown={onSelect ? press(axis.key) : undefined}>
          <circle cx={lx} cy={ly} r="11" /><text x={lx} y={ly + 4} textAnchor="middle">{index + 1}</text>
        </g>
      </g>;
    })}
    {[1, 2, 3].map((level) => <text key={level} x={cx + 6} y={Math.round(cy - (radius * level) / 3 + 4)} className="rp-radar-scale">{`${Math.round((scaleMax * level) / 3)}%`}</text>)}
  </svg>;
}

/* ------------------------------------------------------------------ layout helpers */

/** A report card: its title, an optional line under it, and a legend, link or control on the right. */
export function Card({ title, sub, actions, children, className = "", id }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id: string }) {
  return <section className={`rp-card ${className}`} aria-labelledby={id}>
    <div className="rp-card-head"><div><h2 id={id}>{title}</h2>{sub && <p>{sub}</p>}</div>{actions && <div className="rp-card-actions">{actions}</div>}</div>
    {children}
  </section>;
}
