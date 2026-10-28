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
