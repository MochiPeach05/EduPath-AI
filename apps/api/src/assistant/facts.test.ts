import { describe, expect, it, vi } from "vitest";
import type { AssessmentResult } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import { MAX_ROADMAP_SKILLS } from "../roadmap/facts.js";
import type { RoadmapRow } from "../roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "../roadmap/test-fixture.js";
import { TRANSCRIPT_POLICY_VERSION } from "../student/consent.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { studentSources } from "./facts.js";
import { detectIntents } from "./intent.js";
import { MAX_TRANSCRIPT_ROWS, namedSections, transcriptCourseGroups } from "./transcript.js";

// Synthetic K29 data (roadmap/test-fixture.ts) and an invented transcript; no real student record.
const userId = "11111111-1111-4111-8111-111111111111";
const roadmap = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
  id: "44444444-4444-4444-8444-444444444444", assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null,
  createdAt: new Date("2026-10-24T03:00:00Z"), completedAt: new Date("2026-10-24T03:05:00Z"), model: "gemma4:e4b",
  facts: syntheticRoadmapFacts(), recent: false,
  output: { summary: "Bạn đang đúng tiến độ.", advice: ["Giữ điểm trung bình."], study: [], improve: [], skills: [], months: [] }, ...extra,
});

/** [code, name, credits, score10, score4, letter, result, review marks]; the (*) of a name marks a condition-only course. */
type Row = [string, string, number, number | null, number | null, string | null, string | null, string[]?];
function term(year: string | null, semester: string | null, rows: Row[], summaries: [string, string][] = []): TranscriptData["sections"][number] {
  return {
    id: year ? `${year}-${semester}` : "transfer", academicYear: year, semester, label: year ? `${year} · ${semester}` : "Điểm bảo lưu",
    summaries: summaries.map(([label, value]) => ({ label, value })),
    courses: rows.map(([code, name, credits, score10, score4, letter, result, review], index) => ({
      ordinal: index + 1, code, name, credits, score10, score4, letter, result, conditional: name.includes("*"), sourcePage: 1,
      // A CT row stored before CT was known: its printed "CT" cells marked as not numbers (withoutSettledReviews drops it).
      ...(review ? { review, printed: { score10: letter ?? "", score4: letter ?? "" } } : {}),
    })),
  };
}
/**
 * An invented K29 transcript: an English course exempted (MT) in "Điểm bảo lưu"; an F retaken and passed under the same
 * code; a VT being retaken in the term being studied; Cơ sở dữ liệu failed under its old code DIT0070 and passed under
 * 71ITIS30103 (a retake with a later cohort); a CT row stored with the old review marks; a blank result cell (C);
 * the cumulative lines printed at the end of each term.
 */
function transcriptData(): TranscriptData {
  return {
    schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 2, courseCount: 14,
    warnings: ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."],
    sections: [
      term(null, null, [["71ENG010012", "Anh văn 1", 2, null, null, "MT", "Đạt"]]),
      term("2023-2024", "HK01", [
        ["71ITBS10103", "Nhập môn Công nghệ thông tin", 3, 8.6, 3.7, "A", "Đạt"],
        ["71ITBS10203", "Cơ sở lập trình", 3, 3.2, 0, "F", "Không đạt"],
        ["71NAD110013", "GDQP1: Đường lối QP và AN của ĐCSVN (*)", 3, 7, 3, "B", "Đạt"],
      ], [["Số tín chỉ đạt học kỳ", "3"], ["Điểm TB học kỳ (Hệ 4)", "1.85"], ["Tổng số tín chỉ tích lũy", "3"], ["Điểm TB tích lũy (Hệ 4)", "3.70"]]),
      term("2023-2024", "HK02", [
        ["71ITBS10203", "Cơ sở lập trình", 3, 6.6, 2.5, "C+", "Đạt"],
        ["71ITSE30103", "Kỹ thuật lập trình", 3, null, null, "VT", "Không đạt"],
        ["DIT0070", "Cơ sở dữ liệu", 3, 3.5, 0, "F", "Không đạt"],
      ], [["Tổng số tín chỉ tích lũy", "6"], ["Điểm TB tích lũy (Hệ 4)", "3.10"]]),
      term("2024-2025", "HK01", [
        ["71ITIS30103", "Cơ sở dữ liệu", 3, 7.5, 3, "B", "Đạt"],
        ["71ITSE30503", "Lập trình ứng dụng Web", 3, 8.2, 3.5, "B+", "Đạt"],
        ["71ITSE30603", "Phát triển ứng dụng di động", 3, null, null, "CT", "Không đạt", ["invalid_score_10", "invalid_score_4", "unrecognized_letter_grade"]],
      ], [["Tổng số tín chỉ tích lũy", "12"], ["Điểm TB tích lũy (Hệ 4)", "3.15"]]),
      term("2024-2025", "HK02", [
        ["71ITSE41003", "Nhập môn Công nghệ phần mềm", 3, 9, 4, "A", "Đạt"],
        ["71ITIS30203", "Hệ quản trị cơ sở dữ liệu", 3, 6.4, 2, "C", null],
      ], [["Điểm TB học kỳ (Hệ 4)", "3.00"], ["Tổng số tín chỉ đăng ký", "21"], ["Điểm TB học tập (Hệ 4)", "2.66"], ["Tổng số tín chỉ tích lũy", "18"], ["Điểm TB tích lũy (Hệ 4)", "3.10"], ["Điểm TB tích lũy (Hệ 10)", "7.55"], ["Xếp loại học tập tích lũy", "Khá"]]),
      term("2025-2026", "HK01", [
        ["71ITSE30103", "Kỹ thuật lập trình", 3, null, null, null, null],
        ["71ITSE41203", "Kiểm thử phần mềm", 3, null, null, null, null],
      ]),
    ],
  };
}

/** savedBy: the survey was filled in by a cố vấn học tập or the Khoa (policy 2026-11-10); withdrawn: the student withdrew its consent. */
function db(options: { assessment?: boolean; computed?: AssessmentResult; survey?: boolean; consent?: string | null; roadmap?: RoadmapRow | null; transcript?: TranscriptData | null;
  savedBy?: "advisor" | "admin"; withdrawn?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.includes("FROM stu_comp_assessments")) {
      return rows(options.assessment === false ? [] : [{ id: ROADMAP_ASSESSMENT, createdAt: new Date("2026-10-24T01:00:00Z"), computed: options.computed ?? syntheticRoadmapResult() }]);
    }
    if (sql.includes("FROM student_transcripts")) {
      return rows(options.transcript === null ? [] : [{ data: options.transcript ?? transcriptData(), updatedAt: new Date("2026-10-20T03:00:00Z") }]);
    }
    if (sql.includes("FROM stu_profile_surveys")) return rows(options.survey === false ? [] : [{ ...syntheticSurveyRow(), saved_by_role: options.savedBy ?? null }]);
    if (sql.includes("AS withdrawn")) return rows([{ withdrawn: options.withdrawn === true }]);
    if (sql.includes("FROM data_consents")) return rows(options.consent === null ? [] : [{ policy_version: options.consent ?? TRANSCRIPT_POLICY_VERSION }]);
    if (sql.includes("FROM stu_roadmaps")) return rows(options.roadmap === null ? [] : [options.roadmap ?? roadmap()]);
    if (sql.includes("FROM student_profiles p")) return rows([{ cohortCode: "K29", specialty: null, career: "Lập trình viên Web" }]);
    if (sql.includes("FROM curriculum_relations")) return rows([]);
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query } as unknown as Pick<DatabasePool, "query">;
}

const transcriptText = async (question: string, options: Parameters<typeof db>[0] = {}) => {
  const context = await studentSources(db(options), userId, question, detectIntents(question), ROADMAP_NOW);
  return context.sources.find((source) => source.kind === "transcript")?.text ?? "";
};

describe("assistant student sources", () => {
  it("always gives the profile, the transcript, the career skills, the courses to take and the graduation pace, never identity data", async () => {
    const database = db();
    const context = await studentSources(database, userId, "Chào bạn", [], ROADMAP_NOW);
    expect(context.sources.map((source) => `${source.kind}:${source.link}`))
      .toEqual(["profile:#profile", "transcript:#profile", "assessment:#skill-gap", "roadmap:#roadmap", "graduation:#graduation"]);
    const text = context.sources.map((source) => source.text).join("\n");
    expect(text).toContain("Khóa: K29");
    expect(text).toContain("Kết quả tham khảo:");
    expect(text).not.toMatch(/@|MSSV|Mã sinh viên/);
    // The S01… keys belong to the roadmap prompt; answers copied them (2026-10-29).
    expect(text).not.toMatch(/\[S\d+\]/);
    // The transcript's scores only: never its PDF.
    const transcriptQuery = vi.mocked(database.query).mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("FROM student_transcripts"));
    expect(transcriptQuery).toContain("parsed_data");
    expect(transcriptQuery).not.toContain("pdf_data");
  });

  it("adds the skill levels, the AI roadmap and the consented survey when the question asks for them", async () => {
    const context = await studentSources(db(), userId, "Vì sao lộ trình đề xuất môn này, mình còn thiếu kỹ năng nào?", ["gaps", "roadmap", "course_reason"], ROADMAP_NOW);
    const titles = context.sources.map((source) => source.title);
    expect(titles).toContain("Mức các kỹ năng của bạn");
    expect(titles).toContain("Lộ trình AI đề xuất cho bạn");
    expect(titles).toContain("Khảo sát định hướng của bạn (bạn tự khai)");
    expect(context.sources.find((source) => source.title === "Lộ trình AI đề xuất cho bạn")?.text).toContain("Nhận định: Bạn đang đúng tiến độ.");
  });

  it("gives scores as the pages show them, floored to the tenth with their scale, and the GPA with two decimals (assistant-v10)", async () => {
    // Review 2026-11-04: AI texts wrote "69" for 69,9; the sources gave 0–100 scores with two decimals (72,37) the pages never show.
    const result = syntheticRoadmapResult();
    const context = await studentSources(db(), userId, "Kỹ năng Lập trình cơ bản của mình ở mức nào?", ["gaps"], ROADMAP_NOW);
    const text = context.sources.map((source) => source.text).join("\n");
    const shown = (value: number) => `${String(Math.floor(value * 10 + 1e-9) / 10).replace(".", ",")}/100`;
    expect(text).toContain(`(${shown(result.overall.score!)} điểm, dựa trên`);
    expect(text).toContain(`điểm phù hợp ${shown(result.career!.fitScore!)} (`);
    const skill = result.skills.find((item) => item.name === "Lập trình cơ bản")!;
    expect(text).toMatch(new RegExp(`- Lập trình cơ bản[^:\\n]*: \\S+ \\(${shown(skill.score!)} điểm\\)`));
    expect(text).toContain("Điểm trung bình tích lũy: 2,85/4 (yêu cầu tối thiểu 2,00/4)");
    expect(text).not.toMatch(/\d,\d{2}\/100/);
  });

  it("leaves the survey out without a valid consent and names a roadmap of an older assessment", async () => {
    const context = await studentSources(db({ consent: "2026-10-11", roadmap: roadmap({ assessmentId: "77777777-7777-4777-8777-777777777777" }) }), userId,
      "Học kỳ tới mình nên học gì?", ["roadmap"], ROADMAP_NOW);
    expect(context.sources.some((source) => source.title.startsWith("Khảo sát"))).toBe(false);
    expect(context.sources.find((source) => source.title === "Lộ trình AI đề xuất cho bạn")?.text).toContain("từ một kết quả đánh giá cũ hơn");
  });

  it("uses a survey a cố vấn học tập filled in without the student's consent, and not after the student withdrew it (policy 2026-11-10)", async () => {
    const titles = async (options: Parameters<typeof db>[0]) =>
      (await studentSources(db(options), userId, "Học kỳ tới mình nên học gì?", ["roadmap"], ROADMAP_NOW)).sources.map((source) => source.title);
    const survey = "Khảo sát định hướng của bạn (bạn tự khai)";
    expect(await titles({ consent: null, savedBy: "advisor" })).toContain(survey);
    expect(await titles({ consent: "2026-10-11", savedBy: "admin" })).toContain(survey);
    expect(await titles({ consent: null, savedBy: "advisor", withdrawn: true })).not.toContain(survey);
    expect(await titles({ consent: null })).not.toContain(survey);
  });

  it("lists the career's missing skills under their heading and looks up resources for them only (assistant-v11)", async () => {
    const result = syntheticRoadmapResult();
    const missing = result.career!.requirements.filter((requirement) => requirement.status !== "met" && requirement.skillName);
    expect(missing.length).toBeGreaterThan(0);
    const context = await studentSources(db(), userId, "Mình nên tự học kỹ năng còn thiếu ở đâu?", ["gaps", "resources"], ROADMAP_NOW);
    const text = context.sources.find((source) => source.kind === "assessment")!.text;
    expect(text).toContain("Kỹ năng của vị trí nghề nghiệp cần bổ sung:");
    expect(text).not.toContain("còn thiếu: không có");
    expect(context.gapSkills).toEqual(missing.map((requirement) => requirement.skillName).slice(0, 5));
    expect(context.sources[0]!.text).toContain("Bạn đã làm Đánh giá năng lực; kết quả mới nhất ngày 24/10/2026.");
  });

  it("says no skill is missing when every career skill is met, lists them to raise apart, with their resources (assistant-v11)", async () => {
    // User 2026-11-09: a student who met 4/4 skills was told "Hiện tại bạn chưa có kết quả Đánh giá năng lực mới nhất" and
    // given TCP/IP resources: the met skills sat under "cần bổ sung" and no line said that none was missing.
    const result = structuredClone(syntheticRoadmapResult());
    const career = result.career!;
    career.requirements.forEach((requirement, index) => Object.assign(requirement, {
      status: "met", statusLabel: "Đã đạt", score: 90 - index * 5, level: index ? "fair" : "good", levelLabel: index ? "Khá" : "Giỏi",
      deficit: null, deficitBand: null, deficitBandLabel: null,
    }));
    const total = career.requirements.length;
    career.counts = { total, met: total, below: 0, upcoming: 0, notStudied: 0, noData: 0, withData: total };
    career.summaryText = `Đạt ${total}/${total} kỹ năng`;
    result.selfStudy = [];
    result.skillPlans = [];
    const context = await studentSources(db({ computed: result }), userId, "Mình nên tự học kỹ năng còn thiếu ở đâu?", ["gaps", "resources"], ROADMAP_NOW);
    const text = context.sources.find((source) => source.kind === "assessment")!.text;
    expect(text).toContain(`Kỹ năng của vị trí nghề nghiệp còn thiếu: không có. Theo kết quả Đánh giá năng lực của bạn, bạn đã đạt ngưỡng cả ${total}/${total} kỹ năng của vị trí nghề nghiệp này.`);
    expect(text).not.toContain("cần bổ sung");
    const raise = text.slice(text.indexOf("Kỹ năng đã đạt, có thể học thêm để nâng lên mức cao hơn:")).split("\n").slice(1);
    expect(raise).toHaveLength(Math.min(total, MAX_ROADMAP_SKILLS));
    expect(raise.every((line) => /^- .+: Đã đạt mức (Khá|Giỏi): nâng lên mức (Giỏi|Xuất sắc)/.test(line))).toBe(true);
    // The resources of the career's own skills, the lowest score first, instead of whatever the question's words find.
    const named = career.requirements.filter((requirement) => requirement.skillName);
    expect(context.gapSkills).toEqual([...named].sort((a, b) => a.score! - b.score!).map((requirement) => requirement.skillName).slice(0, 5));
  });

  it("says how to get results when the student has no assessment, and still gives the transcript", async () => {
    const none = await studentSources(db({ assessment: false, transcript: null }), userId, "Mình thiếu gì?", ["gaps"], ROADMAP_NOW);
    expect(none.gapSkills).toEqual([]);
    expect(none.sources).toHaveLength(1);
    expect(none.sources[0]?.text).toContain("Vị trí nghề nghiệp mục tiêu: Lập trình viên Web");
    expect(none.sources[0]?.text).toContain("Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực nên EduPath AI chưa có cơ sở để tư vấn");

    const uploaded = await studentSources(db({ assessment: false }), userId, "Điểm tổng của mình là bao nhiêu?", ["transcript"], ROADMAP_NOW);
    expect(uploaded.sources.map((source) => source.kind)).toEqual(["profile", "transcript"]);
    expect(uploaded.sources[0]?.text).toContain("Bạn đã import bảng điểm nhưng chưa thực hiện Đánh giá năng lực nên EduPath AI chưa có cơ sở để tư vấn");
    expect(uploaded.sources[1]?.text).toContain("Điểm TB tích lũy (Hệ 4): 3,10");
  });
});

describe("assistant transcript source (assistant-v4)", () => {
  it("summarizes the newest printed GPA and credits, the term being studied and the courses not passed", async () => {
    const text = await transcriptText("Chào bạn");
    expect(text).toContain("cập nhật ngày 20/10/2026");
    expect(text).toContain("Học kỳ gần nhất có điểm: HK2 2024–2025.");
    // Copied as printed, from the latest graded term (not the older terms' cumulative lines).
    // The term prints three running figures: học tập (every registered credit, failed courses too) and tích lũy (passed only).
    expect(text).toContain("Tích lũy in trên bảng điểm ở cuối HK2 2024–2025: Tổng số tín chỉ đăng ký: 21; Điểm TB học tập (Hệ 4): 2,66; Tổng số tín chỉ tích lũy: 18; Điểm TB tích lũy (Hệ 4): 3,10; Điểm TB tích lũy (Hệ 10): 7,55; Xếp loại học tập tích lũy: Khá.");
    expect(text).toContain("tức GPA (điểm tổng) hiện tại của bạn, chỉ tính các môn đã đạt");
    expect(text).toContain("Điểm TB học tập tính mọi tín chỉ đã đăng ký, kể cả môn chưa đạt");
    expect(text).toContain("Đang học, chưa có điểm (HK1 2025–2026): 2 học phần: Kỹ thuật lập trình (71ITSE30103); Kiểm thử phần mềm (71ITSE41203).");
    // 11 courses in 14 rows: the retakes count once, Cơ sở dữ liệu under both codes too.
    expect(text).toContain("Số học phần trên bảng điểm: 11 (đã đạt 8, chưa đạt 1, đang học 2), trong 14 dòng vì có học phần học nhiều lần.");
    // CT (cấm thi) fails without a score; its old review marks are gone (withoutSettledReviews).
    expect(text).toContain("Học phần chưa đạt (chưa có lần học nào đạt, cần học lại):\n- Phát triển ứng dụng di động (71ITSE30603), 3 TC: CT (cấm thi) ở HK1 2024–2025");
    expect(text).not.toContain("đối chiếu");
    // VT (vắng thi), registered again in the term being studied.
    expect(text).toContain("Học phần chưa đạt, đang học lại:\n- Kỹ thuật lập trình (71ITSE30103), 3 TC: VT (vắng thi) ở HK2 2023–2024; đang học ở HK1 2025–2026");
    // A failed course passed later, under the same code or under another code with the same name.
    expect(text).toContain("- Cơ sở lập trình (71ITBS10203): F (3,2 điểm hệ 10) ở HK1 2023–2024; đạt C+ (6,6 điểm hệ 10) ở HK2 2023–2024");
    expect(text).toContain("- Cơ sở dữ liệu (mã DIT0070, sau đó 71ITIS30103): F (3,5 điểm hệ 10) ở HK2 2023–2024; đạt B (7,5 điểm hệ 10) ở HK1 2024–2025");
    // Not a grade question: no rows beyond the summary.
    expect(text).not.toContain("Toàn bộ bảng điểm");
    expect(text).not.toContain("Nhập môn Công nghệ phần mềm");
  });

  it("gives the rows of a course the question names, by name or by code, and says when a code is not on the transcript", async () => {
    const byName = await transcriptText("Môn Cơ sở dữ liệu mình được mấy điểm?");
    expect(byName).toContain("Học phần bạn hỏi: Cơ sở dữ liệu (mã DIT0070, sau đó 71ITIS30103), 3 TC: đã đạt.\n"
      + "- HK2 2023–2024: mã DIT0070, 3,5 điểm hệ 10, 0 hệ 4, điểm chữ F, Không đạt\n"
      + "- HK1 2024–2025: mã 71ITIS30103, 7,5 điểm hệ 10, 3 hệ 4, điểm chữ B, Đạt");
    // The longer name wins: "Hệ quản trị cơ sở dữ liệu" is not also "Cơ sở dữ liệu", and the reverse.
    expect(byName).not.toContain("Học phần bạn hỏi: Hệ quản trị");
    const longer = await transcriptText("Hệ quản trị cơ sở dữ liệu mình được bao nhiêu điểm?");
    expect(longer).toContain("Học phần bạn hỏi: Hệ quản trị cơ sở dữ liệu (71ITIS30203), 3 TC: đã đạt.\n- HK2 2024–2025: 6,4 điểm hệ 10, 2 hệ 4, điểm chữ C, Đạt");
    expect(longer).not.toContain("Học phần bạn hỏi: Cơ sở dữ liệu");
    // Specific rows, so not the whole transcript.
    expect(byName).not.toContain("Toàn bộ bảng điểm");

    const byCode = await transcriptText("Điểm của 71itse30603 và 71ITAI40103?");
    expect(byCode).toContain("Học phần bạn hỏi: Phát triển ứng dụng di động (71ITSE30603), 3 TC: chưa đạt.\n- HK1 2024–2025: CT (cấm thi, không có điểm), Không đạt");
    expect(byCode).toContain("Bảng điểm không có học phần mã 71ITAI40103.");
  });

  it("gives the rows and printed summaries of a term the question names", async () => {
    const text = await transcriptText("Học kỳ 1 năm 2024-2025 mình học những môn nào?");
    expect(text).toContain("HK1 2024–2025 (học kỳ bạn hỏi) (3 dòng):\n"
      + "- 71ITIS30103 Cơ sở dữ liệu (3 TC): 7,5 điểm hệ 10, 3 hệ 4, điểm chữ B, Đạt\n"
      + "- 71ITSE30503 Lập trình ứng dụng Web (3 TC): 8,2 điểm hệ 10, 3,5 hệ 4, điểm chữ B+, Đạt\n"
      + "- 71ITSE30603 Phát triển ứng dụng di động (3 TC): CT (cấm thi, không có điểm), Không đạt\n"
      + "Tổng kết in trên bảng điểm: Tổng số tín chỉ tích lũy: 12; Điểm TB tích lũy (Hệ 4): 3,15");
    expect(text).not.toContain("Nhập môn Công nghệ phần mềm");
  });

  it("gives the whole transcript, term by term with the printed summaries, for a grade question that names no course or term", async () => {
    const text = await transcriptText("Môn nào mình điểm cao nhất?");
    expect(text).toContain("Toàn bộ bảng điểm theo học kỳ");
    for (const code of ["71ENG010012", "71ITBS10103", "DIT0070", "71ITIS30103", "71ITSE41003", "71ITSE41203"]) expect(text).toContain(code);
    expect(text).toContain("Điểm bảo lưu (1 dòng):\n- 71ENG010012 Anh văn 1 (2 TC): MT (miễn thi, công nhận), Đạt");
    expect(text).toContain("- 71NAD110013 GDQP1: Đường lối QP và AN của ĐCSVN (3 TC, môn điều kiện): 7 điểm hệ 10, 3 hệ 4, điểm chữ B, Đạt");
    expect(text).toContain("- 71ITSE30103 Kỹ thuật lập trình (3 TC): VT (vắng thi, không có điểm), Không đạt");
    // A blank result cell follows the letter.
    expect(text).toContain("- 71ITIS30203 Hệ quản trị cơ sở dữ liệu (3 TC): 6,4 điểm hệ 10, 2 hệ 4, điểm chữ C, Đạt");
    expect(text).toContain("- 71ITSE41203 Kiểm thử phần mềm (3 TC): đang học, chưa có điểm");
    expect(text).toContain("Tổng kết in trên bảng điểm: Số tín chỉ đạt học kỳ: 3; Điểm TB học kỳ (Hệ 4): 1,85; Tổng số tín chỉ tích lũy: 3; Điểm TB tích lũy (Hệ 4): 3,70");
    // Terms in time order: "Điểm bảo lưu" first, the term being studied last.
    expect(text.indexOf("Điểm bảo lưu (1 dòng)")).toBeLessThan(text.indexOf("HK1 2023–2024 ("));
    expect(text.indexOf("HK2 2024–2025 (")).toBeLessThan(text.indexOf("HK1 2025–2026 ("));
  });

  it("reads an older cohort's F printed Đạt as passed, says what the transcript lacks and leaves identity lines out", async () => {
    const data = transcriptData();
    data.sections[4]!.courses.push({ ordinal: 3, code: "DIT0091", name: "Toán rời rạc", credits: 3, score10: 4.1, score4: 1, letter: "F", result: "Đạt", conditional: false, sourcePage: 2 });
    for (const section of data.sections) section.summaries = section.summaries.filter((summary) => !summary.label.includes("tích lũy"));
    data.sections[4]!.summaries.push({ label: "Họ tên", value: "Nguyễn Văn A" });
    const text = await transcriptText("Cho mình xem bảng điểm", { transcript: data });
    expect(text).toContain("- DIT0091 Toán rời rạc (3 TC): 4,1 điểm hệ 10, 1 hệ 4, điểm chữ F, Đạt");
    expect(text).toContain("Có dòng điểm chữ F nhưng ô Kết quả in Đạt");
    expect(text).toContain("Bảng điểm không in điểm trung bình tích lũy hay tổng số tín chỉ tích lũy.");
    expect(text).not.toContain("Nguyễn Văn A");
    expect(text).not.toContain("Họ tên");
  });

  it("leaves the oldest terms out of a whole transcript longer than MAX_TRANSCRIPT_ROWS, and says so", async () => {
    const data = transcriptData();
    const years = ["2016-2017", "2017-2018", "2018-2019", "2019-2020", "2020-2021", "2021-2022", "2022-2023"];
    const older = years.flatMap((year) => ["HK01", "HK02"].map((semester) => term(year, semester,
      Array.from({ length: 6 }, (_, index): Row => [`71ITXX${year.slice(2, 4)}${semester.slice(3)}${index}03`, `Học phần ${year} ${semester} số ${index + 1}`, 3, 7, 3, "B", "Đạt"]))));
    data.sections.splice(1, 0, ...older);
    const text = await transcriptText("Môn nào mình điểm cao nhất?", { transcript: data });
    expect(MAX_TRANSCRIPT_ROWS).toBe(80);
    expect(text).toMatch(/\(Không đưa vào \d+ dòng của các học kỳ cũ hơn: (phần Điểm bảo lưu|Điểm bảo lưu), HK1 2016–2017/);
    expect(text).toContain("- 71ITSE41203 Kiểm thử phần mềm (3 TC): đang học, chưa có điểm");
    const listed = text.slice(text.indexOf("Toàn bộ bảng điểm")).split("\n").filter((line) => line.startsWith("- "));
    expect(listed.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_ROWS);
    expect(listed.length).toBeGreaterThan(MAX_TRANSCRIPT_ROWS - 8);
  });

  it("gives no transcript source without a transcript", async () => {
    const context = await studentSources(db({ transcript: null }), userId, "Điểm tổng của mình là bao nhiêu?", ["transcript"], ROADMAP_NOW);
    expect(context.sources.some((source) => source.kind === "transcript")).toBe(false);
  });

  it("finds terms by code, by a term number with a year, as the latest term and as the n-th year", () => {
    const data = transcriptData();
    const ids = (question: string, grades = false) => namedSections(data, question, grades).map((section) => section.id);
    expect(ids("Điểm HK241 của mình?")).toEqual(["2024-2025-HK01"]);
    expect(ids("hk2 2023 - 2024 mình được bao nhiêu điểm")).toEqual(["2023-2024-HK02"]);
    expect(ids("Học kỳ 1 và học kỳ 2 năm học 2023-2024")).toEqual(["2023-2024-HK01", "2023-2024-HK02"]);
    expect(ids("Năm học 2024-2025 mình học gì?")).toEqual(["2024-2025-HK01", "2024-2025-HK02"]);
    expect(ids("Học kỳ vừa rồi mình được mấy điểm?")).toEqual(["2024-2025-HK02"]);
    expect(ids("Học kỳ này mình học môn gì?")).toEqual(["2024-2025-HK02", "2025-2026-HK01"]);
    expect(ids("Điểm năm hai của mình thế nào?")).toEqual(["2024-2025-HK01", "2024-2025-HK02"]);
    // A term number or a year alone is ambiguous: only for a grade question.
    expect(ids("Học kỳ 1 năm tới mình nên học gì?")).toEqual([]);
    expect(ids("Điểm học kỳ 1 của mình", true)).toEqual(["2023-2024-HK01", "2024-2025-HK01", "2025-2026-HK01"]);
    expect(ids("Kỹ năng 2 của mình là gì, năm 2026 mình nên học gì?")).toEqual([]);
    expect(ids("Điểm học kỳ 2 năm 2024 của mình", true)).toEqual(["2023-2024-HK02", "2024-2025-HK02"]);
  });

  it("joins a failed course with the same-name course it was passed or retaken under, and only then", () => {
    const groups = transcriptCourseGroups(transcriptData());
    expect(groups.find((group) => group.codes.includes("DIT0070"))).toMatchObject({ codes: ["DIT0070", "71ITIS30103"], state: "passed" });
    expect(groups.find((group) => group.codes.includes("71ITSE30103"))?.state).toBe("in_progress");
    expect(groups.find((group) => group.codes.includes("71ITSE30603"))?.state).toBe("failed");
    // Two passed courses with one name stay two courses.
    const twice = transcriptData();
    twice.sections[5]!.courses.push({ ordinal: 3, code: "71ITBS10199", name: "Nhập môn Công nghệ thông tin", credits: 3, score10: 7, score4: 3, letter: "B", result: "Đạt", conditional: false, sourcePage: 2 });
    expect(transcriptCourseGroups(twice).filter((group) => group.names.includes("Nhập môn Công nghệ thông tin"))).toHaveLength(2);
  });
});
