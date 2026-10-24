import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { calculateAssessment } from "../competency-assessment/calculate.js";
import { syntheticCareer, syntheticInputs } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { DatabasePool } from "../db/pool.js";
import { interestMatch } from "./interests.js";
import { createCareerGuidanceRouter, guidanceCareers } from "./router.js";

// Career names as the faculty's catalog spells them (not personal data); synthetic student data otherwise.
const career = (nameVi: string, nameEn: string, categoryName: string) => ({ nameVi, nameEn, categoryName });
const survey = (field: string | null, tech: string[] = []) => ({ field, tech });

describe("careers matching the survey", () => {
  it("finds the careers of the field of interest", () => {
    const data = career("Chuyên viên phân tích dữ liệu", "Data Analyst", "Dữ liệu & Trí tuệ nhân tạo");
    expect(interestMatch(data, survey("data")).field).toBe("AI, dữ liệu");
    expect(interestMatch(career("Kỹ sư bảo mật dữ liệu", "Data Security Engineer", "An toàn thông tin"), survey("data")).field).toBeNull();
    expect(interestMatch(career("Kỹ sư bảo mật dữ liệu", "Data Security Engineer", "An toàn thông tin"), survey("security")).field).toBe("An ninh mạng");
    expect(interestMatch(career("Lập trình viên ứng dụng di động", "Mobile Developer", "Phát triển phần mềm"), survey("mobile")).field).toBe("Di động");
    expect(interestMatch(career("Lập trình viên phía máy chủ", "Backend Developer", "Phát triển phần mềm"), survey("web")).field).toBe("Web");
    expect(interestMatch(career("Kỹ sư IoT và hệ thống nhúng", "IoT and Embedded Systems Engineer", "Hạ tầng & Điện toán đám mây"), survey("embedded")).field).toBe("Nhúng, IoT");
    expect(interestMatch(career("Kỹ sư IoT và hệ thống nhúng", "IoT and Embedded Systems Engineer", "Hạ tầng & Điện toán đám mây"), survey("cloud")).field).toBeNull();
    expect(interestMatch(data, survey(null)).field).toBeNull();
  });

  it("names the liked technologies a career works with", () => {
    expect(interestMatch(career("Lập trình viên toàn diện", "Full-stack Developer", "Phát triển phần mềm"), survey(null, ["web_frontend", "web_backend", "ai_ml"])).tech)
      .toEqual(["Web front-end (HTML, CSS, JavaScript, React)", "Web back-end (Node.js, Java, .NET, PHP)"]);
    expect(interestMatch(career("Kỹ sư kiểm thử phần mềm", "QA/Test Engineer", "Kiểm thử & Chất lượng"), survey(null, ["testing"])).tech).toEqual(["Kiểm thử phần mềm"]);
    expect(interestMatch(career("Chuyên viên kiểm thử xâm nhập", "Penetration Tester", "An toàn thông tin"), survey(null, ["testing", "security"])).tech).toEqual(["An ninh mạng"]);
    expect(interestMatch(career("Nhà thiết kế trải nghiệm và giao diện", "UX/UI Designer", "Nghiệp vụ & Thiết kế"), survey(null, ["uiux"])).tech).toEqual(["Thiết kế UI/UX"]);
    expect(interestMatch(career("Kỹ sư thị giác máy tính", "Computer Vision Engineer", "Dữ liệu & Trí tuệ nhân tạo"), survey(null, ["ai_ml", "python_data", "game"])).tech)
      .toEqual(["Python, phân tích dữ liệu", "Trí tuệ nhân tạo, học máy"]);
  });
});

describe("careers against the competencies", () => {
  it("gives every career the fit Khoảng trống kỹ năng shows for the target career, best fit first", () => {
    const inputs = syntheticInputs();
    const target = syntheticCareer();
    const other = { ...target, id: "99999999-9999-4999-8999-999999999999", code: "NN999", nameVi: "Nghề không có kỹ năng đo được", nameEn: "Unmeasured",
      requirements: [{ id: "r-x", skillId: null, skillName: null, title: "Kỹ năng ngoài danh mục", isRequired: false }] };
    const catalog = [other, target].map((item) => ({ ...item, category: "7", categoryName: "Phát triển phần mềm", description: "" }));
    const careers = guidanceCareers(catalog, inputs, target.id, survey(null));
    const expected = calculateAssessment(inputs).career!;
    expect(careers.map((item) => item.id)).toEqual([target.id, other.id]);
    expect(careers[0]).toMatchObject({ isTarget: true, fit: { score: expected.fitScore, code: expected.fitCode, met: expected.counts.met, total: expected.counts.total } });
    expect(careers[0]!.requirements.map((row) => row.status)).toEqual(expected.requirements.map((row) => row.status));
    // A skill without a score counts 0 (comp-calc-v14), so this career scores 0 instead of "Chưa đủ dữ liệu".
    expect(careers[1]).toMatchObject({ isTarget: false, fit: { score: 0, code: "not_fit" }, requirements: [{ title: "Kỹ năng ngoài danh mục", status: "no_data" }] });
    // Without the competencies (no transcript, …) the careers are listed without a fit.
    expect(guidanceCareers(catalog, null, null, survey(null)).map((item) => [item.fit, item.requirements[0]!.status])).toEqual([[null, null], [null, null]]);
  });
});

describe("GET /api/student/career-guidance", () => {
  function setup(rows: { transcript?: boolean } = {}) {
    const query = vi.fn(async (sql: string) => {
      const result = (list: unknown[]) => ({ rowCount: list.length, rows: list });
      if (sql.startsWith("SELECT id FROM users")) return result([{ id: "student-id" }]);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return result([]);
      if (sql.startsWith("SELECT cohort_code,specialty,career_position_id")) return result([{ cohort_code: "K30", specialty: "CNPM", career_position_id: "c1" }]);
      if (sql.includes("FROM student_transcripts")) return result(rows.transcript ? [{ version: "v", data: {} }] : []);
      if (sql.includes("FROM career_positions c JOIN career_fields f")) {
        return result([{ id: "c1", code: "NN015", name_vi: "Lập trình viên toàn diện", name_en: "Full-stack Developer", version: "v1", category: "7",
          category_name: "Phát triển phần mềm", description: "Mô tả", requirements: [{ id: "r1", skillId: "s1", skillName: "SQL", title: "SQL", isRequired: true }] }]);
      }
      if (sql.startsWith("SELECT code,name FROM career_fields")) return result([{ code: "7", name: "Phát triển phần mềm" }, { code: "8", name: "Lĩnh vực trống" }]);
      if (sql.startsWith("SELECT career_position_id FROM student_profiles")) return result([{ career_position_id: "c1" }]);
      if (sql.includes("FROM stu_comp_assessments")) return result([]);
      if (sql.includes("FROM stu_profile_surveys")) {
        return result([{ version: "survey-v2", answers: { field: "web" }, interest_tech: ["web_backend"], interest_hobbies: ["reading"], has_achievements: false,
          achievements: null, updated_at: new Date() }]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as DatabasePool;
    const app = express();
    app.use((req, _res, next) => { Object.assign(req, { session: { user: { userId: "student-id", tenantId: "tenant-id", role: "student" } } }); next(); });
    app.use("/guidance", createCareerGuidanceRouter(pool));
    return app;
  }

  it("lists the careers with what blocks the fit, the target career and the survey matches", async () => {
    const response = await request(setup()).get("/guidance").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ blocked: "transcript_required", targetCareerId: "c1", surveyDone: true, fields: [{ code: "7", name: "Phát triển phần mềm" }] });
    expect(response.body.careers).toEqual([expect.objectContaining({
      id: "c1", isTarget: true, fit: null, categoryName: "Phát triển phần mềm",
      requirements: [expect.objectContaining({ title: "SQL", skillName: "SQL", isRequired: true, status: null })],
      interests: { field: "Web", tech: ["Web back-end (Node.js, Java, .NET, PHP)"] },
    })]);
  });

  it("refuses query parameters", async () => {
    await request(setup()).get("/guidance?x=1").expect(400, { error: "invalid_input" });
  });
});
