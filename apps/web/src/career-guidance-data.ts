// "Định hướng nghề nghiệp" (#career): every career of the catalog against the student's competencies (the same fit as
// Khoảng trống kỹ năng shows for the target career) and against Khảo sát định hướng. Computed by the API
// (apps/api/src/career-guidance), shown here; no AI.
import { careerDataText, careerSummaryText, formatDateTime, formatScore, gapStatusDisplay, gradedCourseText, scoreSourcesText, sortRequirements, type StatusTone } from "./student-competency-data";

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

/** How every list of careers by fit is ordered, said above it (user 2026-10-31: "Ghi rõ danh sách vị trí nghề nghiệp được sắp xếp theo điểm phù hợp giảm dần"). */
export const FIT_ORDER_TEXT = "Sắp xếp theo điểm phù hợp giảm dần";

/**
 * The heading of the best fits (user 2026-10-31: "sửa tiêu đề thành 'Vị trí nghề nghiệp phù hợp với năng lực hiện tại'"):
 * the order, and the next ones in "Theo bảng xếp hạng"; before any career reaches Trung bình (K31: 48, 48 and 47, all Không
 * phù hợp) the note says why the fits are low instead.
 */
export function bestFitsHeading(best: readonly GuidanceCareer[]): { title: string; note: string } {
  const title = "Vị trí nghề nghiệp phù hợp với năng lực hiện tại";
  if (!best.length || best.some((career) => FIT_STEP[career.fit!.code] >= FIT_STEP.average)) {
    return { title, note: `${FIT_ORDER_TEXT}: vị trí đứng đầu ở đây, các vị trí tiếp theo ở mục Theo bảng xếp hạng bên dưới.` };
  }
  const total = best.reduce((sum, career) => sum + career.fit!.total, 0);
  const ahead = best.reduce((sum, career) => sum + career.fit!.upcoming + career.fit!.notStudied, 0);
  return {
    title,
    note: `${FIT_ORDER_TEXT}. ${ahead * 2 >= total
      ? "Chưa vị trí nghề nghiệp nào đạt mức Trung bình vì phần lớn kỹ năng của các vị trí này bạn chưa học tới (sắp học, chưa học) nên đang tính 0 điểm; mức phù hợp sẽ tăng khi bạn học các học phần còn lại."
      : "Chưa vị trí nghề nghiệp nào đạt mức Trung bình: nhiều kỹ năng của các vị trí này còn dưới ngưỡng hoặc chưa có điểm. Xem chi tiết từng vị trí để biết kỹ năng nên bổ sung."}`,
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
 * fit, and the survey matches not shown yet. No career appears twice.
 */
export function careerPicks(careers: GuidanceCareer[], count = 3): { top: GuidanceCareer | null; ranked: GuidanceCareer[]; liked: GuidanceCareer[]; scored: number } {
  const ordered = careers.filter(hasFit).sort((a, b) => fitRank(b) - fitRank(a));
  const top = ordered[0] ?? null;
  const ranked = ordered.slice(1, 1 + count);
  const shown = new Set([top, ...ranked].flatMap((career) => (career ? [career.id] : [])));
  return { top, ranked, liked: interestPicks(careers.filter((career) => !shown.has(career.id)), count), scored: ordered.length };
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
/**
 * The name of the 0–100 number beside every career, on every place it is shown (user 2026-10-31: "Các số như 68, 51, 47 không
 * có tên cột/đơn vị, người dùng không hiểu. Bổ sung tiêu đề và giải thích đây là điểm phù hợp kỹ năng với vị trí nghề nghiệp").
 */
export const FIT_SCORE_LABEL = "Điểm phù hợp kỹ năng";
/** How the điểm phù hợp is counted (comp-calc-v14), as "Thang mức phù hợp" of Khoảng trống kỹ năng says it. */
export const FIT_RULE_TEXT = "Điểm phù hợp là trung bình điểm các kỹ năng của vị trí nghề nghiệp, kỹ năng Bắt buộc tính gấp đôi kỹ năng Ưu tiên; "
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
  if (!data.gapAssessedAt) return "Bạn chưa đánh giá năng lực với vị trí nghề nghiệp này; bấm Đánh giá năng lực để xem Khoảng trống kỹ năng.";
  const assessedAt = formatDateTime(data.gapAssessedAt);
  if (data.gapCareerId !== target.id) {
    return data.gapCareerName
      ? `Khoảng trống kỹ năng vẫn đang hiển thị vị trí nghề nghiệp ${data.gapCareerName}. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật theo vị trí mới.`
      : `Lần đánh giá năng lực lúc ${assessedAt} chưa có vị trí nghề nghiệp mục tiêu. Bấm Đánh giá lại ở trang Đánh giá năng lực để xem Khoảng trống kỹ năng của vị trí này.`;
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
  transcript_required: "Bạn cần tải bảng điểm lên ở Hồ sơ và bảng điểm để EduPath AI tính mức phù hợp với từng vị trí nghề nghiệp.",
  specialty_required: "Bạn cần chọn chuyên ngành ở Hồ sơ và bảng điểm để EduPath AI tính mức phù hợp với từng vị trí nghề nghiệp.",
  cohort_unknown: "Hồ sơ của bạn chưa có khóa học nên chưa tính được mức phù hợp. Hãy liên hệ Khoa để cập nhật.",
  curriculum_unavailable: "Khoa chưa có chương trình đào tạo cho khóa của bạn nên chưa tính được mức phù hợp.",
  curriculum_ambiguous: "Khóa của bạn đang có nhiều chương trình đào tạo nên chưa tính được mức phù hợp. Hãy liên hệ Khoa.",
  competency_weights_unavailable: "Khoa chưa gắn kỹ năng cho các học phần nên chưa tính được mức phù hợp.",
  // 2026-10-29, user: "Khi người dùng đã xóa kết quả năng lực cũ thì nó nên ghi rõ đây là kết quả cũ hoặc là xóa luôn chứ".
  assessment_withdrawn: "Bạn đã xóa kết quả đánh giá năng lực và rút lại sự đồng ý, nên EduPath AI không tính mức phù hợp của bạn với từng vị trí nghề nghiệp. Muốn xem lại, hãy bấm Đánh giá năng lực ở trang Đánh giá năng lực.",
};
export const blockedText = (code: string) => BLOCKED[code] ?? "Chưa tính được mức phù hợp với từng vị trí nghề nghiệp. Vui lòng thử lại sau.";
/** Where the student can lift the block: the profile (transcript, specialty) or Đánh giá năng lực (consent withdrawn); null otherwise. */
export function blockedAction(code: string): { href: string; label: string } | null {
  if (code === "transcript_required" || code === "specialty_required") return { href: "#profile", label: "Mở Hồ sơ và bảng điểm" };
  if (code === "assessment_withdrawn") return { href: "#competency", label: "Mở Đánh giá năng lực" };
  return null;
}

/** The điểm phù hợp as Khoảng trống kỹ năng prints it (formatScore: rounded down to the tenth, 50,66 → 50,6). */
export const fitScoreText = (score: number) => formatScore(score);
