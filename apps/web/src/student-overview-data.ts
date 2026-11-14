import type { Transcript } from "./StudentTranscript";
import { formatVnDateTime } from "./display-format";

type Semester = Transcript["data"]["sections"][number];

/** Lower case without Vietnamese marks, đ read as d: for matching printed labels and searches. */
export const foldText = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

export function academicSections(transcript: Pick<Transcript, "data"> | null): Semester[] {
  return (transcript?.data.sections ?? [])
    .filter(section => section.academicYear !== null && section.semester !== null)
    .slice()
    .sort((a, b) => a.academicYear!.localeCompare(b.academicYear!) || Number(a.semester!.replace(/\D/g, "")) - Number(b.semester!.replace(/\D/g, "")));
}

export function latestResultSection(sections: Semester[]): Semester | undefined {
  return [...sections].reverse().find(section => section.courses.some(course => course.score10 !== null || course.score4 !== null)) ?? sections.at(-1);
}

// Keep the institution's printed summary; never average rows or infer missing GPA. Printed as "Điểm TB học kỳ (Hệ 4)"
// or written out as "Điểm trung bình học kỳ hệ 4".
export function printedSemesterGpa(section: Semester | undefined): string | null {
  return section?.summaries.find(summary => {
    const label = foldText(summary.label);
    return (label.includes("diem tb hoc ky") || label.includes("diem trung binh hoc ky")) && label.includes("he 4");
  })?.value ?? null;
}

/** "HH:mm dd/MM/yyyy" in Vietnam time: the one format of the "Cập nhật lúc" lines on Hồ sơ và bảng điểm (display-format.ts). */
export function formatUpdatedAt(value: string): string {
  return formatVnDateTime(value);
}

/** Sent on window when a transcript import finishes or the transcript is deleted (StudentTranscript); the profile page reloads on it. */
export const TRANSCRIPT_UPDATED_EVENT = "edupath-transcript-updated";
/** Calls listener on every TRANSCRIPT_UPDATED_EVENT; returns the way to stop listening (the cleanup of a useEffect). */
export function onTranscriptUpdated(listener: () => void): () => void {
  window.addEventListener(TRANSCRIPT_UPDATED_EVENT, listener);
  return () => window.removeEventListener(TRANSCRIPT_UPDATED_EVENT, listener);
}
/**
 * The sections of Hồ sơ và bảng điểm that other pages open (each section carries its id). Since 2026-11-14 (plan "Một bước
 * để bắt đầu") the page has the transcript only, whose import holds the specialty; goals and survey name sections that are
 * gone (Mục tiêu học tập; the survey is Khảo sát nhanh on Định hướng nghề nghiệp) and are kept for older links.
 */
export const PROFILE_SECTIONS = { transcript: "bang-diem" } as const;
export type ProfileSection = typeof PROFILE_SECTIONS[keyof typeof PROFILE_SECTIONS];

/** The section of Hồ sơ và bảng điểm where an item is filled in: the transcript and the specialty (in its import); none else. */
export function profileSectionOf(itemId: string): ProfileSection | undefined {
  return itemId === "transcript" || itemId === "specialty" ? PROFILE_SECTIONS.transcript : undefined;
}
