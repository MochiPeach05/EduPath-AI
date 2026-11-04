// What a study roadmap may state as fact and what it must leave to the student's own word (user 2026-10-30: the AI
// roadmap praised "nền tảng vững chắc về React, có kinh nghiệm thực tập" from the profile survey while the system had no
// React score and the internship course was not studied yet; "Nên tách riêng phần 'bạn tự đánh giá' với 'hệ thống ghi
// nhận'"). The prompt gives both halves to the model, the validator holds the output to them and the AI tab shows them.
// Pure: built from the roadmap facts (recorded) and the survey answers.
import { formatScore } from "../competency-assessment/ai/prompt.js";
import { LEVEL_THRESHOLDS } from "../competency-assessment/constants.js";
import { fold } from "../competency-assessment/specialty.js";
import type { CourseState } from "../competency-assessment/types.js";
import type { SurveyFacts } from "../student/survey.js";
import type { RoadmapFacts } from "./facts.js";

/** A skill counts as shown by the transcript from the Khá threshold up. */
const PROVEN_SCORE = LEVEL_THRESHOLDS.good;
/** Survey questions whose answers are experience the system has no record of (only the internship course can be checked). */
const EXPERIENCE_QUESTIONS = new Set(["Thực tập", "Dự án ngoài môn học", "Kinh nghiệm dẫn dắt nhóm", "Đi làm thêm", "Tiếng Anh chuyên ngành"]);
/** Answers that claim nothing ("Chưa thực tập", "Không", "Khó khăn trong việc đọc hiểu"). */
const NOTHING_CLAIMED = /^(?:chua|khong|kho khan)\b/;
const STATE_WORDS: Partial<Record<CourseState, string>> = {
  passed: "đã đạt", exempt: "được miễn", in_progress: "đang học", failed: "chưa đạt", not_taken: "chưa học",
};
/** The words of the internship topic: what "kinh nghiệm thực tập" is about. */
export const INTERNSHIP_TOPIC = "thực tập";

export type RoadmapBasis = {
  /** What the student said in the survey that the roadmap could lean on (labels and their own words). */
  selfReported: string[];
  /** What the system has on record about those claims. */
  recorded: string[];
  /** Skills and technologies without evidence (or a weak one): the roadmap may name them only as the student's own view. */
  unproven: string[];
  /** An internship course of the program is passed: "kinh nghiệm thực tập" is on record. */
  internshipDone: boolean;
};

const boundary = (needle: string) => new RegExp(`(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}+#])`, "u");
/** "HTML/CSS" → its parts, "C#/C++" → "C#", "C++"; a name without parts is its own part. */
export const nameParts = (name: string) => name.split(/\s*[/,]\s*/).map((part) => part.trim()).filter((part) => part.length >= 2);
/** The technologies of the survey's "Thế mạnh" labels: "Web front-end (HTML, CSS, JavaScript, React)" → Web front-end, HTML, CSS, JavaScript, React. */
export function techTopics(labels: readonly string[]): string[] {
  const topics = labels.flatMap((label) => {
    const match = /^(.*?)\s*\((.*)\)\s*$/.exec(label);
    return match ? [...nameParts(match[1]!), ...nameParts(match[2]!)] : nameParts(label);
  });
  return [...new Map(topics.map((topic) => [fold(topic), topic])).values()];
}

/** "mức Trung bình, 55,4 điểm": the score as the pages show it, floored to the tenth (roadmap-v14; floored to a whole number before). */
const levelText = (skill: { score: number | null; levelLabel: string | null }) =>
  skill.score === null ? "chưa có điểm" : `mức ${skill.levelLabel ?? "chưa xếp"}, ${formatScore(skill.score)} điểm`;

/**
 * Both halves for one roadmap. Without the survey only the topics the career's gaps give are unproven; without
 * recorded facts (a roadmap made before roadmap-v9) the survey's technologies count as unproven.
 */
export function roadmapBasis(facts: Pick<RoadmapFacts, "skills" | "recorded">, survey: SurveyFacts | null): RoadmapBasis {
  const skills = facts.recorded?.skills ?? [];
  const internship = facts.recorded?.internship ?? [];
  const internshipDone = internship.some((course) => course.state === "passed" || course.state === "exempt");
  const unproven = new Map<string, string>();
  const add = (name: string) => { if (!unproven.has(fold(name))) unproven.set(fold(name), name); };
  // The career's skills to build that have no score or one under the Khá threshold.
  for (const skill of facts.skills) if (skill.kind !== "deepen" && (skill.score === null || skill.score < PROVEN_SCORE)) add(skill.name);
  if (!internshipDone) add(INTERNSHIP_TOPIC);
  if (!survey) return { selfReported: [], recorded: [], unproven: [...unproven.values()], internshipDone };

  // The technologies the student claims: the "Thế mạnh" labels, and every skill of the assessment their words name.
  const words = fold([...survey.tech, survey.achievements ?? ""].join(" | "));
  const topics = new Map(techTopics(survey.tech).map((topic) => [fold(topic), topic]));
  for (const skill of skills) {
    // Already there by name or by a part ("HTML/CSS" when HTML is a topic).
    if ([skill.name, ...nameParts(skill.name)].some((part) => topics.has(fold(part)))) continue;
    if (boundary(fold(skill.name)).test(words) || (nameParts(skill.name).length > 1 && nameParts(skill.name).every((part) => boundary(fold(part)).test(words)))) {
      topics.set(fold(skill.name), skill.name);
    }
  }
  const proven: string[] = [], weak: string[] = [], none: string[] = [];
  for (const topic of topics.values()) {
    const key = fold(topic);
    // The best score among the skills of that name, or of which it is a part ("HTML" of "HTML/CSS").
    const matches = skills.filter((skill) => fold(skill.name) === key || nameParts(skill.name).some((part) => fold(part) === key));
    const best = matches.filter((skill) => skill.score !== null).sort((a, b) => b.score! - a.score!)[0];
    if (best && best.score! >= PROVEN_SCORE) proven.push(`${topic} (${levelText(best)})`);
    else if (best) { weak.push(`${topic} (${levelText(best)})`); add(topic); }
    else { none.push(topic); add(topic); }
  }

  const selfReported: string[] = [];
  if (survey.tech.length) selfReported.push(`Công nghệ bạn chọn là thế mạnh: ${survey.tech.join("; ")}`);
  for (const item of survey.answers) {
    if (EXPERIENCE_QUESTIONS.has(item.question) && !NOTHING_CLAIMED.test(fold(item.answer))) selfReported.push(`${item.question}: ${item.answer}`);
  }
  const achievements = (survey.achievements ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (achievements.length) selfReported.push(`Thành tích bạn liệt kê: ${achievements.length} mục`);

  const recorded: string[] = [];
  if (proven.length) recorded.push(`Có điểm từ bảng điểm: ${proven.join("; ")}`);
  if (weak.length) recorded.push(`Điểm còn dưới mức Khá: ${weak.join("; ")}`);
  if (none.length) recorded.push(`Chưa có minh chứng (chưa có điểm từ học phần nào): ${none.join(", ")}`);
  if (internship.length) recorded.push(`Học phần thực tập trong chương trình: ${internship.map((course) => `${course.name} (${STATE_WORDS[course.state] ?? "chưa có kết quả"})`).join("; ")}`);
  recorded.push("Dự án ngoài môn học, dẫn dắt nhóm, đi làm thêm, tiếng Anh và thành tích: hệ thống không có dữ liệu để kiểm chứng.");
  return { selfReported, recorded, unproven: [...unproven.values()], internshipDone };
}
