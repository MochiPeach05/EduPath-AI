// "Thế mạnh của bạn" and "Sở trường" (first "Công nghệ bạn thích", "Sở thích khi rảnh"; user 2026-10-24: "làm dạng các
// công nghệ, sở thích khi rảnh ... để tránh việc sv bỏ trống hoặc nhập bừa"), part of the profile survey since survey-v2.
// The options come from GET /api/student/survey (apps/api/src/student/interests.ts).

export type InterestOption = { id: string; label: string };

/** The labels of the chosen ids, in list order; unknown ids are left out. */
export const interestLabels = (options: InterestOption[], ids: readonly string[] | null | undefined) =>
  options.filter((option) => ids?.includes(option.id)).map((option) => option.label);

/** A list with the option added or removed; never more than max. */
export function toggleInterest(ids: readonly string[], id: string, max: number): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length >= max ? [...ids] : [...ids, id];
}

/** The Vietnamese message of a list still empty, or "". */
export const interestProblem = (kind: "tech" | "hobbies", ids: readonly string[]) =>
  ids.length ? "" : kind === "tech" ? "Vui lòng chọn ít nhất một công nghệ bạn thành thạo." : "Vui lòng chọn ít nhất một sở trường.";
