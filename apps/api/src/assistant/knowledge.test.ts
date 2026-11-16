import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { portalGuides } from "./guides.js";
import {
  buildKnowledgeChunks, chunkHash, createKnowledgeRefresh, KNOWLEDGE_SOURCE_KINDS, knowledgeChunksFrom, MAX_CHUNK_CHARS, packParts,
  planKnowledgeRefresh, readLearningResources, refreshKnowledge, resourceKey, type CurriculumRow, type KnowledgeCatalog, type KnowledgeChunkInput,
} from "./knowledge.js";

// Synthetic catalog rows shaped like the local database (CTĐT, KHĐT and a standard of Công nghệ thông tin); no student
// record, name or score.
const REV30 = "30303030-3030-4030-8030-303030303030";
const REV31 = "31313131-3131-4131-8131-313131313131";
const API = "aaaaaaaa-0000-4000-8000-000000000001";
const WEB = "aaaaaaaa-0000-4000-8000-000000000002";
const ALGO = "aaaaaaaa-0000-4000-8000-000000000003";
const SQL_SKILL = "aaaaaaaa-0000-4000-8000-000000000004";
const ORPHAN = "aaaaaaaa-0000-4000-8000-000000000005";

const course = (code: string, name: string, credits: number, type: string, block: string, specialty: string, studyYear: number, semester: number,
  groupId: string, englishName = "") => ({ code, name, englishName, credits, type, block, specialty, studyYear, semester, groupId, prior: "", prerequisite: "" });

const k31: CurriculumRow = {
  id: "c3100000-0000-4000-8000-000000000031", revisionId: REV31, cohortCode: "K31",
  data: {
    name: "KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN KHÓA 31", major: "CÔNG NGHỆ THÔNG TIN", admissionYear: 2025, totalCredits: 126,
    groups: [
      { id: "row-31", label: "Khối kiến thức: I.6. Giáo dục thể chất và giáo dục quốc phòng", credits: 15 },
      { id: "row-54", label: "Khối kiến thức: II.1. Kiến thức cơ sở khối ngành", credits: 25 },
      { id: "row-63", label: "Khối kiến thức: II.2. Kiến thức cơ sở ngành (12 BB + 6 TC)", credits: 18 },
      { id: "row-90", label: "Khối kiến thức: II.3.2-3. Chuyên ngành Trí tuệ Nhân tạo (18 BB + 9 TC)", credits: 18 },
    ],
    electives: [{ code: "TC002", requiredCredits: 2, courseCodes: ["71PEKC10062"] }, { code: "TC206", requiredCredits: 6, courseCodes: ["71ITSE30503"] }],
    relations: [{ courseCode: "71ITSE30503", kind: "prior", raw: "[71ITBS10203]Cơ sở lập trình", targetCodes: ["71ITBS10203"], unresolvedCodes: [], reviewRequired: false }],
    courses: [
      course("71PEKC10062", "Cờ vua", 2, "TC002 (2TC)", "Giáo dục thể chất và giáo dục quốc phòng", "", 1, 1, "row-31"),
      course("71ITBS10203", "Cơ sở lập trình", 3, "BB", "Kiến thức cơ sở khối ngành", "", 1, 1, "row-54", "Programming Basics"),
      course("71ITSE30503", "Lập trình ứng dụng web", 3, "TC206 (6TC)", "Kiến thức cơ sở ngành", "", 2, 2, "row-63", "Web Application Programming"),
      course("71ITAI40803", "Nhập môn xử lý ảnh số", 3, "BB", "Kiến thức chuyên ngành hoặc chuyên sâu", "Trí tuệ Nhân tạo", 2, 3, "row-90"),
    ],
  },
};
// K30 has no block groups in its workbook: the courses' "Khối" column stands in.
const k30: CurriculumRow = {
  id: "c3000000-0000-4000-8000-000000000030", revisionId: REV30, cohortCode: "K30",
  data: {
    name: "KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN KHÓA 30", major: "CÔNG NGHỆ THÔNG TIN", admissionYear: 2024, totalCredits: 126,
    groups: [], electives: [], relations: [],
    courses: [
      course("71ITBS10203", "Cơ sở lập trình", 3, "BB", "Kiến thức cơ sở khối ngành", "", 1, 1, "row-56"),
      course("71ITSE30503", "Lập trình ứng dụng web", 3, "BB", "Kiến thức cơ sở ngành", "", 2, 1, "row-60"),
    ],
  },
};
const webSkills = [{ skillId: WEB, skillName: "Lập trình web", weight: 0.6 }, { skillId: API, skillName: "API", weight: 0.4 }];

function catalog(extra: Partial<KnowledgeCatalog> = {}): KnowledgeCatalog {
  return {
    curricula: [k30, k31],
    courseSkills: [
      { revisionId: REV30, code: "71ITSE30503", courseId: "course-web", skills: webSkills },
      { revisionId: REV31, code: "71ITSE30503", courseId: "course-web", skills: webSkills },
      { revisionId: REV30, code: "71ITBS10203", courseId: "course-csl", skills: [{ skillId: ALGO, skillName: "Tư duy thuật toán", weight: 1 }] },
      { revisionId: REV31, code: "71ITBS10203", courseId: "course-csl", skills: [{ skillId: ALGO, skillName: "Tư duy thuật toán", weight: 1 }] },
      { revisionId: REV31, code: "71ITAI40803", courseId: "course-xla", skills: [] },
      { revisionId: REV31, code: "71PEKC10062", courseId: "course-chess", skills: [] },
    ],
    skills: [
      { id: API, name: "API", description: "", hasProfile: true, scope: "Phát triển hoặc tích hợp giao tiếp dịch vụ.", groups: ["Chuyên môn"] },
      { id: WEB, name: "Lập trình web", description: "Xây dựng ứng dụng web.", hasProfile: true, scope: "", groups: ["Chuyên môn"] },
      { id: ALGO, name: "Tư duy thuật toán", description: "", hasProfile: true, scope: "", groups: ["Chuyên môn", "Kiến thức nền tảng"] },
      { id: SQL_SKILL, name: "SQL", description: "", hasProfile: false, scope: "", groups: [] },
      { id: ORPHAN, name: "Kỹ năng không dùng", description: "", hasProfile: false, scope: "", groups: [] },
    ],
    careers: [
      { id: "p13", code: "NN013", nameVi: "Lập trình viên giao diện web", nameEn: "Frontend Developer", description: "Xây dựng giao diện web.", fieldCode: "7",
        fieldName: "Phát triển phần mềm", requirements: [{ title: "Lập trình web", description: "", isRequired: true, skillId: WEB, skillName: "Lập trình web" }] },
      { id: "p14", code: "NN014", nameVi: "Lập trình viên phía máy chủ", nameEn: "Backend Developer", description: "Phát triển API phía máy chủ.", fieldCode: "7",
        fieldName: "Phát triển phần mềm", requirements: [
          { title: "SQL", description: "", isRequired: true, skillId: SQL_SKILL, skillName: "SQL" },
          { title: "API", description: "Thiết kế REST API.", isRequired: false, skillId: API, skillName: "API" },
          { title: "REST API", description: "", isRequired: false, skillId: null, skillName: null },
        ] },
    ],
    fields: [
      { code: "3", name: "Dữ liệu & Trí tuệ nhân tạo", description: "" },
      { code: "7", name: "Phát triển phần mềm", description: "Các nghề lập trình." },
    ],
    plans: [{
      id: "plan-31", cohortCode: "K31",
      data: {
        name: "KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 31", major: "CÔNG NGHỆ THÔNG TIN", totalCredits: 126,
        terms: [{ code: "HK251", semester: 1, studyYear: 1, sourceCredits: 12 }, { code: "HK262", semester: 2, studyYear: 2, sourceCredits: 15 }],
        sections: [{ id: "section-38", termCode: "HK262", label: "Chọn1 trong 4 môn sau", kind: "choice" }],
        items: [
          { id: "row-10", code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, type: "BB", termCode: "HK251", sectionId: "" },
          { id: "row-39", code: "71ITSE30503", name: "Lập trình ứng dụng web", credits: 3, type: "TC206", termCode: "HK262", sectionId: "section-38" },
          { id: "row-41", code: "", name: "Học phần tự chọn khác", credits: null, type: "", termCode: "HK262", sectionId: "" },
        ],
      },
    }],
    standards: [{
      id: "grad-29", cohortCode: "K29",
      data: {
        name: "71K29CNTT_7480201-03_TN04 - K29CNTT_Công nghệ thông tin (Công nghệ phần mềm)", standardCode: "71K29CNTT_7480201-03_TN04",
        major: "Công nghệ thông tin (7480201)", specialty: "Công nghệ phần mềm (7480201-03)", classBlock: "71K29CNTT_7480201-03",
        minimumCredits: 126, mandatoryCredits: 111, electiveCredits: 15, freeElectiveCredits: 0, minimumGpa: 2, gpaScale: 4,
        notes: "Ghi chú: Môn có dấu (*) chỉ là môn điều kiện không tính điểm trung bình và số tín chỉ",
        groups: [
          { id: "row-17", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 111 },
          { id: "row-60", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
          { id: "row-64", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
        ],
        courses: [
          { id: "row-18", groupId: "row-17", code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, conditionOnly: false },
          { id: "row-56", groupId: "row-17", code: "71NAD110013", name: "GDQP1: Đường lối QP và AN của ĐCSVN (*)", credits: 3, conditionOnly: true },
          { id: "row-61", groupId: "row-60", code: "71PEKC10062", name: "Cờ vua (*)", credits: 2, conditionOnly: true },
          { id: "row-65", groupId: "row-64", code: "71PEBA10052", name: "Cầu lông (*)", credits: 2, conditionOnly: true },
        ],
      },
    }],
    resources: null,
    ...extra,
  };
}

const chunkOf = (chunks: KnowledgeChunkInput[], kind: string, key: string) => {
  const found = chunks.find((chunk) => chunk.sourceKind === kind && chunk.sourceKey === key);
  if (!found) throw new Error(`no ${kind} chunk ${key}`);
  return found;
};
const linesOf = (chunk: KnowledgeChunkInput) => chunk.content.split("\n");

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "edupath-knowledge-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
afterEach(() => vi.restoreAllMocks());
/** Never the real learning-resources.json: another agent writes it. */
const noResources = () => ({ resourcesFile: join(dir, "missing.json") });

describe("knowledgeChunksFrom", () => {
  const chunks = knowledgeChunksFrom(catalog());

  it("writes one chunk per course code with the CTĐTs that have it, its placement, prior courses and applied skills", () => {
    const web = chunkOf(chunks, "course", "71ITSE30503");
    expect(web).toMatchObject({ title: "Học phần 71ITSE30503 Lập trình ứng dụng web", link: "#curriculum" });
    expect(linesOf(web)).toEqual([
      "Học phần 71ITSE30503: Lập trình ứng dụng web (tên tiếng Anh: Web Application Programming).",
      "Số tín chỉ: 3.",
      "Có trong chương trình đào tạo: Công nghệ thông tin K30, K31.",
      "Loại học phần: bắt buộc (K30); tự chọn nhóm TC206 (chọn đủ 6 tín chỉ trong nhóm) (K31).",
      "Khối kiến thức: Kiến thức cơ sở ngành.",
      "Vị trí trong CTĐT: năm 2, học kỳ 1 (K30); năm 2, học kỳ 2 (K31).",
      "Học phần học trước: không có (K30); 71ITBS10203 Cơ sở lập trình (K31).",
      "Kỹ năng rèn luyện (trọng số do Khoa cấu hình): Lập trình web 60%, API 40%.",
    ]);
  });

  it("says when a course has no applied configuration, and names a specialty or a condition-only course", () => {
    const image = linesOf(chunkOf(chunks, "course", "71ITAI40803"));
    expect(image).toContain("Chuyên ngành: Trí tuệ Nhân tạo.");
    expect(image).toContain("Không có học phần tiên quyết hay học trước.");
    expect(image).toContain("Kỹ năng rèn luyện: Khoa chưa áp dụng cấu hình kỹ năng cho học phần này.");
    expect(linesOf(chunkOf(chunks, "course", "71PEKC10062")))
      .toContain("Loại học phần: môn điều kiện (*), tự chọn nhóm TC002 (chọn đủ 2 tín chỉ trong nhóm), không tính vào tín chỉ tích lũy.");
  });

  it("indexes skills with the courses that build them and the careers that ask for them, and leaves out unused skills", () => {
    const api = chunkOf(chunks, "skill", API);
    expect(api).toMatchObject({ title: "Kỹ năng API", link: "#skill-gap" });
    expect(linesOf(api)).toEqual([
      "Kỹ năng: API.",
      "Nhóm năng lực: Chuyên môn.",
      "Phạm vi kỹ năng trong chương trình đào tạo: Phát triển hoặc tích hợp giao tiếp dịch vụ.",
      "Học phần rèn luyện kỹ năng này (trọng số do Khoa cấu hình):",
      "- 71ITSE30503 Lập trình ứng dụng web: 40%",
      "Vị trí nghề nghiệp yêu cầu kỹ năng này:",
      "- NN014 Lập trình viên phía máy chủ (Ưu tiên)",
    ]);
    expect(linesOf(chunkOf(chunks, "skill", ALGO))).toContain("Nhóm năng lực: Chuyên môn, Kiến thức nền tảng.");
    // A career skill without a competency profile: no course measures it.
    expect(linesOf(chunkOf(chunks, "skill", SQL_SKILL))).toEqual([
      "Kỹ năng: SQL.",
      "Chưa có học phần nào trong các chương trình đào tạo hiện hành rèn luyện kỹ năng này.",
      "Vị trí nghề nghiệp yêu cầu kỹ năng này:",
      "- NN014 Lập trình viên phía máy chủ (Bắt buộc)",
    ]);
    expect(chunks.some((chunk) => chunk.sourceKey === ORPHAN)).toBe(false);
  });

  it("writes careers with their requirements and thresholds, and fields with their careers", () => {
    const backend = chunkOf(chunks, "career", "NN014");
    expect(backend).toMatchObject({ title: "Vị trí nghề nghiệp NN014 Lập trình viên phía máy chủ", link: "#career" });
    expect(linesOf(backend)).toEqual([
      "Vị trí nghề nghiệp NN014: Lập trình viên phía máy chủ (tiếng Anh: Backend Developer).",
      "Lĩnh vực: Phát triển phần mềm.",
      "Mô tả: Phát triển API phía máy chủ.",
      "Trên trang Khoảng trống kỹ năng, kỹ năng Bắt buộc và kỹ năng Ưu tiên đều đạt khi từ 62,5 điểm (mức Khá).",
      "Yêu cầu kỹ năng của vị trí nghề nghiệp:",
      "- SQL (Bắt buộc)",
      "- API (Ưu tiên): Thiết kế REST API.",
      "- REST API (Ưu tiên)",
    ]);
    expect(linesOf(chunkOf(chunks, "field", "7"))).toEqual([
      "Lĩnh vực nghề nghiệp: Phát triển phần mềm.",
      "Mô tả: Các nghề lập trình.",
      "Các vị trí nghề nghiệp trong lĩnh vực (2):",
      "- NN013 Lập trình viên giao diện web (Frontend Developer)",
      "- NN014 Lập trình viên phía máy chủ (Backend Developer)",
    ]);
    expect(chunkOf(chunks, "field", "3").content).toBe("Lĩnh vực nghề nghiệp: Dữ liệu & Trí tuệ nhân tạo.\nLĩnh vực chưa có vị trí nghề nghiệp nào trong danh mục.");
  });

  it("summarizes each CTĐT with its blocks, elective groups, specialties and the courses of each block", () => {
    const lines = linesOf(chunkOf(chunks, "curriculum", k31.id));
    expect(chunkOf(chunks, "curriculum", k31.id)).toMatchObject({ title: "Chương trình đào tạo Công nghệ thông tin K31", link: "#curriculum" });
    expect(lines.slice(0, 7)).toEqual([
      "Chương trình đào tạo (CTĐT) ngành Công nghệ thông tin, khóa K31: KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN KHÓA 31.",
      "Năm tuyển sinh: 2025.",
      "Tổng số tín chỉ của chương trình: 126.",
      "Số học phần trong khung: 4 (2 bắt buộc, 2 tự chọn).",
      "Chuyên ngành: Trí tuệ Nhân tạo.",
      "Giáo dục thể chất và Giáo dục quốc phòng là môn điều kiện (*): phải đạt nhưng không tính vào tín chỉ tích lũy và điểm trung bình.",
      "Khối kiến thức (tín chỉ yêu cầu theo CTĐT):",
    ]);
    expect(lines).toContain("- II.2. Kiến thức cơ sở ngành (12 BB + 6 TC): 18 tín chỉ; 1 học phần (1 tự chọn).");
    expect(lines).toContain("- TC206: chọn đủ 6 tín chỉ trong 1 học phần.");
    expect(lines).toContain("Học phần khối II.1. Kiến thức cơ sở khối ngành:");
    expect(lines).toContain("- 71ITAI40803 Nhập môn xử lý ảnh số: 3 tín chỉ, bắt buộc, chuyên ngành Trí tuệ Nhân tạo");
    const k30Lines = linesOf(chunkOf(chunks, "curriculum", k30.id));
    expect(k30Lines).toContain("Khối kiến thức (theo cột Khối của CTĐT):");
    expect(k30Lines).toContain("- Kiến thức cơ sở ngành: 1 học phần (1 bắt buộc, 3 tín chỉ bắt buộc).");
    expect(k30Lines.some((line) => line.startsWith("Nhóm tự chọn"))).toBe(false);
  });

  it("writes a KHĐT overview and one chunk per term with its choices", () => {
    const overview = chunkOf(chunks, "plan", "plan-31");
    expect(overview).toMatchObject({ title: "Kế hoạch đào tạo Công nghệ thông tin K31", link: "#plans" });
    expect(linesOf(overview)).toContain("- HK1 2025–2026 (năm thứ 1, học kỳ 1): 12 tín chỉ, 1 học phần");
    const term = chunkOf(chunks, "plan", "plan-31:HK262");
    expect(term.title).toBe("Kế hoạch đào tạo Công nghệ thông tin K31 – HK262");
    expect(linesOf(term)).toEqual([
      "Kế hoạch đào tạo ngành Công nghệ thông tin khóa K31, HK2 2026–2027 (năm thứ 2, học kỳ 2).",
      "Số tín chỉ theo kế hoạch: 15.",
      "Học phần:",
      "- Học phần tự chọn khác: chưa ghi số tín chỉ, chưa ghi loại",
      "Chọn 1 trong 4 môn sau:",
      "- 71ITSE30503 Lập trình ứng dụng web: 3 tín chỉ, tự chọn TC206",
    ]);
  });

  it("writes each graduation standard with its thresholds, its groups in words and their courses", () => {
    const standard = chunkOf(chunks, "graduation", "grad-29");
    expect(standard).toMatchObject({ title: "Tiêu chuẩn xét tốt nghiệp K29 Công nghệ phần mềm (7480201-03)", link: "#graduation" });
    const lines = linesOf(standard);
    expect(lines).toContain("Ngưỡng xét tốt nghiệp: tích lũy tối thiểu 126 tín chỉ (bắt buộc 111, tự chọn 15, tự chọn tự do 0); điểm trung bình tích lũy tối thiểu 2 (thang 4).");
    expect(lines).toContain("- Nhóm bắt buộc: cần đạt tất cả 2 môn (yêu cầu 111 tín chỉ).");
    // Two groups share a name: their size and first code tell them apart.
    expect(lines).toContain("- Nhóm tự chọn TC102 (1 môn, từ 71PEKC10062): cần đủ 2 tín chỉ trong 1 môn.");
    expect(lines).toContain("Môn của Nhóm bắt buộc:");
    expect(lines).toContain("- 71NAD110013 GDQP1: Đường lối QP và AN của ĐCSVN (*): 3 tín chỉ");
  });

  it("adds 10–20 portal guides, each with a page link", () => {
    const guides = chunks.filter((chunk) => chunk.sourceKind === "guide");
    expect(guides.length).toBeGreaterThanOrEqual(10);
    expect(guides.length).toBeLessThanOrEqual(20);
    expect(guides.length).toBe(portalGuides().length);
    for (const guide of guides) expect(guide.link).toMatch(/^#[a-z-]+$/);
    expect(chunkOf(chunks, "guide", "tro-ly-ai").link).toBe("#assistant");
    expect(chunkOf(chunks, "guide", "tro-ly-ai").content).toContain("tối đa 1.000 ký tự");
    // The thresholds the engine applies: one for both kinds since comp-calc-v25 (Bắt buộc 80 from v10 to v24).
    expect(chunkOf(chunks, "guide", "khoang-trong-ky-nang").content).toContain("kỹ năng Bắt buộc và kỹ năng Ưu tiên đều cần từ 62,5 điểm (mức Khá)");
  });

  it("keeps every chunk within the limits, with unique keys, in the order of the source kinds", () => {
    const keys = new Set<string>();
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.title.length).toBeLessThanOrEqual(300);
      expect(chunk.sourceKey.length).toBeLessThanOrEqual(300);
      keys.add(`${chunk.sourceKind}:${chunk.sourceKey}`);
    }
    expect(keys.size).toBe(chunks.length);
    const order = chunks.map((chunk) => KNOWLEDGE_SOURCE_KINDS.indexOf(chunk.sourceKind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(chunks.some((chunk) => chunk.sourceKind === "resource")).toBe(false);
  });

  it("splits a long item into numbered parts and repeats the heading of a block that goes on", () => {
    const courses = Array.from({ length: 120 }, (_, index) => course(`71ITXX${String(10000 + index)}`, `Học phần thử nghiệm số ${index + 1}`, 3, "BB",
      "Kiến thức cơ sở ngành", "", 1, 1, "row-63"));
    const long: CurriculumRow = { ...k31, data: { ...k31.data, courses } };
    const parts = knowledgeChunksFrom(catalog({ curricula: [long], courseSkills: [], plans: [], standards: [] }))
      .filter((chunk) => chunk.sourceKind === "curriculum");
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.map((part) => part.sourceKey)).toEqual(parts.map((_, index) => (index ? `${k31.id}#${index + 1}` : k31.id)));
    expect(parts[1]!.title).toBe(`Chương trình đào tạo Công nghệ thông tin K31 (phần 2/${parts.length})`);
    expect(parts[2]!.content.startsWith("Học phần khối II.2. Kiến thức cơ sở ngành (12 BB + 6 TC) (tiếp theo):")).toBe(true);
    for (const part of parts) expect(part.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });
});

describe("packParts", () => {
  it("cuts between lines, keeps a heading with its first line, repeats it when its lines go on and wraps a long line", () => {
    expect(packParts([{ lines: ["a".repeat(15)] }, { heading: "H", lines: ["b".repeat(5)] }], 20)).toEqual(["a".repeat(15), "H:\nbbbbb"]);
    expect(packParts([{ heading: "H", lines: ["bbbbb", "ccccc", "ddddd", "eeeee"] }], 20)).toEqual(["H:\nbbbbb\nccccc\nddddd", "H (tiếp theo):\neeeee"]);
    expect(packParts([{ lines: ["word ".repeat(10).trim()] }], 20)).toEqual(["word word word word", "word word word word", "word word"]);
    expect(packParts([{ heading: "Empty", lines: [] }])).toEqual([]);
  });
});

describe("learning resources", () => {
  const file = () => join(dir, "learning-resources.json");
  const write = (value: unknown) => writeFile(file(), typeof value === "string" ? value : JSON.stringify(value), "utf8");

  it("lists each skill's resources with their full https address, leaving out the invalid ones", async () => {
    await write({
      checkedAt: "2026-10-28",
      skills: [
        { skill: "Docker", resources: [
          { title: "Docker Get Started", url: "https://docs.docker.com/get-started/", provider: "Docker", type: "documentation", language: "en", level: "beginner", free: true, note: "Bắt đầu từ đây." },
          { title: "Trang không an toàn", url: "http://example.com/docker" },
          { title: "", url: "https://example.com/no-title" },
        ] },
        // The same skill written another way joins the first list.
        { skill: "docker ", resources: [{ title: "Play with Docker", url: "https://labs.play-with-docker.com/", free: true }] },
        { skill: "Không có tài liệu hợp lệ", resources: [{ title: "x", url: "ftp://example.com" }] },
      ],
    });
    const resources = await readLearningResources(file());
    const chunks = knowledgeChunksFrom(catalog({ resources })).filter((chunk) => chunk.sourceKind === "resource");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ sourceKey: resourceKey("Docker"), title: "Tài liệu tự học: Docker", link: null });
    expect(resourceKey("Docker")).toBe("docker");
    // A gloss in brackets is not part of the key (2026-11-16): the renamed skill and a result stored with its old name meet.
    expect(resourceKey("IAM (quản lý tài khoản và phân quyền)")).toBe(resourceKey("IAM"));
    expect(resourceKey("TCP/IP (giao thức mạng)")).toBe("tcp/ip");
    expect(resourceKey("Hệ thống thông tin địa lý (GIS)")).toBe("he thong thong tin dia ly");
    expect(resourceKey("(GIS)")).toBe("(gis)");
    // A renamed skill: its old names find the list of its name now.
    expect(resourceKey("Thiết kế giao diện dễ tiếp cận")).toBe("thiet ke giao dien de tiep can");
    expect(resourceKey("Accessibility")).toBe(resourceKey("Thiết kế giao diện dễ tiếp cận"));
    expect(resourceKey("Accessibility (giao diện hỗ trợ người khuyết tật)")).toBe(resourceKey("Thiết kế giao diện dễ tiếp cận"));
    expect(linesOf(chunks[0]!)).toEqual([
      "Tài liệu tự học cho kỹ năng Docker (danh sách EduPath AI tuyển chọn, kiểm tra ngày 28/10/2026).",
      "Tài liệu:",
      "- Docker Get Started – Docker (tài liệu, tiếng Anh, cơ bản, miễn phí): https://docs.docker.com/get-started/ – Bắt đầu từ đây.",
      "- Play with Docker (miễn phí): https://labs.play-with-docker.com/",
    ]);
  });

  it("skips resources while the file does not exist, and refuses a file that is not JSON", async () => {
    expect(await readLearningResources(join(dir, "missing.json"))).toBeNull();
    await write("{ \"skills\": [");
    await expect(readLearningResources(file())).rejects.toThrow();
    await write({ skills: "none" });
    await expect(readLearningResources(file())).rejects.toThrow();
  });
});

describe("the real codes of the graduation standard (curricula/real-codes.ts, user 2026-11-10: \"dùng luôn mã thực tế\")", () => {
  // K31's file writes Lập trình ứng dụng web under a code students never register; its standard and the transcripts use
  // 71ITSE99903 (synthetic codes). K30 lists the course under 71ITSE30503 and keeps it.
  const REAL = "71ITSE99903";
  const source = catalog({
    realCodes: [{ revisionId: REV31, code: "71ITSE30503", realCode: REAL }],
    // As COURSE_SKILLS_SQL reads it: the row keyed by the real code, with the skills of that code's course.
    courseSkills: catalog().courseSkills.map((row) => (row.revisionId === REV31 && row.code === "71ITSE30503"
      ? { ...row, code: REAL, courseId: "course-web-real", skills: [{ skillId: WEB, skillName: "Lập trình web", weight: 1 }] } : row)),
    plans: catalog().plans.map((plan) => ({ ...plan, curriculumRevisionId: REV31 })),
  });
  const chunks = knowledgeChunksFrom(source);

  it("writes the course under the real code in its course chunk, with the skills of that code's course", () => {
    const real = linesOf(chunkOf(chunks, "course", REAL));
    expect(real).toContain("Có trong chương trình đào tạo: Công nghệ thông tin K31.");
    expect(real).toContain("Kỹ năng rèn luyện (trọng số do Khoa cấu hình): Lập trình web 100%.");
    // The file's code stays only for the CTĐT that really uses it (K30).
    expect(linesOf(chunkOf(chunks, "course", "71ITSE30503"))).toContain("Có trong chương trình đào tạo: Công nghệ thông tin K30.");
  });

  it("names only the real code in the CTĐT and its KHĐT", () => {
    const k31Text = chunks.filter((chunk) => (chunk.sourceKind === "curriculum" && chunk.sourceKey === k31.id) || chunk.sourceKind === "plan")
      .map((chunk) => chunk.content).join(" ");
    expect(k31Text).toContain(REAL);
    expect(k31Text).not.toContain("71ITSE30503");
  });

  it("changes nothing without real codes", () => {
    expect(knowledgeChunksFrom(catalog({ realCodes: [] }))).toEqual(knowledgeChunksFrom(catalog()));
  });
});

/* ------------------------------------------------------------------------ */
/* Database side */

type Stored = { id: string; kind: string; key: string; hash: string };

function fakeDb(source: KnowledgeCatalog, stored: Stored[] = []) {
  const rows = (list: readonly unknown[]) => ({ rowCount: list.length, rows: [...list] });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM curricula c JOIN curriculum_revisions")) return rows(source.curricula);
    // The CTĐT rows of curricula/real-codes.ts (no standard here: no real code).
    if (sql.includes("FROM curricula c JOIN curriculum_courses cc")) return rows([]);
    if (sql.includes("FROM curricula cu JOIN curriculum_courses")) return rows(source.courseSkills);
    if (sql.includes("FROM career_skills k")) return rows(source.skills);
    if (sql.includes("FROM career_positions c")) return rows(source.careers);
    if (sql.includes("FROM career_fields f")) return rows(source.fields);
    if (sql.includes("FROM training_plans p")) return rows(source.plans);
    if (sql.includes("FROM graduation_standards g")) return rows(source.standards);
    if (sql.startsWith("SELECT id,source_kind")) return rows(stored);
    if (sql.startsWith("INSERT INTO ai_knowledge_chunks")) {
      // As the database answers: a row is new unless its kind and key are stored.
      const written = JSON.parse(params![0] as string) as { kind: string; key: string }[];
      return rows(written.map((row) => ({ inserted: !stored.some((old) => old.kind === row.kind && old.key === row.key) })));
    }
    if (sql.startsWith("DELETE FROM ai_knowledge_chunks")) return { rowCount: (params![0] as string[]).length, rows: [] };
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  });
  const calls = () => query.mock.calls.map(([sql, params]) => [sql, params ?? []] as const);
  return { db: { query } as unknown as Parameters<typeof refreshKnowledge>[0], query, calls };
}

describe("buildKnowledgeChunks and refreshKnowledge", () => {
  it("reads only what students see: active frameworks, plans and standards, applied configurations, live careers", async () => {
    const { db, calls } = fakeDb(catalog());
    const chunks = await buildKnowledgeChunks(db, noResources());
    expect(chunks).toEqual(knowledgeChunksFrom(catalog()));
    const sql = calls().map(([text]) => text).join("\n");
    expect(sql).toContain("WHERE c.is_active ORDER BY");
    expect(sql).toContain("cfg.status='active'");
    expect(sql).toContain("l.weight>0");
    expect(sql).toContain("WHERE c.deleted_at IS NULL AND f.deleted_at IS NULL");
    expect(sql).toContain("WHERE p.is_active");
    expect(sql).toContain("WHERE g.is_active");
    expect(sql).toContain("x-'sourceCells'");
    // Each CTĐT row of a real code reads that code's course (curricula/real-codes.ts), as the assessment does.
    expect(sql).toContain("COALESCE(rc.real_code,upper(btrim(cc.code))) AS code");
    expect(sql).toContain("cfg.course_id=COALESCE(rc.course_id,cc.course_id)");
    expect(calls().find(([text]) => text.includes("FROM curricula cu JOIN curriculum_courses"))![1]).toEqual(["[]"]);
  });

  it("inserts new chunks, rewrites changed ones and deletes rows no longer produced", async () => {
    const chunks = knowledgeChunksFrom(catalog());
    const [kept, changed] = chunks;
    const stored: Stored[] = [
      { id: "11111111-1111-4111-8111-111111111111", kind: kept!.sourceKind, key: kept!.sourceKey, hash: chunkHash(kept!) },
      { id: "22222222-2222-4222-8222-222222222222", kind: changed!.sourceKind, key: changed!.sourceKey, hash: "old" },
      { id: "33333333-3333-4333-8333-333333333333", kind: "course", key: "71ITOLD00000", hash: "gone" },
    ];
    const { db, calls } = fakeDb(catalog(), stored);
    expect(await refreshKnowledge(db, noResources())).toEqual({ inserted: chunks.length - 2, updated: 1, deleted: 1, total: chunks.length });
    const [upsert, params] = calls().find(([text]) => text.startsWith("INSERT INTO ai_knowledge_chunks"))!;
    expect(upsert).toContain("ON CONFLICT (source_kind,source_key) DO UPDATE");
    expect(upsert).toContain("embedding=NULL,embedding_model=NULL");
    expect(upsert).toContain("WHERE ai_knowledge_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash");
    const written = JSON.parse(params[0] as string) as { kind: string; key: string; hash: string; title: string; content: string; link: string | null }[];
    expect(written).toHaveLength(chunks.length - 1);
    expect(written.some((row) => row.key === kept!.sourceKey && row.kind === kept!.sourceKind)).toBe(false);
    expect(written.find((row) => row.key === changed!.sourceKey)!.hash).toBe(chunkHash(changed!));
    for (const row of written) expect(row.hash).toBe(chunkHash(row));
    expect(calls().find(([text]) => text.startsWith("DELETE FROM ai_knowledge_chunks"))![1]).toEqual([["33333333-3333-4333-8333-333333333333"]]);
  });

  it("writes nothing when no text changed", async () => {
    const chunks = knowledgeChunksFrom(catalog());
    const stored = chunks.map((chunk, index) => ({ id: `id-${index}`, kind: chunk.sourceKind, key: chunk.sourceKey, hash: chunkHash(chunk) }));
    const { db, calls } = fakeDb(catalog(), stored);
    expect(await refreshKnowledge(db, noResources())).toEqual({ inserted: 0, updated: 0, deleted: 0, total: chunks.length });
    expect(calls().filter(([text]) => /^(INSERT|UPDATE|DELETE)/.test(text))).toEqual([]);
  });

  it("hashes title, content and link, and keeps the first chunk of a repeated key", () => {
    const base = { sourceKind: "guide" as const, sourceKey: "a", title: "T", content: "C", link: "#overview" };
    expect(chunkHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(chunkHash({ ...base, link: null })).not.toBe(chunkHash(base));
    expect(chunkHash({ ...base, title: "T2" })).not.toBe(chunkHash(base));
    const plan = planKnowledgeRefresh([base, { ...base, content: "other" }], []);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.content).toBe("C");
  });
});

describe("createKnowledgeRefresh", () => {
  it("refreshes at most once per interval", async () => {
    const { db, query } = fakeDb(catalog());
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const refresh = createKnowledgeRefresh(60_000, noResources());
    expect(await refresh(db)).toBe(true);
    const count = query.mock.calls.length;
    expect(await refresh(db)).toBe(false);
    expect(query.mock.calls.length).toBe(count);
  });

  it("never throws: a failure is logged by its code only and reads false", async () => {
    const error = Object.assign(new Error("relation \"ai_knowledge_chunks\" does not exist: secret text"), { code: "42P01" });
    const db = { query: vi.fn(async () => { throw error; }) } as unknown as Parameters<typeof refreshKnowledge>[0];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await createKnowledgeRefresh(0, noResources())(db)).toBe(false);
    expect(logged).toHaveBeenCalledWith("[assistant] knowledge refresh failed (42P01)");
  });
});
