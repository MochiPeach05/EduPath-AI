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

/** The sections of Hồ sơ và bảng điểm that other pages open (each section carries its id). */
/** Sent on window when a transcript import finishes or the transcript is deleted (StudentTranscript); the profile page reloads on it. */
export const TRANSCRIPT_UPDATED_EVENT = "edupath-transcript-updated";
export const PROFILE_SECTIONS = { goals: "muc-tieu-hoc-tap", survey: "khao-sat-dinh-huong", transcript: "bang-diem" } as const;
export type ProfileSection = typeof PROFILE_SECTIONS[keyof typeof PROFILE_SECTIONS];

/** The section where a required profile item (requiredProfileItems) is filled in. */
export function profileSectionOf(itemId: string): ProfileSection | undefined {
  return itemId === "transcript" ? PROFILE_SECTIONS.transcript
    : itemId === "specialty" || itemId === "career" ? PROFILE_SECTIONS.goals
    : itemId === "survey" ? PROFILE_SECTIONS.survey
    : undefined;
}
