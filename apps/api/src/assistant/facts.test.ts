import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import type { RoadmapRow } from "../roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "../roadmap/test-fixture.js";
import { TRANSCRIPT_POLICY_VERSION } from "../student/consent.js";
import { studentSources } from "./facts.js";

// Synthetic K29 data (roadmap/test-fixture.ts); no real student record.
const userId = "11111111-1111-4111-8111-111111111111";
const roadmap = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
  id: "44444444-4444-4444-8444-444444444444", assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null,
  createdAt: new Date("2026-10-24T03:00:00Z"), completedAt: new Date("2026-10-24T03:05:00Z"), model: "gemma4:e4b",
  facts: syntheticRoadmapFacts(), recent: false,
  output: { summary: "Bạn đang đúng tiến độ.", advice: ["Giữ điểm trung bình."], study: [], improve: [], skills: [], months: [] }, ...extra,
});

function db(options: { assessment?: boolean; survey?: boolean; consent?: string | null; roadmap?: RoadmapRow | null } = {}) {
  const query = vi.fn(async (sql: string) => {
    const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.includes("FROM stu_comp_assessments")) {
      return rows(options.assessment === false ? [] : [{ id: ROADMAP_ASSESSMENT, createdAt: new Date("2026-10-24T01:00:00Z"), computed: syntheticRoadmapResult() }]);
    }
    if (sql.includes("FROM stu_profile_surveys")) return rows(options.survey === false ? [] : [syntheticSurveyRow()]);
    if (sql.includes("FROM data_consents")) return rows(options.consent === null ? [] : [{ policy_version: options.consent ?? TRANSCRIPT_POLICY_VERSION }]);
    if (sql.includes("FROM stu_roadmaps")) return rows(options.roadmap === null ? [] : [options.roadmap ?? roadmap()]);
    if (sql.includes("FROM student_profiles p")) return rows([{ cohortCode: "K29", specialty: null, career: "Lập trình viên Web" }]);
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query } as unknown as Pick<DatabasePool, "query">;
}

describe("assistant student sources", () => {
  it("always gives the profile, the career skills, the courses to take and the graduation pace, never identity data", async () => {
    const context = await studentSources(db(), userId, "Chào bạn", [], ROADMAP_NOW);
    expect(context.sources.map((source) => `${source.kind}:${source.link}`)).toEqual(["profile:#profile", "assessment:#skill-gap", "roadmap:#roadmap", "graduation:#graduation"]);
    const text = context.sources.map((source) => source.text).join("\n");
    expect(text).toContain("Khóa: K29");
    expect(text).toContain("Kết quả tham khảo:");
    expect(text).not.toMatch(/@|MSSV|Mã sinh viên/);
    // The S01… keys belong to the roadmap prompt; answers copied them (2026-10-29).
    expect(text).not.toMatch(/\[S\d+\]/);
  });

  it("adds the skill levels, the AI roadmap and the consented survey when the question asks for them", async () => {
    const context = await studentSources(db(), userId, "Vì sao lộ trình đề xuất môn này, mình còn thiếu kỹ năng nào?", ["gaps", "roadmap", "course_reason"], ROADMAP_NOW);
    const titles = context.sources.map((source) => source.title);
    expect(titles).toContain("Mức các kỹ năng của bạn");
    expect(titles).toContain("Lộ trình AI đề xuất cho bạn");
    expect(titles).toContain("Khảo sát định hướng của bạn (bạn tự khai)");
    expect(context.sources.find((source) => source.title === "Lộ trình AI đề xuất cho bạn")?.text).toContain("Nhận định: Bạn đang đúng tiến độ.");
  });

  it("leaves the survey out without a valid consent and names a roadmap of an older assessment", async () => {
    const context = await studentSources(db({ consent: "2026-10-11", roadmap: roadmap({ assessmentId: "77777777-7777-4777-8777-777777777777" }) }), userId,
      "Học kỳ tới mình nên học gì?", ["roadmap"], ROADMAP_NOW);
    expect(context.sources.some((source) => source.title.startsWith("Khảo sát"))).toBe(false);
    expect(context.sources.find((source) => source.title === "Lộ trình AI đề xuất cho bạn")?.text).toContain("từ một kết quả đánh giá cũ hơn");
  });

  it("says how to get results when the student has no assessment", async () => {
    const context = await studentSources(db({ assessment: false }), userId, "Mình thiếu gì?", ["gaps"], ROADMAP_NOW);
    expect(context.gapSkills).toEqual([]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.text).toContain("Nghề mục tiêu: Lập trình viên Web");
    expect(context.sources[0]?.text).toContain("chưa có kết quả đánh giá năng lực");
  });
});
