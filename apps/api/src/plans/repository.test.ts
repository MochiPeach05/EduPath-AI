import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { identity, type PlanData } from "./model.js";
import { PlanRepository } from "./repository.js";

describe("PlanRepository.link", () => {
  it("links by normalized major and cohort using the curriculum current revision", async () => {
    const data: PlanData = {
      schemaVersion: 1,
      name: "Plan K29",
      major: " CÔNG NGHỆ THÔNG TIN ",
      cohortCode: "K29",
      admissionYear: 2023,
      totalCredits: null,
      notes: "",
      items: [],
      terms: [],
      sections: [],
      sourceWarnings: [],
      warnings: [],
      curriculum: null,
    };
    const currentRevision = {
      id: "curriculum-id",
      revisionId: "current-revision-id",
      version: 4,
      data: { name: "Curriculum K29", totalCredits: 120, courses: [] },
    };
    const query = vi.fn(async () => ({ rowCount: 1, rows: [currentRevision] }));
    const repository = new PlanRepository({ query } as unknown as DatabasePool);

    await repository.link(data);

    expect(identity(data)).toBe("cong nghe thong tin:K29");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("JOIN curriculum_revisions r ON r.id=c.current_revision"),
      [identity(data)],
    );
    expect(data.curriculum).toEqual({
      id: "curriculum-id",
      revisionId: "current-revision-id",
      version: 4,
      name: "Curriculum K29",
    });
  });
});

// User 2026-11-10 ("dùng luôn mã thực tế"; curricula/real-codes.ts): a KHĐT row the file writes under a code students never
// register carries the graduation standard's code as realCode, the mapping of the plan's CTĐT as the student KHĐT reads it
// (readPlanRealCodes, plans/student-router.ts); the row keeps the file's code, by which it is edited. Catalog data of ngành
// CNTT K28 only.
describe("PlanRepository.detail", () => {
  const item = (id: string, code: string, name: string) => ({
    id, position: 1, code, name, credits: 3, type: "BB", termCode: "HK221", semester: 1, studyYear: 1, sectionId: "", prerequisite: "",
    prior: "", notes: "", hours: { lecture: null, practice: null, project: null, internship: null }, sourceRow: 12, sourceSheet: "K28", sourceCells: {},
  });
  const plan = (items: ReturnType<typeof item>[]): PlanData => ({
    schemaVersion: 1, name: "Kế hoạch đào tạo CNTT K28", major: "Công nghệ thông tin", cohortCode: "K28", admissionYear: 2022, totalCredits: 130,
    notes: "", items, terms: [{ code: "HK221", semester: 1, studyYear: 1, sourceCredits: 18 }], sections: [], sourceWarnings: [], warnings: [], curriculum: null,
  });
  const ctdt = [["71ITMA10203", "Đại số tuyến tính và ứng dụng"], ["71ITBS10103", "Nhập môn Công nghệ thông tin"]] as const;
  const standard = {
    cohort_code: "K28",
    data: { specialty: "", classBlock: "71K28CNTT", standardCode: "71K28CNTT_TiendohoctapQC1423", major: "Công nghệ thông tin (7480201)",
      courses: [{ code: "71MATL10053", name: "Đại số tuyến tính và ứng dụng", credits: 3 }, { code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: 3 }] },
  };
  const setup = (data: PlanData, options: { curriculum?: boolean } = {}) => {
    const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("FROM training_plans c JOIN training_plan_revisions r"))
        return rows([{ id: "p1", isActive: true, token: "t", updatedAt: "2026-11-01", revisionId: "r1", version: 1, data, sourceFilename: "k28.xlsx" }]);
      if (sql.includes("FROM training_plan_revisions WHERE plan_id")) return rows([{ id: "r1", version: 1, note: "Import", createdAt: "2026-11-01" }]);
      if (sql.includes("FROM training_plan_events")) return rows([]);
      if (sql.includes("FROM curricula c JOIN curriculum_courses cc"))
        return rows(options.curriculum === false ? [] : ctdt.map(([code, name]) => ({ cohort_code: "K28", code, name, credits: "3" })));
      if (sql.includes("FROM graduation_standards g")) return rows([standard]);
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    });
    return { query, repository: new PlanRepository({ query } as unknown as DatabasePool) };
  };

  it("marks the rows of the codes the plan's CTĐT maps with realCode, the other rows as filed", async () => {
    const data = plan([item("row-12", "71ITMA10203", "Đại số tuyến tính và ứng dụng"), item("row-13", "71ITBS10103", "Nhập môn Công nghệ thông tin")]);
    const before = JSON.stringify(data);
    const { query, repository } = setup(data);
    const detail = await repository.detail("p1");
    expect(detail.data.items).toEqual([{ ...data.items[0], realCode: "71MATL10053" }, data.items[1]]);
    expect(detail).toMatchObject({ id: "p1", version: 1, history: [{ id: "r1" }], events: [] });
    // The row read keeps the file's code: nothing else of the plan changes.
    expect(JSON.stringify(data)).toBe(before);
    // The CTĐT is the active one of the plan's identity, as the student KHĐT reads it.
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE c.is_active AND c.identity_key=$1"), ["cong nghe thong tin:K28"]);
  });

  it("adds no realCode to a row whose code the CTĐT does not map, nor without an active CTĐT", async () => {
    // 71MATL10053 itself (a KHĐT already writing the real code) and another course: as filed.
    const filed = plan([item("row-12", "71MATL10053", "Đại số tuyến tính và ứng dụng"), item("row-13", "71ITBS10103", "Nhập môn Công nghệ thông tin")]);
    expect((await setup(filed).repository.detail("p1")).data.items).toEqual(filed.items);
    const paper = plan([item("row-12", "71ITMA10203", "Đại số tuyến tính và ứng dụng")]);
    const { query, repository } = setup(paper, { curriculum: false });
    expect((await repository.detail("p1")).data.items).toEqual(paper.items);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM graduation_standards g"))).toBe(false);
  });
});

describe("PlanRepository.list", () => {
  it("numbers the rows in the list's own order and sorts the whole list by a known column before paging", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PlanRepository({ query } as unknown as DatabasePool);
    await repository.list("", "K29", "", 1, "stt", "desc");
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('row_number() OVER (ORDER BY "cohortCode" DESC, id ASC)::int AS stt FROM filtered');
    expect(sql).toContain('FROM numbered ORDER BY "cohortCode" ASC, id DESC LIMIT 10 OFFSET $4');
    expect(values).toEqual(["", "K29", "", 0]);
    await repository.list("", "", "", 1, "isActive", "asc");
    expect(query.mock.calls[2]![0]).toContain(`ORDER BY CASE "isActive" WHEN 'true' THEN 0 WHEN 'false' THEN 1 END ASC NULLS LAST, "cohortCode" DESC, id ASC LIMIT`);
  });
});
