// The one way a term is written for students (user review 2026-10-30: "Học kỳ đang được gọi theo 4 kiểu … Nên chọn một
// kiểu duy nhất"). Texts the API sends to the pages and the facts given to the AI use it, so the AI writes terms the same way.

/** "HK261" → "HK1 2026–2027". Other shapes are returned as they are. */
export function termName(code: string): string {
  const match = /^HK(\d{2})([1-3])$/.exec(code);
  if (!match) return code;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} ${start}–${start + 1}`;
}

/** Every term an AI text names, as codes: "HK1 2025–2026", "HK1 · 2025–2026", "học kỳ 1 năm học 2025–2026", "HK251". */
export function termsNamedIn(text: string): string[] {
  const found = new Set<string>();
  const spelled = /\b(?:HK|học kỳ)\s*([1-3])\s*(?:[·,\-–]\s*)?(?:năm học\s*|năm\s*)?(20\d{2})\s*[-–]\s*(20\d{2})\b/giu;
  for (const match of text.matchAll(spelled)) if (Number(match[3]) === Number(match[2]) + 1) found.add(`HK${match[2]!.slice(2)}${match[1]}`);
  for (const match of text.matchAll(/\bHK(\d{2})([1-3])\b/g)) found.add(`HK${match[1]}${match[2]}`);
  return [...found];
}
