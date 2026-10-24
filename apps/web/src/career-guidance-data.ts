// "Định hướng nghề nghiệp" (#career): every career of the catalog against the student's competencies (the same fit as
// Khoảng trống kỹ năng shows for the target career) and against Khảo sát định hướng. Computed by the API
// (apps/api/src/career-guidance), shown here; no AI.
import { termShort } from "./student-roadmap-data";

export const CAREER_GUIDANCE_API = "/api/student/career-guidance";
/** At most this many careers side by side. */
export const COMPARE_MAX = 3;

export type FitCode = "very_fit" | "fit" | "average" | "low_fit" | "not_fit" | "insufficient_data";
export type GapStatus = "met" | "below" | "upcoming" | "not_studied" | "no_data";
export type GuidanceRequirement = {
  title: string; skillName: string | null; isRequired: boolean;
  status: GapStatus | null; statusLabel: string | null; score: number | null; threshold: number | null; deficit: number | null; upcomingTerm: string | null;
};
export type GuidanceFit = { score: number | null; code: FitCode; label: string; dataShare: number; met: number; below: number; notStudied: number; upcoming: number; noData: number; total: number };
export type GuidanceCareer = {
  id: string; code: string; nameVi: string; nameEn: string; category: string; categoryName: string; description: string; isTarget: boolean;
  fit: GuidanceFit | null; requirements: GuidanceRequirement[]; interests: { field: string | null; tech: string[] };
};
export type GuidanceResponse = {
  /** Why the fit could not be computed (transcript_required, specialty_required…), or null. */
  blocked: string | null; targetCareerId: string | null; surveyDone: boolean; fields: { code: string; name: string }[]; careers: GuidanceCareer[];
};

/** Ramp step of a fit level (5 = Rất phù hợp … 1 = Không phù hợp, 0 = Chưa đủ dữ liệu), as on Khoảng trống kỹ năng. */
export const FIT_STEP: Record<FitCode, 0 | 1 | 2 | 3 | 4 | 5> = { very_fit: 5, fit: 4, average: 3, low_fit: 2, not_fit: 1, insufficient_data: 0 };

export const hasFit = (career: Pick<GuidanceCareer, "fit">) => career.fit !== null && career.fit.code !== "insufficient_data" && career.fit.score !== null;
export const matchesInterests = (career: Pick<GuidanceCareer, "interests">) => Boolean(career.interests.field || career.interests.tech.length);
const fitRank = (career: Pick<GuidanceCareer, "fit">) => (hasFit(career) ? career.fit!.score! : -1);

/** The careers that suit the student's competencies best (enough data, best fit first). */
export const bestFits = (careers: GuidanceCareer[], count = 3) =>
  careers.filter(hasFit).sort((a, b) => fitRank(b) - fitRank(a)).slice(0, count);

/** The careers matching the survey: the field of interest first, then the most liked technologies, then the fit. */
export const interestPicks = (careers: GuidanceCareer[], count = 3) => careers.filter(matchesInterests)
  .sort((a, b) => Number(Boolean(b.interests.field)) - Number(Boolean(a.interests.field)) || b.interests.tech.length - a.interests.tech.length
    || fitRank(b) - fitRank(a))
  .slice(0, count);

export type CareerFilters = { q: string; field: string; sort: "fit" | "name"; interestOnly: boolean };
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/** "Tất cả nghề nghiệp": by name (Vietnamese or English), field and survey match, best fit or A–Z. */
export function filterCareers(careers: GuidanceCareer[], filters: CareerFilters): GuidanceCareer[] {
  const query = fold(filters.q.trim());
  return careers
    .filter((career) => !query || fold(`${career.nameVi} ${career.nameEn} ${career.categoryName}`).includes(query))
    .filter((career) => !filters.field || career.category === filters.field)
    .filter((career) => !filters.interestOnly || matchesInterests(career))
    .sort((a, b) => (filters.sort === "fit" ? fitRank(b) - fitRank(a) : 0) || a.nameVi.localeCompare(b.nameVi, "vi"));
}

export type RequirementTone = "met" | "below" | "not_studied" | "upcoming" | "no_data" | "unknown";
const scoreText = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

/** How the student stands on one requirement, in plain words. */
export function requirementState(requirement: GuidanceRequirement): { tone: RequirementTone; text: string } {
  switch (requirement.status) {
    case "met": return { tone: "met", text: "Đạt" };
    case "below": return { tone: "below", text: requirement.deficit !== null ? `Thiếu ${scoreText(requirement.deficit)} điểm` : "Dưới ngưỡng" };
    case "not_studied": return { tone: "not_studied", text: "Chưa học" };
    case "upcoming": return { tone: "upcoming", text: requirement.upcomingTerm ? `Sắp học · ${termShort(requirement.upcomingTerm)}` : "Sắp học" };
    case "no_data": return { tone: "no_data", text: "Chưa đủ dữ liệu" };
    default: return { tone: "unknown", text: "Chưa tính" };
  }
}

/** The name a requirement is compared by: its skill, else its title. */
export const requirementName = (requirement: Pick<GuidanceRequirement, "skillName" | "title">) => requirement.skillName ?? requirement.title;

/** The skills still missing for a career (below the threshold or not studied). */
export const missingSkills = (career: GuidanceCareer) =>
  career.requirements.filter((row) => row.status === "below" || row.status === "not_studied").map(requirementName);

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
};
export const blockedText = (code: string) => BLOCKED[code] ?? "Chưa tính được mức phù hợp với từng nghề. Vui lòng thử lại sau.";
/** Whether the student can fix the block in the profile. */
export const blockedInProfile = (code: string) => code === "transcript_required" || code === "specialty_required";

export const fitScoreText = (score: number) => String(Math.floor(score * 10) / 10).replace(".", ",");
