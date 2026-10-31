import { useEffect, useRef, useState, type ReactNode } from "react";
import { decimalText, scoreText } from "./display-format";
import { layoutZoom } from "./page-scale";

// Charts of the admin reports (AD-REPORT-01…11, 2026-10-31), drawn without a library: HTML bars where text matters most
// (labels keep the page's 12–14 px), SVG for the line chart (drawn at its measured width), gauges, rings and the donut.
// Colours (checked with the dataviz validator, 2026-10-31):
// - statuses (đúng tiến độ / trễ / nguy cơ / chưa có dữ liệu) use the shared status colours;
// - ordered levels (Xuất sắc … Yếu, Rất phù hợp … Không phù hợp) use one blue ramp, best darkest (ordinal: monotone,
//   lightest step 2,06:1 on white);
// - cohorts use a fixed categorical order keyed by the cohort number, so a filter never repaints a cohort;
// - counts in the cohort matrices use the sequential blue scale.
// Every mark has a tooltip (data-tip, shown by TooltipLayer) and every chart a legend or direct labels.

export const STATUS_COLORS = { good: "#2f8a63", warn: "#d4901f", bad: "#c4352b", unknown: "#7d8697", none: "#b8bfcb" } as const;
/** Best to worst: Xuất sắc / Rất phù hợp first, Yếu / Không phù hợp last. */
export const LEVEL_RAMP = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"] as const;
/** Sequential blue, lightest (few) to darkest (many). */
const SEQUENTIAL = ["#e3eefc", "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"] as const;
export const SERIES_COLORS = { cumulative: "#3a6ad4", term: "#a33ea1", violet: "#a33ea1", amber: "#d4901f", blue: "#3a6ad4", teal: "#0f7c79" } as const;
/** K26 … K33 in a validated order; later cohorts repeat it. */
const COHORT_PALETTE = ["#6250d6", "#e87ba4", "#008300", "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e34948"] as const;

/** The colour of a cohort ("K29"), the same on every chart and for every filter. */
export function cohortColor(cohort: string): string {
  const number = Number(/\d+/.exec(cohort)?.[0] ?? NaN);
  if (!Number.isFinite(number)) return "#7d8697";
  return COHORT_PALETTE[(((number - 26) % COHORT_PALETTE.length) + COHORT_PALETTE.length) % COHORT_PALETTE.length]!;
}

/** The background and text colour of a matrix cell holding `value` out of `max` (0 stays almost white). */
export function heatColor(value: number, max: number): { background: string; color: string } {
  if (!value || max <= 0) return { background: "#f6f8fc", color: "#667085" };
  const step = Math.min(SEQUENTIAL.length - 1, Math.max(1, Math.round((value / max) * (SEQUENTIAL.length - 1))));
  return { background: SEQUENTIAL[step]!, color: step >= 7 ? "#ffffff" : "#1f2330" };
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

export function Legend({ items, label }: { items: readonly (readonly [string, string])[]; label?: string }) {
  return <ul className="rp-legend" aria-label={label ?? "Chú giải"}>{items.map(([name, color]) => <li key={name}><i style={{ background: color }} aria-hidden="true" />{name}</li>)}</ul>;
}

/** Toàn khóa | Từng khóa: every section of the reports can be read for all cohorts together and for each one (user, 2026-10-31). */
export type CohortMode = "all" | "byCohort";
export function ModeSwitch({ value, onChange, label }: { value: CohortMode; onChange: (mode: CohortMode) => void; label: string }) {
  return <div className="rp-seg" role="group" aria-label={`Xem ${label}`}>
    <button type="button" aria-pressed={value === "all"} onClick={() => onChange("all")}>Toàn khóa</button>
    <button type="button" aria-pressed={value === "byCohort"} onClick={() => onChange("byCohort")}>Từng khóa</button>
  </div>;
}

/** A segmented choice of a few values (status tabs, grouping): each button can carry a count. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void; label: string }) {
  return <div className="rp-seg" role="group" aria-label={label}>{options.map((option) =>
    <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <b>{countText(option.count)}</b>}</button>)}</div>;
}

/* ------------------------------------------------------------------ bars (HTML) */

export type BarPart = { value: number; color: string; label: string };
export type BarRow = { key: string; label: string; sub?: string; parts: BarPart[]; tip?: string };

/**
 * Horizontal bars on one axis from 0: one row per item, segments stacked in order with a 2 px gap, the total at the
 * end. Rows become buttons when `onSelect` is given (the selected one is marked).
 */
export function HBarList({ rows, onSelect, selected, unit = "sinh viên", label, labelWidth = 220 }: {
  rows: readonly BarRow[]; onSelect?: (key: string) => void; selected?: string | null; unit?: string; label: string; labelWidth?: number;
}) {
  const max = Math.max(1, ...rows.map((row) => row.parts.reduce((sum, part) => sum + part.value, 0)));
  const step = axisStep(max);
  const axisMax = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.floor(axisMax / step) + 1 }, (_, index) => index * step);
  return <div className="rp-hbars" role="group" aria-label={label} style={{ ["--rp-label" as string]: `${labelWidth}px` }}>
    <div className="rp-hbar-axis" aria-hidden="true"><span /><span className="rp-hbar-ticks">{ticks.map((tick) => <span key={tick} style={{ left: `${(tick / axisMax) * 100}%` }}>{countText(tick)}</span>)}</span><span /></div>
    {rows.map((row) => {
      const total = row.parts.reduce((sum, part) => sum + part.value, 0);
      const tip = row.tip ?? `${row.label}: ${countText(total)} ${unit}${row.parts.length > 1 ? `\n${row.parts.map((part) => `${part.label}: ${countText(part.value)}`).join("\n")}` : ""}`;
      const content = <>
        <span className="rp-hbar-label"><span>{row.label}</span>{row.sub && <small>{row.sub}</small>}</span>
        <span className="rp-hbar-track">{ticks.slice(1).map((tick) => <i key={tick} className="rp-hbar-grid" style={{ left: `${(tick / axisMax) * 100}%` }} />)}
          <span className="rp-hbar-fill" style={{ width: `${(total / axisMax) * 100}%` }}>{row.parts.filter((part) => part.value > 0).map((part) =>
            <span key={part.label} className="rp-hbar-seg" style={{ flexGrow: part.value, background: part.color }}>{row.parts.length > 1 && part.value / axisMax >= 0.06 ? countText(part.value) : ""}</span>)}</span></span>
        <b className="rp-hbar-total">{countText(total)}</b>
      </>;
      return onSelect
        ? <button key={row.key} type="button" className={`rp-hbar-row rp-hbar-button${selected === row.key ? " rp-selected" : ""}`} aria-pressed={selected === row.key} data-tip={tip} onClick={() => onSelect(row.key)}>{content}</button>
        : <div key={row.key} className="rp-hbar-row" data-tip={tip} tabIndex={0}>{content}</div>;
    })}
  </div>;
}

/** One 100% bar per row (a cohort): the share of each part, counts inside the wide segments, the row total at the end. */
export function ShareBars({ rows, label, unit = "sinh viên" }: { rows: readonly BarRow[]; label: string; unit?: string }) {
  return <div className="rp-share" role="group" aria-label={label}>{rows.map((row) => {
    const total = row.parts.reduce((sum, part) => sum + part.value, 0);
    const tip = row.tip ?? `${row.label}: ${countText(total)} ${unit}\n${row.parts.map((part) => `${part.label}: ${countText(part.value)} (${percent(part.value, total)}%)`).join("\n")}`;
    return <div key={row.key} className="rp-share-row" data-tip={tip} tabIndex={0}>
      <span className="rp-share-label"><span>{row.label}</span>{row.sub && <small>{row.sub}</small>}</span>
      <span className="rp-share-track">{total === 0 ? <span className="rp-share-empty">Chưa có dữ liệu</span> : row.parts.filter((part) => part.value > 0).map((part) =>
        <span key={part.label} className="rp-share-seg" style={{ flexGrow: part.value, background: part.color }}>{part.value / total >= 0.09 ? countText(part.value) : ""}</span>)}</span>
      <b>{countText(total)}</b>
    </div>;
  })}</div>;
}

export type MatrixRow = { key: string; label: string; values: Record<string, number>; total: number; tip?: string };
/**
 * Rows × cohorts with the count in each cell (sequential blue, darker = more) and the whole-scope total last, so one
 * table reads "toàn khóa" and "từng khóa" at once. Rows are buttons when `onSelect` is given.
 */
export function CohortMatrix({ rows, cohorts, label, rowHeader, onSelect, selected }: {
  rows: readonly MatrixRow[]; cohorts: readonly string[]; label: string; rowHeader: string; onSelect?: (key: string) => void; selected?: string | null;
}) {
  const max = Math.max(1, ...rows.flatMap((row) => cohorts.map((cohort) => row.values[cohort] ?? 0)));
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label={label}><table className="rp-table rp-matrix">
    <thead><tr><th scope="col">{rowHeader}</th>{cohorts.map((cohort) => <th key={cohort} scope="col" className="rp-num">{cohort}</th>)}<th scope="col" className="rp-num">Toàn khóa</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key} className={selected === row.key ? "rp-selected" : undefined}>
      <th scope="row">{onSelect ? <button type="button" className="rp-link" aria-pressed={selected === row.key} onClick={() => onSelect(row.key)}>{row.label}</button> : row.label}</th>
      {cohorts.map((cohort) => { const value = row.values[cohort] ?? 0; const color = heatColor(value, max); return <td key={cohort} className="rp-num rp-heat" style={color} data-tip={`${row.label} · ${cohort}: ${countText(value)}`}>{countText(value)}</td>; })}
      <td className="rp-num rp-total">{countText(row.total)}</td>
    </tr>)}</tbody>
  </table></div>;
}

/* ------------------------------------------------------------------ gauges, ring, sparkline, donut */

/** A half-circle gauge on 0–100 (optionally with the Khá 62,5 and Giỏi 80 marks and the value in the middle). */
export function Gauge({ value, color = SERIES_COLORS.teal, ticks = false, size = "big", label }: { value: number | null; color?: string; ticks?: boolean; size?: "big" | "mini"; label: string }) {
  const r = 48, cx = 60, cy = 62, length = Math.PI * r, shown = value === null ? 0 : Math.min(100, Math.max(0, value));
  const point = (share: number, radius: number) => { const angle = Math.PI * (1 - share / 100); return [cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius] as const; };
  const mini = size === "mini";
  return <svg className={mini ? "rp-gauge-mini" : "rp-gauge"} viewBox={ticks ? "0 -12 120 88" : "0 0 120 70"} width={mini ? 72 : 150} height={mini ? 42 : ticks ? 110 : 88} role="img" aria-label={`${label}: ${value === null ? "chưa có" : scoreText(value)} / 100`}>
    <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="#e9ecf3" strokeWidth="10" strokeLinecap="round" />
    {value !== null && <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(length * shown) / 100} ${length}`} />}
    {ticks && ([[62.5, "62,5"], [80, "80"]] as const).map(([mark, text]) => {
      const [x1, y1] = point(mark, 40), [x2, y2] = point(mark, 56), [lx, ly] = point(mark, 66);
      return <g key={text}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1f2330" strokeWidth="1.5" /><text x={lx} y={ly + 3} textAnchor="middle" className="rp-gauge-tick">{text}</text></g>;
    })}
    {!mini && <text x="60" y="58" textAnchor="middle" className="rp-gauge-value">{value === null ? "—" : scoreText(value)}</text>}
  </svg>;
}

/** A small ring with the share in the middle ("45%"). */
export function Ring({ share, label }: { share: number; label: string }) {
  const r = 20, circumference = 2 * Math.PI * r, shown = Math.min(1, Math.max(0, share));
  return <svg className="rp-ring" width="52" height="52" viewBox="0 0 52 52" role="img" aria-label={`${label}: ${Math.round(shown * 100)}%`}>
    <circle cx="26" cy="26" r={r} fill="none" stroke="#e9ecf3" strokeWidth="6" />
    <circle cx="26" cy="26" r={r} fill="none" stroke={SERIES_COLORS.blue} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${circumference * shown} ${circumference}`} transform="rotate(-90 26 26)" />
    <text x="26" y="30" textAnchor="middle" className="rp-ring-text">{`${Math.round(shown * 100)}%`}</text>
  </svg>;
}

/** A sparkline: area, line and the last point marked. Fewer than two values draw nothing. */
export function Sparkline({ values, color = SERIES_COLORS.violet, label }: { values: readonly number[]; color?: string; label: string }) {
  if (values.length < 2) return null;
  const width = 96, height = 40, low = Math.min(...values) - 0.05, high = Math.max(...values) + 0.05;
  const points = values.map((value, index) => [(index / (values.length - 1)) * (width - 6) + 3, height - 4 - ((value - low) / (high - low)) * (height - 10)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const last = points.at(-1)!;
  return <svg className="rp-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <path d={`M${line} L${last[0].toFixed(1)},${height} L${points[0]![0].toFixed(1)},${height} Z`} fill={color} opacity="0.14" />
    <path d={`M${line}`} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
  </svg>;
}

export type DonutPart = { label: string; value: number; color: string };
/** A donut of a few ordered parts with the average in the middle; each segment has its tooltip. */
export function Donut({ parts, center, sub, label }: { parts: readonly DonutPart[]; center: string; sub: string; label: string }) {
  const r = 56, circumference = 2 * Math.PI * r, total = parts.reduce((sum, part) => sum + part.value, 0);
  const gap = parts.filter((part) => part.value > 0).length > 1 ? 2.5 : 0;
  let offset = 0;
  return <svg className="rp-donut" width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`}>
    <circle cx="75" cy="75" r={r} fill="none" stroke="#e9ecf3" strokeWidth="18" />
    {total > 0 && parts.map((part) => {
      if (!part.value) return null;
      const length = (circumference * part.value) / total;
      const segment = <circle key={part.label} cx="75" cy="75" r={r} fill="none" stroke={part.color} strokeWidth="18" strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
        strokeDashoffset={-offset} transform="rotate(-90 75 75)" data-tip={`${part.label}: ${countText(part.value)} sinh viên (${percent(part.value, total)}%)`} style={{ pointerEvents: "stroke" }} />;
      offset += length;
      return segment;
    })}
    <text x="75" y="78" textAnchor="middle" className="rp-donut-value">{center}</text>
    <text x="75" y="97" textAnchor="middle" className="rp-donut-sub">{sub}</text>
  </svg>;
}

/* ------------------------------------------------------------------ line chart (SVG) */

/** The width a chart frame has on screen, so the SVG is drawn at that width and keeps 12 px text; null before measuring. */
export function useFrameWidth(): [(element: HTMLDivElement | null) => void, number | null] {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
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

export type LineSeries = { key: string; label: string; color: string; values: readonly (number | null)[]; area?: boolean };
/**
 * Lines over terms on one GPA scale (steps of 0,5), a crosshair and a tooltip per term listing every series, and the
 * series names at their last point. `columnTip` writes the tooltip of a term.
 */
export function LineChart({ terms, series, label, columnTip, emptyText }: {
  terms: readonly { code: string; label: string }[]; series: readonly LineSeries[]; label: string; columnTip: (index: number) => string; emptyText: string;
}) {
  const [frame, measured] = useFrameWidth();
  const values = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  if (!terms.length || !values.length) return <p className="rp-empty">{emptyText}</p>;
  const width = Math.max(460, measured ?? 720), height = 280, left = 40, right = 116, top = 16, bottom = 46;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  let low = Math.floor((Math.min(...values) - 0.1) * 2) / 2, high = Math.ceil((Math.max(...values) + 0.1) * 2) / 2;
  if (high - low < 1) high = low + 1;
  low = Math.max(0, low); high = Math.min(4, Math.max(high, low + 0.5));
  const step = terms.length > 1 ? plotWidth / (terms.length - 1) : plotWidth;
  const x = (index: number) => left + (terms.length === 1 ? plotWidth / 2 : index * step);
  const y = (value: number) => top + (1 - (value - low) / (high - low)) * plotHeight;
  const grid: number[] = [];
  for (let value = low; value <= high + 1e-9; value += 0.5) grid.push(Math.round(value * 10) / 10);
  // Series names at their last point, nudged apart so none overlap.
  const ends = series.map((line) => {
    const lastIndex = line.values.reduce<number>((found, value, index) => (value !== null ? index : found), -1);
    return lastIndex < 0 ? null : { key: line.key, label: line.label, color: line.color, x: x(lastIndex), y: y(line.values[lastIndex]!), value: line.values[lastIndex]! };
  }).filter((end): end is NonNullable<typeof end> => end !== null).sort((a, b) => a.y - b.y);
  for (let index = 1; index < ends.length; index++) if (ends[index]!.y - ends[index - 1]!.y < 15) ends[index]!.y = ends[index - 1]!.y + 15;
  return <div ref={frame} className="rp-line-frame">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="rp-line">
      {grid.map((value) => <g key={value}><line x1={left} x2={width - right + 8} y1={y(value)} y2={y(value)} className="rp-grid" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{decimalText(value, 1)}</text></g>)}
      {series.filter((line) => line.area).map((line) => {
        const points = line.values.map((value, index) => (value === null ? null : [x(index), y(value)] as const)).filter((point): point is readonly [number, number] => point !== null);
        if (points.length < 2) return null;
        return <path key={`${line.key}-area`} d={`M${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L")} L${points.at(-1)![0].toFixed(1)},${top + plotHeight} L${points[0]![0].toFixed(1)},${top + plotHeight} Z`} fill={line.color} opacity="0.12" />;
      })}
      {terms.map((term, index) => {
        const [head, year] = term.label.split(" ");
        // Terms close together keep the school year only under its first term (HK1), so the years never overlap.
        const showYear = step >= 76 || index === 0 || head === "HK1";
        return <g key={term.code} className="rp-col" tabIndex={0} data-tip={columnTip(index)}>
          <rect x={x(index) - step / 2} y={top} width={step} height={plotHeight + bottom} fill="transparent" />
          <line className="rp-cross" x1={x(index)} x2={x(index)} y1={top} y2={top + plotHeight} />
          <text x={x(index)} y={height - 26} textAnchor="middle">{head}</text>
          {showYear && <text x={x(index)} y={height - 10} textAnchor={step >= 76 ? "middle" : "start"} dx={step >= 76 ? 0 : -8}>{year ?? ""}</text>}
        </g>;
      })}
      {series.map((line) => {
        // A gap (a term without data) breaks the line into pieces.
        const pieces: (readonly [number, number])[][] = [[]];
        line.values.forEach((value, index) => { if (value === null) { if (pieces.at(-1)!.length) pieces.push([]); } else pieces.at(-1)!.push([x(index), y(value)]); });
        return <g key={line.key} pointerEvents="none">
          {pieces.filter((piece) => piece.length > 1).map((piece, index) => <path key={index} d={`M${piece.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L")}`} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" />)}
          {line.values.map((value, index) => value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r="4" fill={line.color} stroke="#fff" strokeWidth="2" />)}
        </g>;
      })}
      {ends.map((end) => <text key={end.key} x={end.x + 10} y={end.y + 4} className="rp-line-end" fill={end.color}>{`${end.label} ${gpaText(end.value)}`}</text>)}
    </svg>
  </div>;
}

/* ------------------------------------------------------------------ layout helpers */

/** A report card: title, one line of explanation, an action (link or switch) on the right. */
export function Card({ title, sub, actions, children, className = "", id }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section className={`rp-card ${className}`} aria-labelledby={id}>
    <div className="rp-card-head"><div><h2 id={id}>{title}</h2>{sub && <p>{sub}</p>}</div>{actions && <div className="rp-card-actions">{actions}</div>}</div>
    {children}
  </section>;
}
