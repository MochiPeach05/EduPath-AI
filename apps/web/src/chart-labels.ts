// Axis labels of the SVG charts (Tổng quan's GPA chart, the admin reports' line chart) that never draw over each other
// (user 2026-11-04: "Lỗi chữ đè lên nhau"). Pure.

/** The axis labels' font size in px: 12px, a little larger with the page's font-size-adjust. */
export const AXIS_FONT = 12.8;

/**
 * Which labels fit side by side: from the right, so the newest one always shows, a label shows when it clears the last
 * one kept by `gap` px. Widths are estimated at 0.6 em a character; `x` is the label's centre (text-anchor middle).
 */
export function fitAxisLabels(labels: readonly { x: number; text: string }[], fontPx = AXIS_FONT, gap = 6): boolean[] {
  const shown = labels.map(() => false);
  let edge = Infinity;
  for (let i = labels.length - 1; i >= 0; i--) {
    const half = (labels[i]!.text.length * fontPx * 0.6) / 2;
    if (labels[i]!.x + half + gap <= edge) { shown[i] = true; edge = labels[i]!.x - half; }
  }
  return shown;
}

/** "2023–2024" → "23–24", for a year axis too narrow for the full years. */
export const shortYear = (year: string) => year.replace(/\b\d{2}(\d{2})\b/g, "$1");

/**
 * School year labels centred under their terms: the full years when they fit, the short ones ("23–24") when those show
 * more of them, and only the ones that fit either way.
 */
export function yearAxisLabels<T extends { year: string; x: number }>(labels: readonly T[], fontPx = AXIS_FONT): (T & { text: string; shown: boolean })[] {
  const full = fitAxisLabels(labels.map((label) => ({ x: label.x, text: label.year })), fontPx, 10);
  const short = fitAxisLabels(labels.map((label) => ({ x: label.x, text: shortYear(label.year) })), fontPx, 10);
  const count = (list: readonly boolean[]) => list.filter(Boolean).length;
  const useShort = count(short) > count(full);
  return labels.map((label, i) => ({ ...label, text: useShort ? shortYear(label.year) : label.year, shown: (useShort ? short : full)[i]! }));
}
