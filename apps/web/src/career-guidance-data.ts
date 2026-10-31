// "Định hướng nghề nghiệp" (#career): every career of the catalog against the student's competencies (the same fit as
// Khoảng trống kỹ năng shows for the target career) and against Khảo sát định hướng. Computed by the API
// (apps/api/src/career-guidance), shown here; no AI.
import {
  careerDataText, careerSummaryText, FIT_LABELS, formatDateTime, formatScore, gapStatusDisplay, gradedCourseText, needsSelfStudy, scoreSourcesText, shownScore,
  sortRequirements, type StatusTone,
} from "./student-competency-data";

export const CAREER_GUIDANCE_API = "/api/student/career-guidance";
/** At most this many careers side by side. */
export const COMPARE_MAX = 3;

export type FitCode = "very_fit" | "fit" | "average" | "low_fit" | "not_fit" | "insufficient_data";
export type GapStatus = "met" | "below" | "upcoming" | "not_studied" | "no_data";
export type GuidanceRequirement = {
  title: string; skillName: string | null; isRequired: boolean;
  status: GapStatus | null; statusLabel: string | null; score: number | null; threshold: number | null; deficit: number | null; upcomingTerm: string | null;
  exemptOnly: boolean; noDataReason: "no_skill" | "not_measured" | "other_specialty" | "elective_not_chosen" | null; otherSpecialtyCourses: string[];
  /** The courses the score comes from, largest share first (absent from an older API). */
  sources?: { name: string; score10: number | null; letter: string | null }[];
  /** How many times the skill counts in the điểm phù hợp: Bắt buộc 2, Ưu tiên 1 (absent from an older API). */
  coefficient?: number;
};
export type GuidanceFit = { score: number | null; code: FitCode; label: string; dataShare: number; met: number; below: number; notStudied: number; upcoming: number; noData: number; total: number;
  summaryText: string; dataText: string };
export type GuidanceCareer = {
  id: string; code: string; nameVi: string; nameEn: string; category: string; categoryName: string; description: string; isTarget: boolean;
  fit: GuidanceFit | null; requirements: GuidanceRequirement[]; interests: { field: string | null; tech: string[] };
};
export type GuidanceResponse = {
  /**
   * Why the fit could not be computed (transcript_required, specialty_required…; assessment_withdrawn: the student deleted
   * the assessment results and withdrew the consent), or null.
   */
  blocked: string | null; targetCareerId: string | null; fields: { code: string; name: string }[]; careers: GuidanceCareer[];
  /** Khảo sát định hướng is complete and agreed to under the current policy (as the AI roadmap requires); otherwise no survey match is used. */
  surveyDone: boolean;
  /** The target career when it was removed from the catalog (Khoảng trống kỹ năng still shows it). */
  deletedTargetName: string | null;
  /** Whether Khoảng trống kỹ năng (the latest assessment, made at gapAssessedAt) shows the target career as this page does. */
  gapCurrent: boolean; gapAssessedAt: string | null;
  /** The career Khoảng trống kỹ năng shows: the latest assessment's (null without one, or for an assessment without a career). */
  gapCareerId: string | null; gapCareerName: string | null;
};

/** Ramp step of a fit level (5 = Rất phù hợp … 1 = Không phù hợp, 0 = Chưa đủ dữ liệu), as on Khoảng trống kỹ năng. */
export const FIT_STEP: Record<FitCode, 0 | 1 | 2 | 3 | 4 | 5> = { very_fit: 5, fit: 4, average: 3, low_fit: 2, not_fit: 1, insufficient_data: 0 };

export const hasFit = (career: Pick<GuidanceCareer, "fit">) => career.fit !== null && career.fit.code !== "insufficient_data" && career.fit.score !== null;
export const matchesInterests = (career: Pick<GuidanceCareer, "interests">) => Boolean(career.interests.field || career.interests.tech.length);
const fitRank = (career: Pick<GuidanceCareer, "fit">) => (hasFit(career) ? career.fit!.score! : -1);

/** The careers that suit the student's competencies best (enough data, best fit first). */
export const bestFits = (careers: GuidanceCareer[], count = 3) =>
  careers.filter(hasFit).sort((a, b) => fitRank(b) - fitRank(a)).slice(0, count);

/**
 * The heading of the best fits: "Phù hợp nhất với năng lực hiện tại" once one reaches Trung bình; before that (K31: 48,
 * 48 and 47, all Không phù hợp) "Mức phù hợp cao nhất hiện nay", with why the fits are low.
 */
export function bestFitsHeading(best: readonly GuidanceCareer[]): { title: string; note: string } {
  if (!best.length || best.some((career) => FIT_STEP[career.fit!.code] >= FIT_STEP.average)) {
    return { title: "Phù hợp nhất với năng lực hiện tại", note: "Các nghề có mức phù hợp cao nhất với điểm kỹ năng của bạn." };
  }
  const total = best.reduce((sum, career) => sum + career.fit!.total, 0);
  const ahead = best.reduce((sum, career) => sum + career.fit!.upcoming + career.fit!.notStudied, 0);
  return {
    title: "Mức phù hợp cao nhất hiện nay",
    note: ahead * 2 >= total
      ? "Chưa nghề nào đạt mức Trung bình vì phần lớn kỹ năng của các nghề này bạn chưa học tới (sắp học, chưa học) nên đang tính 0 điểm; mức phù hợp sẽ tăng khi bạn học các học phần còn lại."
      : "Chưa nghề nào đạt mức Trung bình: nhiều kỹ năng của các nghề này còn dưới ngưỡng hoặc chưa có điểm. Xem chi tiết từng nghề để biết kỹ năng nên bổ sung.",
  };
}

/** The careers matching the survey: the field of interest first, then the most liked technologies, then the fit. */
export const interestPicks = (careers: GuidanceCareer[], count = 3) => careers.filter(matchesInterests)
  .sort((a, b) => Number(Boolean(b.interests.field)) - Number(Boolean(a.interests.field)) || b.interests.tech.length - a.interests.tech.length
    || fitRank(b) - fitRank(a))
  .slice(0, count);

/**
 * What the page shows first (user 2026-10-31: "Ưu tiên kết quả phù hợp nhất; phân cấp nội dung và giảm các phần phụ", then
 * "1 cái theo bảng xếp hạng, 1 cái theo sở thích mà sinh viên chọn ở Khảo sát định hướng"): the best fit, the next ones by
 * fit, and the survey matches not shown yet. No career appears twice: the target career has its own card above the picks
 * (targetStanding), so the lists leave it out, and on equal scores it is the best fit.
 */
export function careerPicks(careers: GuidanceCareer[], count = 3): { top: GuidanceCareer | null; ranked: GuidanceCareer[]; liked: GuidanceCareer[]; scored: number } {
  const ordered = careers.filter(hasFit).sort((a, b) => fitRank(b) - fitRank(a) || Number(b.isTarget) - Number(a.isTarget));
  const top = ordered[0] ?? null;
  const ranked = ordered.filter((career) => career !== top && !career.isTarget).slice(0, count);
  const shown = new Set([top, ...ranked].flatMap((career) => (career ? [career.id] : [])));
  return { top, ranked, liked: interestPicks(careers.filter((career) => !shown.has(career.id) && !career.isTarget), count), scored: ordered.length };
}

/** The place of a career by điểm phù hợp: 1 + the careers scoring higher, so equal scores share a place; null without a fit. */
export const rankOf = (careers: readonly GuidanceCareer[], career: GuidanceCareer) =>
  (hasFit(career) ? 1 + careers.filter((other) => fitRank(other) > fitRank(career)).length : null);

/** The lower bound of each fit level from Ít phù hợp up (fitLevelOf of Khoảng trống kỹ năng). */
const FIT_BOUNDS: readonly [FitCode, number][] = [["low_fit", 50], ["average", 62.5], ["fit", 80], ["very_fit", 90]];
/** The next fit level and the points the shown score lacks for it (54,78 is shown 54,7: Trung bình, 7,8 điểm); null at Rất phù hợp. */
export function nextFitLevel(score: number): { label: string; points: number } | null {
  const shown = shownScore(score);
  const next = FIT_BOUNDS.find(([, bound]) => shown + 1e-9 < bound);
  return next ? { label: FIT_LABELS[next[0]], points: Math.round((next[1] - shown) * 10) / 10 } : null;
}

const coefficientOf = (row: Pick<GuidanceRequirement, "coefficient" | "isRequired">) => row.coefficient ?? (row.isRequired ? 2 : 1);
/** A skill without a score: it counts 0 in the điểm phù hợp (Chưa học, Sắp học, Cần tự học, Chưa đủ dữ liệu). */
const countsZero = (row: Computed) => row.status !== "met" && row.status !== "below";
/**
 * The two parts of a career's điểm phù hợp (the engine's fitScoreOf: Bắt buộc counted twice, a skill without a score 0,
 * miễn/công nhận only left out): the share of the coefficients that count 0, and the average of the skills with a score.
 * The điểm phù hợp is (1 − zeroShare) × scoredMean.
 */
function fitParts(career: GuidanceCareer): { zeroShare: number; scoredMean: number | null } {
  let weight = 0, zero = 0, scoredWeight = 0, sum = 0;
  for (const row of computed(career)) {
    if (!countsZero(row) && row.score === null) continue;
    const coefficient = coefficientOf(row);
    weight += coefficient;
    if (countsZero(row)) zero += coefficient;
    else { scoredWeight += coefficient; sum += coefficient * row.score!; }
  }
  return { zeroShare: weight ? zero / weight : 0, scoredMean: scoredWeight ? sum / scoredWeight : null };
}

/**
 * Why the target career ranks below the best fit, the larger cause first. As the điểm phù hợp is (1 − zeroShare) × scoredMean
 * (fitParts), the gap splits exactly into the target's larger share of skills at 0 points, scoredMean(target) × (zeroShare(target)
 * − zeroShare(top)), and its lower scores on the skills that have one, (1 − zeroShare(top)) × (scoredMean(top) − scoredMean(target)).
 * A cause is named when it makes at least a fifth of the gap.
 */
function belowTopReasons(target: GuidanceCareer, top: GuidanceCareer): string[] {
  const t = fitParts(target), p = fitParts(top);
  const zeroOf = (career: GuidanceCareer) => computed(career).filter(countsZero);
  const tZero = zeroOf(target), pZero = zeroOf(top);
  const tTotal = target.requirements.length, pTotal = top.requirements.length;
  if (t.scoredMean === null) {
    const pScored = computed(top).filter((row) => row.score !== null).length;
    return [`Chưa kỹ năng nào của ${target.nameVi} có điểm nên cả ${tTotal} kỹ năng đều tính 0 điểm, còn ${top.nameVi} đã có ${pScored}/${pTotal} kỹ năng có điểm.`];
  }
  const upcoming = tZero.filter((row) => row.status === "upcoming").length;
  const later = !upcoming ? "" : upcoming < tZero.length ? ` Trong đó ${upcoming} kỹ năng sắp học sẽ có điểm khi bạn học tới.`
    : upcoming === 1 ? " Kỹ năng này sắp học nên sẽ có điểm khi bạn học tới." : " Các kỹ năng này đều sắp học nên sẽ có điểm khi bạn học tới.";
  const below = target.requirements.filter((row) => row.status === "below").length;
  const causes = [
    { part: t.scoredMean * (t.zeroShare - p.zeroShare),
      text: `${tZero.length}/${tTotal} kỹ năng của ${target.nameVi} chưa có điểm nên tính 0 điểm, ${pZero.length ? `so với ${pZero.length}/${pTotal} của ${top.nameVi}` : `còn mọi kỹ năng của ${top.nameVi} đều đã có điểm`}.${later}` },
    { part: (1 - p.zeroShare) * ((p.scoredMean ?? 0) - t.scoredMean),
      text: `Các kỹ năng đã có điểm của ${target.nameVi} có điểm thấp hơn: trung bình ${formatScore(t.scoredMean)}, so với ${formatScore(p.scoredMean ?? 0)} của ${top.nameVi}${below ? `; ${below} kỹ năng còn dưới ngưỡng` : ""}.` },
  ];
  const gap = causes[0]!.part + causes[1]!.part;
  return causes.filter((cause) => cause.part > 0 && cause.part >= gap / 5).sort((a, b) => b.part - a.part).map((cause) => cause.text);
}

/** The skills without a score, grouped as Khoảng trống kỹ năng names them, in the order of its count line (careerSummaryText). */
const ZERO_GROUPS: readonly { why: string; keep: (row: Computed) => boolean }[] = [
  { why: "chưa học", keep: (row) => row.status === "not_studied" },
  { why: "sắp học", keep: (row) => row.status === "upcoming" },
  { why: "cần tự học", keep: needsSelfStudy },
  { why: "chưa đủ dữ liệu", keep: (row) => row.status === "no_data" && !needsSelfStudy(row) },
];

export type TargetStanding = {
  /** rankOf among `scored` careers with a fit; null without a fit. */
  rank: number | null; scored: number;
  next: ReturnType<typeof nextFitLevel>;
  /** The target's skills by what they do to its điểm phù hợp, in the order of Khoảng trống kỹ năng. */
  met: string[]; below: string[]; zero: { why: string; names: string[] }[];
  /** The best fit when it scores higher than the target, and why the target ranks below it (belowTopReasons). */
  belowTop: { career: GuidanceCareer; reasons: string[] } | null;
};
/**
 * "Nghề mục tiêu của bạn" (user 2026-10-31: "Kết quả định hướng chưa giải thích rõ nghề mục tiêu sinh viên đã chọn có phù hợp
 * hay không và tại sao xếp ở vị trí thấp hơn nghề khác. Cần làm nổi bật và giải thích kết quả của nghề đang chọn"): its place,
 * the points to the next level, the skills behind its score and why it ranks below the best fit. Only the system's numbers.
 */
export function targetStanding(careers: GuidanceCareer[], target: GuidanceCareer): TargetStanding {
  const rows = sortRequirements(computed(target));
  const names = (keep: (row: Computed) => boolean) => rows.filter(keep).map(requirementName);
  const top = careerPicks(careers).top;
  return {
    rank: rankOf(careers, target), scored: careers.filter(hasFit).length,
    next: hasFit(target) ? nextFitLevel(target.fit!.score!) : null,
    met: names((row) => row.status === "met"), below: names((row) => row.status === "below"),
    zero: ZERO_GROUPS.map(({ why, keep }) => ({ why, names: names(keep) })).filter((group) => group.names.length > 0),
    belowTop: top && top !== target && hasFit(target) && fitRank(top) > fitRank(target) ? { career: top, reasons: belowTopReasons(target, top) } : null,
  };
}

/** The skills the student meets for a career, in the order of Khoảng trống kỹ năng. */
export const metSkills = (career: GuidanceCareer) => sortRequirements(computed(career)).filter((row) => row.status === "met").map(requirementName);

/** The survey interests the careers match (the field of interest, the technologies), for the heading of "Theo Khảo sát định hướng". */
export function surveyInterests(careers: readonly GuidanceCareer[]): { field: string | null; tech: string[] } {
  const field = careers.find((career) => career.interests.field)?.interests.field ?? null;
  const tech = [...new Set(careers.flatMap((career) => career.interests.tech))];
  return { field, tech };
}

/** "A, B, C và 2 kỹ năng khác": a few names, the rest counted. */
export const nameList = (names: readonly string[], max = 3, noun = "kỹ năng") =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} và ${names.length - max} ${noun} khác`;

/** "Khớp: lĩnh vực Web · thế mạnh Web front-end": why a career is in "Theo Khảo sát định hướng". */
export const interestReason = (career: Pick<GuidanceCareer, "interests">) =>
  `Khớp: ${[career.interests.field && `lĩnh vực ${career.interests.field}`, career.interests.tech.length > 0 && `thế mạnh ${career.interests.tech.join(", ")}`].filter(Boolean).join(" · ")}`;

/** "Tất cả nghề" (folded under the picks): by name (Vietnamese or English) and field, best fit first, then A–Z. */
export type CareerFilters = { q: string; field: string };
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

export function filterCareers(careers: GuidanceCareer[], filters: CareerFilters): GuidanceCareer[] {
  const query = fold(filters.q.trim());
  return careers
    .filter((career) => !query || fold(`${career.nameVi} ${career.nameEn} ${career.categoryName}`).includes(query))
    .filter((career) => !filters.field || career.category === filters.field)
    .sort((a, b) => fitRank(b) - fitRank(a) || a.nameVi.localeCompare(b.nameVi, "vi"));
}

/** How the student stands on one requirement: the glyph, words and tone of Khoảng trống kỹ năng (gapStatusDisplay). */
export function requirementState(requirement: GuidanceRequirement): { tone: StatusTone; glyph: string; text: string } {
  return requirement.status === null ? { tone: "neutral", glyph: "?", text: "Chưa tính" } : gapStatusDisplay({ ...requirement, status: requirement.status });
}

/** The name a requirement is compared by: its skill, else its title. */
export const requirementName = (requirement: Pick<GuidanceRequirement, "skillName" | "title">) => requirement.skillName ?? requirement.title;

type Computed = GuidanceRequirement & { status: GapStatus };
/** With a fit every requirement has a status. */
const computed = (career: GuidanceCareer): Computed[] => (career.fit ? career.requirements as Computed[] : []);
/** The requirements in the order of Khoảng trống kỹ năng (sortRequirements); the catalog order while the fit is blocked. */
export const orderedRequirements = (career: GuidanceCareer): GuidanceRequirement[] => (career.fit ? sortRequirements(computed(career)) : career.requirements);
/** "Kỹ năng còn thiếu" of Khoảng trống kỹ năng: every skill that lowers the fit (below, not studied, Cần tự học, Chưa đủ dữ liệu). */
export const missingSkills = (career: GuidanceCareer) => sortRequirements(computed(career))
  .filter((row) => row.status === "below" || row.status === "not_studied" || row.status === "no_data").map(requirementName);
/** How the điểm phù hợp is counted (comp-calc-v14), as "Thang mức phù hợp" of Khoảng trống kỹ năng says it. */
export const FIT_RULE_TEXT = "Điểm phù hợp là trung bình điểm các kỹ năng của nghề, kỹ năng Bắt buộc tính gấp đôi kỹ năng Ưu tiên; "
  + "kỹ năng chưa có điểm (chưa học, sắp học, cần tự học, chưa đủ dữ liệu) tính 0 điểm.";
/** FIT_RULE_TEXT, with "Điểm sẽ tăng…" only for a career that has Sắp học skills. */
export const fitRuleText = (career: Pick<GuidanceCareer, "fit" | "requirements">) =>
  (career.fit?.upcoming || career.requirements.some((row) => row.status === "upcoming")
    ? `${FIT_RULE_TEXT} Điểm sẽ tăng khi bạn học các học phần sắp học.` : FIT_RULE_TEXT);

/**
 * The note under the target career when Khoảng trống kỹ năng (the latest stored assessment) does not show what this page
 * computes for it: no assessment yet, another career (chosen here since), or the same career from older data; null when
 * they match. Times as the app prints them (HH:mm dd/MM/yyyy, Vietnam time).
 */
export function gapNote(data: Pick<GuidanceResponse, "gapCurrent" | "gapAssessedAt" | "gapCareerId" | "gapCareerName">, target: Pick<GuidanceCareer, "id" | "fit">): string | null {
  if (data.gapCurrent) return null;
  if (!data.gapAssessedAt) return "Bạn chưa đánh giá năng lực với nghề này; bấm Đánh giá năng lực để xem Khoảng trống kỹ năng.";
  const assessedAt = formatDateTime(data.gapAssessedAt);
  if (data.gapCareerId !== target.id) {
    return data.gapCareerName
      ? `Khoảng trống kỹ năng vẫn đang hiển thị nghề ${data.gapCareerName}. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật theo nghề mới.`
      : `Lần đánh giá năng lực lúc ${assessedAt} chưa có nghề mục tiêu. Bấm Đánh giá lại ở trang Đánh giá năng lực để xem Khoảng trống kỹ năng của nghề này.`;
  }
  // The same career: while this page cannot compute (blocked) there is nothing to compare.
  if (!target.fit) return null;
  return `Trang Khoảng trống kỹ năng đang hiển thị lần đánh giá lúc ${assessedAt}, tính trên dữ liệu cũ hơn nên có thể khác mức ở đây. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật.`;
}
/** A requirement's score as Khoảng trống kỹ năng prints it ("—" without one). */
export const requirementScoreText = (requirement: Pick<GuidanceRequirement, "score">) => (requirement.score === null ? "—" : formatScore(requirement.score));
/**
 * The courses a requirement's score comes from, as Khoảng trống kỹ năng says them ("Từ Lập trình web (6,8 · C+) và 1 học phần
 * khác"; user 2026-10-30: "Nên ghi môn làm minh chứng cạnh từng điểm"); "" without a score.
 */
export function requirementSourcesText(requirement: Pick<GuidanceRequirement, "score" | "sources">, max = 2): string {
  const sources = requirement.score === null ? [] : requirement.sources ?? [];
  return scoreSourcesText({ names: sources.slice(0, max).map(gradedCourseText), more: Math.max(0, sources.length - max) });
}
/** The count lines of Khoảng trống kỹ năng, rebuilt from the requirements like that page: "Đạt x/y kỹ năng · … · u/y kỹ năng có điểm". */
export const fitSummary = (career: GuidanceCareer) =>
  (career.fit ? `${careerSummaryText({ summaryText: career.fit.summaryText, requirements: computed(career) })} · ${careerDataText({ requirements: computed(career) })}` : "");

/** One row per skill any of the compared careers requires, with each career's requirement (null: not required). */
export function compareRows(careers: GuidanceCareer[]): { name: string; cells: (GuidanceRequirement | null)[] }[] {
  const names: string[] = [];
  for (const career of careers) for (const row of career.requirements) if (!names.includes(requirementName(row))) names.push(requirementName(row));
  // Skills required by more of the careers first, then by name.
  const shared = (name: string) => careers.filter((career) => career.requirements.some((row) => requirementName(row) === name)).length;
  return names.sort((a, b) => shared(b) - shared(a) || a.localeCompare(b, "vi"))
    .map((name) => ({ name, cells: careers.map((career) => career.requirements.find((row) => requirementName(row) === name) ?? null) }));
}

/** A list with the career added or removed; never more than COMPARE_MAX. */
export function toggleCompare(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length >= COMPARE_MAX ? [...ids] : [...ids, id];
}

const BLOCKED: Record<string, string> = {
  transcript_required: "Bạn cần tải bảng điểm lên ở Hồ sơ và bảng điểm để EduPath AI tính mức phù hợp với từng nghề.",
  specialty_required: "Bạn cần chọn chuyên ngành ở Hồ sơ và bảng điểm để EduPath AI tính mức phù hợp với từng nghề.",
  cohort_unknown: "Hồ sơ của bạn chưa có khóa học nên chưa tính được mức phù hợp. Hãy liên hệ Khoa để cập nhật.",
  curriculum_unavailable: "Khoa chưa có chương trình đào tạo cho khóa của bạn nên chưa tính được mức phù hợp.",
  curriculum_ambiguous: "Khóa của bạn đang có nhiều chương trình đào tạo nên chưa tính được mức phù hợp. Hãy liên hệ Khoa.",
  competency_weights_unavailable: "Khoa chưa gắn kỹ năng cho các học phần nên chưa tính được mức phù hợp.",
  // 2026-10-29, user: "Khi người dùng đã xóa kết quả năng lực cũ thì nó nên ghi rõ đây là kết quả cũ hoặc là xóa luôn chứ".
  assessment_withdrawn: "Bạn đã xóa kết quả đánh giá năng lực và rút lại sự đồng ý, nên EduPath AI không tính mức phù hợp của bạn với từng nghề. Muốn xem lại, hãy bấm Đánh giá năng lực ở trang Đánh giá năng lực.",
};
export const blockedText = (code: string) => BLOCKED[code] ?? "Chưa tính được mức phù hợp với từng nghề. Vui lòng thử lại sau.";
/** Where the student can lift the block: the profile (transcript, specialty) or Đánh giá năng lực (consent withdrawn); null otherwise. */
export function blockedAction(code: string): { href: string; label: string } | null {
  if (code === "transcript_required" || code === "specialty_required") return { href: "#profile", label: "Mở Hồ sơ và bảng điểm" };
  if (code === "assessment_withdrawn") return { href: "#competency", label: "Mở Đánh giá năng lực" };
  return null;
}

/** The điểm phù hợp as Khoảng trống kỹ năng prints it (formatScore: rounded down to the tenth, 50,66 → 50,6). */
export const fitScoreText = (score: number) => formatScore(score);
