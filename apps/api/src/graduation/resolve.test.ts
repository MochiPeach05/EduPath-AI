import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { GraduationData } from "./model.js";
import { normalizeCohortCode, profileSpecialty, resolveCohortStandard, resolveStudentStandard, standardIdentity, standardMajor } from "./resolve.js";

// Synthetic standards only: ids and names are invented, program codes follow the public 7480201-0x scheme.
type Row = { id: string; revision_id: string; version: number; cohort: string; data: Partial<GraduationData> };
const standard = (id: string, cohort: string, data: Partial<GraduationData>): Row => ({
  id, revision_id: `${id}-rev`, version: 2, cohort,
  data: { name: `Tiêu chuẩn ${id}`, standardCode: "TN", classBlock: "71K29CNTT", specialty: "", gpaScale: null, groups: [], courses: [], ...data },
});

function fakeDb(rows: Row[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (!sql.includes("FROM graduation_standards")) throw new Error(`unexpected query: ${sql}`);
    const list = rows.filter((row) => row.cohort === params[0]).map(({ cohort: _cohort, ...row }) => row);
    return { rowCount: list.length, rows: list };
  });
  // A client for the code under test that keeps the mock's API for the assertions.
  return { query } as unknown as Pick<PoolClient, "query"> & { query: typeof query };
}

const cnpm = standard("std-cnpm", "K29", { specialty: "Công nghệ phần mềm (7480201-03)", classBlock: "71K29CNTT_7480201-03" });
const cndl = standard("std-cndl", "K29", { specialty: "Công nghệ dữ liệu", classBlock: "71K29CNTT", standardCode: "71K29CNTT_7480201-02_TN04", gpaScale: 10 });
const general = standard("std-k27", "K27", { specialty: "Công nghệ thông tin", classBlock: "71K27CNTT" });

describe("profile values", () => {
  it("normalizes the cohort like the standards store it and keeps only known specialty codes", () => {
    expect(normalizeCohortCode(" k29 ")).toBe("K29");
    for (const blank of [null, undefined, "", "   "]) expect(normalizeCohortCode(blank)).toBeNull();
    expect(profileSpecialty("CNDL")).toBe("CNDL");
    for (const other of ["cnpm", "Công nghệ phần mềm", null, 3]) expect(profileSpecialty(other)).toBeNull();
    expect(standardIdentity({ specialty: "a", classBlock: "b", standardCode: "c" })).toEqual({ specialty: "a", classBlock: "b", standardCode: "c", major: "" });
    expect(standardIdentity({ specialty: "a", classBlock: "b", standardCode: "c", major: "Hệ thống thông tin (7480104)" }).major).toBe("Hệ thống thông tin (7480104)");
  });
});

describe("resolveCohortStandard (D3)", () => {
  it("reads active current standards of the cohort in a deterministic order", async () => {
    const db = fakeDb([cnpm, cndl]);
    await resolveCohortStandard(db, "K29", "CNPM");
    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("JOIN graduation_revisions r ON r.id=g.current_revision WHERE g.is_active AND g.cohort_code=$1 ORDER BY g.id");
    expect(params).toEqual(["K29"]);
  });

  it("picks the student's specialty with the full identity, standardCode included, and defaults gpaScale to 4", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveCohortStandard(db, "K29", "CNPM")).toEqual({
      resolution: "specialty", standard: { id: "std-cnpm", revisionId: "std-cnpm-rev", version: 2, data: { ...cnpm.data, gpaScale: 4 } },
    });
    // CNDL's program code is only in its standardCode.
    expect(await resolveCohortStandard(db, "K29", "CNDL")).toMatchObject({ resolution: "specialty", standard: { id: "std-cndl", data: { gpaScale: 10 } } });
  });

  it("never falls back to another specialty's standard", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveCohortStandard(db, "K29", "TTNT")).toEqual({ resolution: "not_found", standard: null });
    expect(await resolveCohortStandard(db, "K29", null)).toEqual({ resolution: "specialty_unset", standard: null });
  });

  it("uses a single general standard, and reports none or several", async () => {
    expect(await resolveCohortStandard(fakeDb([general]), "K27", "CNPM")).toMatchObject({ resolution: "general", standard: { id: "std-k27" } });
    expect(await resolveCohortStandard(fakeDb([general]), "K27", null)).toMatchObject({ resolution: "general", standard: { id: "std-k27" } });
    expect(await resolveCohortStandard(fakeDb([cnpm, cndl]), "K30", "CNPM")).toEqual({ resolution: "not_found", standard: null });
    expect(await resolveCohortStandard(fakeDb([cnpm, { ...cnpm, id: "std-cnpm-2" }]), "K29", "CNPM")).toEqual({ resolution: "ambiguous", standard: null });
  });
});

describe("resolveStudentStandard", () => {
  it("is cohort_unknown without a cohort and reads no standard", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveStudentStandard(db, { cohortCode: null, specialty: "CNPM" })).toEqual({ resolution: "cohort_unknown", standard: null });
    expect(await resolveStudentStandard(db, { cohortCode: "  ", specialty: "CNPM" })).toEqual({ resolution: "cohort_unknown", standard: null });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("normalizes the profile cohort before reading", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveStudentStandard(db, { cohortCode: " k29 ", specialty: "CNPM" })).toMatchObject({ resolution: "specialty", standard: { id: "std-cnpm" } });
    expect(db.query.mock.calls[0]![1]).toEqual(["K29"]);
  });
});

// 2026-10-27: the Faculty's majors; a student only sees the standards of the major of the MSSV.
describe("standards of a major", () => {
  it("reads the major of a standard from its programme code, else its names, else Công nghệ thông tin", () => {
    expect(standardMajor({ specialty: "Công nghệ phần mềm (7480201-03)", classBlock: "71K29CNTT_7480201-03", standardCode: "" })).toBe("7480201");
    expect(standardMajor({ specialty: "", classBlock: "K26T-CN", standardCode: "K26T-CN_TN02" })).toBe("7480201");
    expect(standardMajor({ specialty: "", classBlock: "71K29HTTT", standardCode: "71K29HTTT_TN04" })).toBe("7480104");
    expect(standardMajor({ specialty: "IoT (7480102-01)", classBlock: "71K29MMT", standardCode: "" })).toBe("7480102");
  });

  it("gives a student only the standards of the major, none to a major without standards", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect((await resolveCohortStandard(db, "K29", "CNPM", "7480201")).standard?.id).toBe("std-cnpm");
    expect(await resolveCohortStandard(db, "K29", "CNPM", "7480104")).toEqual({ resolution: "not_found", standard: null });
    expect((await resolveStudentStandard(db, { cohortCode: "K29", specialty: "CNPM", majorCode: null })).standard?.id).toBe("std-cnpm");
  });
});

// 2026-11-10 (user: "Đã có xét tốt nghiệp chuyên ngành Hệ thống thông tin – Chuyển đổi số mà sao đây lại báo là không có"):
// the K29 standards of the other majors, with the codes, names and fields the Faculty's workbooks give them.
describe("standards of the HTTT and MMT&TTDL specialties", () => {
  const cds = standard("std-httt-cds", "K29", {
    name: "71K29HTTT_7480104-01_TN04 - K29HTTT_hệ thống thông tin (HTTT chuyển đổi số)", standardCode: "71K29HTTT_7480104-01_TN04",
    classBlock: "71K29HTTT_7480104-01", major: "Hệ thống thông tin (7480104)", specialty: "Hệ thống thông tin chuyển đổi số (7480104-01)",
  });
  const anm = standard("std-mmt-anm", "K29", {
    name: "71K29TTDL_7480102-02_TN04 - K29TTDL_MMT&TTDL (An ninh mạng)", standardCode: "71K29TTDL_7480102-02_TN04",
    classBlock: "71K29TTDL_7480102-02", major: "Mạng máy tính và truyền thông dữ liệu (7480102)", specialty: "An ninh mạng (7480102-02)",
  });
  const k29 = [cnpm, cndl, cds, anm];
  const own = async (specialty: Parameters<typeof resolveStudentStandard>[1]["specialty"], majorCode: string | null, rows = k29) =>
    resolveStudentStandard(fakeDb(rows), { cohortCode: "K29", specialty, majorCode });

  it("gives each specialty of HTTT and MMT&TTDL its own published standard", async () => {
    expect(await own("HTTT_CDS", "7480104")).toMatchObject({ resolution: "specialty", standard: { id: "std-httt-cds" } });
    expect(await own("MMT_ANM", "7480102")).toMatchObject({ resolution: "specialty", standard: { id: "std-mmt-anm" } });
  });

  it("never gives a specialty another specialty's or another major's standard", async () => {
    expect(await own("HTTT_GIS", "7480104")).toEqual({ resolution: "not_found", standard: null });
    expect(await own("MMT_IOT", "7480102")).toEqual({ resolution: "not_found", standard: null });
    expect(await own(null, "7480104")).toEqual({ resolution: "specialty_unset", standard: null });
    expect(await own("CNPM", "7480201")).toMatchObject({ resolution: "specialty", standard: { id: "std-cnpm" } });
    expect(await own(null, "7480201")).toEqual({ resolution: "specialty_unset", standard: null });
    expect(await own("HTTT_CDS", "7480104", [cnpm, cndl])).toEqual({ resolution: "not_found", standard: null });
  });

  it("reads a later standard by the specialty it names when its program code is not known yet", async () => {
    const gis = standard("std-httt-gis", "K31", { standardCode: "71K31HTTT_7480104-02_TN04", classBlock: "71K31HTTT_7480104-02", specialty: "Hệ thống thông tin địa lý (7480104-02)" });
    const iot = standard("std-mmt-iot", "K31", { standardCode: "71K31TTDL_7480102-01_TN04", classBlock: "71K31TTDL_7480102-01", specialty: "Internet vạn vật (IoT) (7480102-01)" });
    const db = fakeDb([gis, iot]);
    expect(await resolveCohortStandard(db, "K31", "HTTT_GIS", "7480104")).toMatchObject({ resolution: "specialty", standard: { id: "std-httt-gis" } });
    expect(await resolveCohortStandard(db, "K31", "HTTT_CDS", "7480104")).toEqual({ resolution: "not_found", standard: null });
    expect(await resolveCohortStandard(db, "K31", "MMT_IOT", "7480102")).toMatchObject({ resolution: "specialty", standard: { id: "std-mmt-iot" } });
    expect(await resolveCohortStandard(db, "K31", "MMT_ANM", "7480102")).toEqual({ resolution: "not_found", standard: null });
  });

  it("reads the major of a general standard from its Ngành đào tạo, the MMT&TTDL class block 'TTDL' too", async () => {
    const mmtGeneral = standard("std-mmt", "K29", { standardCode: "71K29TTDL_TN04", classBlock: "71K29TTDL", major: "Mạng máy tính và truyền thông dữ liệu (7480102)" });
    expect(standardMajor(standardIdentity(mmtGeneral.data as GraduationData))).toBe("7480102");
    expect(standardMajor({ specialty: "", classBlock: "71K29TTDL", standardCode: "71K29TTDL_TN04" })).toBe("7480102");
    expect(standardMajor(standardIdentity(cds.data as GraduationData))).toBe("7480104");
    // A CNTT student without a specialty never takes the general standard of MMT&TTDL; its own students do.
    expect(await own(null, "7480201", [cnpm, cndl, mmtGeneral])).toEqual({ resolution: "specialty_unset", standard: null });
    expect(await own("MMT_IOT", "7480102", [cnpm, mmtGeneral, anm])).toMatchObject({ resolution: "general", standard: { id: "std-mmt" } });
  });
});
