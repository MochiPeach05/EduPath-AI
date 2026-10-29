// What the student has done yet, for Trợ lý AI to answer about their own results (2026-10-29, user: "Khi người dùng chưa
// chạy file đánh giá năng lực, chưa import bảng điểm thì nên trả lời một cách rõ ràng hơn bạn chưa thực hiện đánh giá năng
// lực nên chúng tôi chưa có cơ sở để tư vấn"): the four items of the Tổng quan gate (transcript, specialty, target career,
// profile survey) plus a competency assessment and an AI roadmap. A question about the student's own results that these
// cannot answer gets a fixed answer at once, without an AI job; the chat also suggests the next questions from them
// ("ở trên khung đoạn nhập đoạn chat nên có các câu hỏi đề xuất để sinh viên chọn tiếp"). v2 (2026-10-29, user: "Tôi thấy
// hiện tại nó trả lời không có human lắm"): the same answers in the warm voice of assistant-v6, short, without [n] in the
// text; the pages they point to are the sources, numbered in the order the steps mention them.
import type { PoolClient } from "pg";
import { fold } from "../competency-assessment/specialty.js";
import type { DatabasePool } from "../db/pool.js";
import { activeConsentVersion, isValidConsent } from "../student/consent.js";
import { readSurvey } from "../student/survey.js";
import type { AssistantSourceKind } from "./facts.js";
import type { AssistantIntent } from "./intent.js";

type Db = Pick<DatabasePool, "query"> | PoolClient;
export type Readiness = { transcript: boolean; specialty: boolean; career: boolean; survey: boolean; assessment: boolean; roadmap: boolean };
type PageSource = { n: number; kind: AssistantSourceKind; title: string; link: string };
export type ReadinessAnswer = { content: string; sources: PageSource[] };

/** prompt_version of the answers written here instead of by the AI. */
export const READINESS_ANSWER_VERSION = "assistant-readiness-v2";
const MAX_SUGGESTIONS = 6;

export async function readReadiness(db: Db, userId: string): Promise<Readiness> {
  const row = (await db.query<Omit<Readiness, "survey">>(
    `SELECT EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id=$1) AS transcript,
       EXISTS (SELECT 1 FROM student_profiles p WHERE p.user_id=$1 AND p.specialty IS NOT NULL) AS specialty,
       EXISTS (SELECT 1 FROM student_profiles p WHERE p.user_id=$1 AND p.career_position_id IS NOT NULL) AS career,
       EXISTS (SELECT 1 FROM stu_comp_assessments a WHERE a.user_id=$1) AS assessment,
       EXISTS (SELECT 1 FROM stu_roadmaps r WHERE r.user_id=$1 AND r.status='completed') AS roadmap`, [userId])).rows[0];
  // The survey counts as on Tổng quan: answered, and agreed to under a policy whose consents still count.
  const survey = await readSurvey(db, userId);
  const surveyDone = survey?.complete === true && isValidConsent(await activeConsentVersion(db, userId, "profile_survey"));
  return {
    transcript: row?.transcript === true, specialty: row?.specialty === true, career: row?.career === true,
    survey: surveyDone, assessment: row?.assessment === true, roadmap: row?.roadmap === true,
  };
}

/** The asker as "mình", "tôi", "em", "tớ" or "tui"; with diacritics, so "thông minh" or "học kỳ tới" are not read as them. */
const PRONOUN = /(?<![\p{L}\p{N}])(mình|tôi|em|tớ|tui)(?![\p{L}\p{N}])/u;
/** The same typed without diacritics, after dropping the common words that hold "minh" or "toi". */
const PLAIN_WORDS = /\b(thong|chung|van|binh|thuyet|thanh) minh\b|\bminh (hoa|bach|man|chung|tri)\b|\btoi (uu|thieu|da)\b|\b(hoc ky|ky|nam|tuan|thang) toi\b/g;
const PLAIN_PRONOUN = /\b(minh|toi|em|tui)\b/;
/** "còn thiếu" asks about the asker even without a pronoun ("Kỹ năng nào còn thiếu cho nghề này?"). */
const OWN_GAP = /\b(con|dang) thieu\b/;
/** How-to questions ("Làm sao để mình import bảng điểm?") are answered by the AI from the portal guides. */
const HOW_TO = /\b(lam sao (de|cho)|lam the nao( de)?|the nao de|bang cach nao|huong dan|cac buoc|cach (de |nao de )?(import|tai|nhap|chon|chay|tao|lam|xem|dung|cap nhat|xoa|doi|sua))\b/;
/** Questions on the training catalog, answered from it whatever the student has done. */
const CATALOG = /\b(ke hoach dao tao|chuong trinh dao tao|ctdt|khdt|tien quyet|hoc truoc|song hanh)\b/;
/** A graduation question about the student's own standing ("Mình đủ điều kiện tốt nghiệp chưa?"). */
const GRADUATION_STANDING = /\b(du dieu kien|chua du|con thieu|con bao nhieu|da dat|dat chua|kip|bao gio|khi nao)\b/;
/** Retakes: the transcript lists the courses not passed yet. */
const RETAKE = /\b(hoc lai|thi lai|hoc cai thien|cai thien diem)\b/;

function personal(question: string, text: string): boolean {
  const lower = question.normalize("NFC").toLowerCase();
  if (PRONOUN.test(lower) || OWN_GAP.test(text)) return true;
  return text === lower && PLAIN_PRONOUN.test(text.replace(PLAIN_WORDS, " "));
}

const PAGES = {
  profile: { kind: "guide", title: "Hồ sơ và bảng điểm", link: "#profile" },
  career: { kind: "guide", title: "Định hướng nghề nghiệp", link: "#career" },
  competency: { kind: "guide", title: "Đánh giá năng lực", link: "#competency" },
  roadmap: { kind: "guide", title: "Lộ trình học tập", link: "#roadmap" },
  graduation: { kind: "guide", title: "Điều kiện xét tốt nghiệp", link: "#graduation" },
} as const;
type Page = keyof typeof PAGES;

/** A fixed answer: its lines, and the pages it points to as sources, numbered in the order given (each page once). */
function answer(lines: readonly string[], pages: readonly Page[]): ReadinessAnswer {
  return { content: lines.join("\n"), sources: [...new Set(pages)].map((page, index) => ({ n: index + 1, ...PAGES[page] })) };
}

type Step = { text: string; pages: Page[] };

/** The steps still to do before a competency assessment, the assessment last (then the AI roadmap, when asked about). */
function assessmentSteps(readiness: Readiness, roadmap: boolean): Step[] {
  const steps: Step[] = [];
  if (!readiness.transcript) steps.push({ text: "Import bảng điểm PDF ở trang Hồ sơ và bảng điểm.", pages: ["profile"] });
  if (!readiness.specialty && !readiness.career) steps.push({ text: "Chọn chuyên ngành và nghề mục tiêu.", pages: ["profile", "career"] });
  else if (!readiness.specialty) steps.push({ text: "Chọn chuyên ngành ở trang Hồ sơ và bảng điểm.", pages: ["profile"] });
  else if (!readiness.career) steps.push({ text: "Chọn nghề mục tiêu ở trang Định hướng nghề nghiệp.", pages: ["career"] });
  if (!readiness.survey) steps.push({ text: "Làm Khảo sát định hướng ở trang Hồ sơ và bảng điểm.", pages: ["profile"] });
  steps.push({ text: "Bấm Đánh giá năng lực ở trang Đánh giá năng lực.", pages: ["competency"] });
  if (roadmap && !readiness.roadmap) steps.push({ text: "Bấm Tạo lộ trình ở trang Lộ trình học tập.", pages: ["roadmap"] });
  return steps;
}

const MEANWHILE = "Trong lúc chờ, bạn vẫn có thể hỏi mình về chương trình đào tạo, điều kiện tốt nghiệp hay cách dùng EduPath AI.";

/**
 * The fixed answer for a question about the student's own results that their data cannot answer yet, or null (the AI
 * answers). Only a question about the asker counts, never a how-to or a catalog question. A grade question, or one on
 * the student's own graduation standing, needs the transcript (and is answered from it once there); a question on skill
 * gaps, the roadmap or why a course is recommended needs a competency assessment; why the AI roadmap recommends its
 * courses needs a roadmap.
 */
export function readinessAnswer(readiness: Readiness, intents: readonly AssistantIntent[], question: string): ReadinessAnswer | null {
  const text = fold(question.normalize("NFC")).toLowerCase();
  if (!personal(question, text) || HOW_TO.test(text)) return null;
  const aboutRoadmap = intents.includes("course_reason") && /\blo trinh\b/.test(text);
  if (intents.includes("transcript") || (RETAKE.test(text) && readiness.transcript)) {
    return readiness.transcript ? null : answer([
      "Bạn chưa import bảng điểm nên mình chưa xem được điểm của bạn. Bạn import bảng điểm PDF ở trang Hồ sơ và bảng điểm (phần Bảng điểm của tôi) nhé. "
        + "Có bảng điểm rồi, bạn hỏi mình điểm trung bình tích lũy, điểm từng môn, môn còn nợ hay số tín chỉ đã tích lũy đều được.",
    ], ["profile"]);
  }
  if (intents.includes("graduation") && GRADUATION_STANDING.test(text)) {
    return readiness.transcript ? null : answer([
      "Bạn chưa import bảng điểm nên mình chưa có cơ sở để đối chiếu kết quả học tập của bạn với tiêu chuẩn xét tốt nghiệp. "
        + "Bạn import bảng điểm PDF ở trang Hồ sơ và bảng điểm trước nhé, sau đó xem trang Điều kiện xét tốt nghiệp hoặc hỏi lại mình.",
    ], ["profile", "graduation"]);
  }
  if (CATALOG.test(text)) return null;
  if (intents.some((intent) => intent === "gaps" || intent === "roadmap" || intent === "course_reason") && !readiness.assessment) {
    const steps = assessmentSteps(readiness, aboutRoadmap);
    const pages = steps.flatMap((step) => step.pages);
    // Only the assessment is left: one sentence is enough.
    if (steps.length === 1) {
      return answer([
        "Bạn chỉ còn thiếu bước Đánh giá năng lực nên mình chưa có cơ sở để tư vấn câu này. Bạn bấm Đánh giá năng lực ở trang Đánh giá năng lực nhé, xong rồi hỏi lại mình.",
      ], pages);
    }
    const missing = readiness.transcript ? "Hiện bạn chưa làm Đánh giá năng lực" : "Hiện bạn chưa import bảng điểm và chưa làm Đánh giá năng lực";
    const after = aboutRoadmap ? "Xong rồi bạn hỏi lại, mình sẽ giải thích vì sao từng môn được đề xuất." : "Xong rồi bạn hỏi lại câu này, mình sẽ trả lời sát với bạn hơn.";
    return answer([
      `${missing}, nên mình chưa có cơ sở để tư vấn câu này. Bạn hoàn thành giúp mình mấy bước sau nhé:`,
      ...steps.map((step, index) => `${index + 1}. ${step.text}`),
      `${after} ${MEANWHILE}`,
    ], pages);
  }
  if (aboutRoadmap && !readiness.roadmap) {
    return readiness.survey
      ? answer([
        "Bạn chưa tạo Lộ trình AI nên chưa có môn nào được đề xuất để mình giải thích. Bạn bấm Tạo lộ trình ở tab Lộ trình AI đề xuất (trang Lộ trình học tập) nhé, "
          + "có lộ trình rồi mình sẽ giải thích lý do của từng môn.",
      ], ["roadmap"])
      : answer([
        "Bạn chưa tạo Lộ trình AI nên chưa có môn nào được đề xuất để mình giải thích. Lộ trình AI cần Khảo sát định hướng, nên bạn làm khảo sát ở trang Hồ sơ và bảng điểm "
          + "trước, rồi bấm Tạo lộ trình ở trang Lộ trình học tập nhé. Có lộ trình rồi mình sẽ giải thích lý do của từng môn.",
      ], ["profile", "roadmap"]);
  }
  return null;
}

/** Up to MAX_SUGGESTIONS next questions: what the student still has to set up first, then questions about their results. */
export function suggestedQuestions(readiness: Readiness): string[] {
  const list: string[] = [];
  if (!readiness.transcript) list.push("Làm sao để import bảng điểm PDF?");
  if (!readiness.specialty || !readiness.career) list.push("Làm sao để chọn chuyên ngành và nghề mục tiêu?");
  if (!readiness.survey) list.push("Khảo sát định hướng dùng để làm gì?");
  if (!readiness.assessment) list.push("Làm sao để chạy Đánh giá năng lực?");
  else if (!readiness.roadmap) list.push("Làm sao để tạo Lộ trình AI?");
  if (readiness.transcript) list.push("Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?");
  if (readiness.assessment) list.push("Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?", "Học kỳ tới mình nên học những môn nào?");
  if (readiness.assessment && readiness.roadmap) list.push("Vì sao lộ trình đề xuất các môn này cho mình?");
  list.push("Điều kiện xét tốt nghiệp của khóa mình là gì?");
  if (readiness.assessment) list.push("Mình nên tự học kỹ năng còn thiếu ở đâu?");
  list.push("EduPath AI dùng dữ liệu của mình như thế nào?");
  return list.slice(0, MAX_SUGGESTIONS);
}
