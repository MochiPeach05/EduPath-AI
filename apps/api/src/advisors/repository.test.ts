import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { PostgresAdvisorRepository } from "./repository.js";

// Invented accounts only.
const admin = {
  userId: "99999999-9999-4999-8999-999999999999", identityKey: "t:o", tenantId: "t", objectId: "o", name: "Quản trị",
  email: "qtv@vlu.edu.vn", username: "qtv@vlu.edu.vn", role: "admin", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

describe("the students of the advisors' lists (Quản lý sinh viên)", () => {
  it("counts a student as done with every step after a transcript, an assessment and an AI roadmap; the survey is optional (2026-11-14)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0 }] });
    const repository = new PostgresAdvisorRepository({ query } as unknown as DatabasePool, new Set(["vlu.edu.vn"]));
    await repository.students(admin, { q: "", status: "complete", page: 1, pageSize: 20 });
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).toContain(`WHEN 'complete' THEN "hasTranscript" AND assessed AND roadmap ELSE TRUE END`);
    // Who has not done the survey can still be listed.
    expect(sql).toContain(`WHEN 'no_survey' THEN NOT "surveyDone"`);
    expect(query.mock.calls[0]![1]).toEqual([null, null, "", "complete", 20, 0]);
  });
});
