import { describe, expect, it } from "vitest";
import {
  AI_OPTIONS,
  GEMMA_SPECIAL_TOKENS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildAiInput,
  buildPromptContext,
  formatDeficit,
  formatGpa,
  formatGpaShortfall,
  formatNumber,
  formatScore,
  formatScoreOf100,
  sanitizeText,
  shownGpa,
  termAfter,
  termNameOf,
  termText
} from "./prompt.js";
import { numbersIn } from "./validate.js";
import { syntheticResult } from "./test-fixture.js";

describe("sanitizeText", () => {
  it("lists the 24 Gemma special tokens", () => {
    expect(GEMMA_SPECIAL_TOKENS).toHaveLength(24);
    expect(new Set(GEMMA_SPECIAL_TOKENS).size).toBe(24);
    for (const token of ["<bos>", "<eos>", "<pad>", "<unk>", "<mask>", "<|turn>", "<turn|>", '<|"|>', "<|video|>"]) {
      expect(GEMMA_SPECIAL_TOKENS).toContain(token);
    }
  });

  it("removes every special token, including ones rebuilt by a removal", () => {
    for (const token of GEMMA_SPECIAL_TOKENS) expect(sanitizeText(`a${token}b`)).toBe("ab");
    expect(sanitizeText("x<bo<bos>s>y")).toBe("xy");
    expect(sanitizeText("x<<|turn>|turn>y")).toBe("xy");
    expect(sanitizeText("a <| b |> c")).toBe("a b c");
    expect(sanitizeText("<BOS>Tên")).toBe("Tên");
  });

  it("turns control characters and line breaks into spaces and drops format characters", () => {
    expect(sanitizeText("Lập\ntrình\r\nweb\tnâng\u0000cao x")).toBe("Lập trình web nâng cao x");
    expect(sanitizeText("Cơ​sở")).toBe("Cơsở");
  });

  it("replaces ASCII double quotes and keeps '#'", () => {
    expect(sanitizeText('Ngôn ngữ "C#/C++"')).toBe("Ngôn ngữ 'C#/C++'");
  });

  it("caps the length by characters with an ellipsis", () => {
    const value = sanitizeText("ă".repeat(300));
    expect(Array.from(value)).toHaveLength(120);
    expect(value.endsWith("…")).toBe(true);
    expect(sanitizeText("abcdef", 4)).toBe("abc…");
    expect(sanitizeText(null)).toBe("");
  });
});

describe("formatting helpers", () => {
  it("prints numbers with a decimal comma and at most two decimals", () => {
    expect(formatNumber(72.5)).toBe("72,5");
    expect(formatNumber(72.456)).toBe("72,46");
    expect(formatNumber(85)).toBe("85");
  });
  it("writes a term like the pages (comp-v13), and in words for the graduation advice", () => {
    expect(termNameOf("HK253")).toBe("HK3 2025–2026");
    expect(termNameOf("HK261")).toBe("HK1 2026–2027");
    expect(termNameOf("Học kỳ hè")).toBe("Học kỳ hè");
    expect(termNameOf(null)).toBe("chưa xếp lịch");
    expect(termAfter("HK261")).toBe("HK262");
    expect(termAfter("HK263")).toBe("HK271");
    expect(termText("HK253")).toBe("học kỳ 3 năm học 2025–2026");
    expect(termText("HK261")).toBe("học kỳ 1 năm học 2026–2027");
    expect(termText("HK093")).toBe("học kỳ 3 năm học 2009–2010");
    expect(termText("Học kỳ hè")).toBe("Học kỳ hè");
    expect(termText(null)).toBe("chưa xếp lịch");
  });
  it("prints 0–100 scores and shortfalls exactly as the pages: floored to the tenth (comp-v14, web scoreText, deficitText)", () => {
    // Review 2026-11-04: the comment wrote "69" for 69,9 because the prompt sent whole numbers.
    expect(formatScore(69.94)).toBe("69,9");
    expect(formatScore(83.92)).toBe("83,9");
    expect(formatScore(84.999)).toBe("84,9");
    expect(formatScore(85)).toBe("85");
    expect(formatScore(0)).toBe("0");
    // A level bound is never shown as reached before it is.
    expect(formatScore(62.5)).toBe("62,5");
    expect(formatScore(62.97)).toBe("62,9");
    expect(formatScore(62.49)).toBe("62,4");
    expect(formatScore(89.96)).toBe("89,9");
    expect(formatScoreOf100(64.83)).toBe("64,8/100");
    // Without the score and threshold: rounded up to the tenth, at least 0,1.
    expect(formatDeficit(9.44)).toBe("9,5");
    expect(formatDeficit(30)).toBe("30");
    expect(formatDeficit(0.02)).toBe("0,1");
    // With them the shortfall adds up with the score as shown (2026-10-25 audit): 43,6 + 18,9 = 62,5; 62,7 + 17,3 = 80.
    expect(formatDeficit(18.9, 43.6, 62.5)).toBe("18,9");
    expect(formatDeficit(5.6, 64.4, 70)).toBe("5,6");
    expect(formatDeficit(17.23, 62.77, 80)).toBe("17,3");
  });
  it("prints a GPA with two decimals, never reaching a minimum it is below, and its shortfall rounded up (web formatGpa)", () => {
    expect(formatGpa(2.8)).toBe("2,80");
    expect(formatGpa(3.1)).toBe("3,10");
    expect(formatGpa(2.456)).toBe("2,46");
    expect(formatGpa(2)).toBe("2,00");
    expect(shownGpa(2.85, 2)).toBe(2.85);
    expect(shownGpa(1.996, 2)).toBe(1.99);
    expect(shownGpa(1.996, 2, false)).toBe(2);
    expect(shownGpa(2.996, null)).toBe(3);
    expect(formatGpaShortfall(0.15)).toBe("0,15");
    expect(formatGpaShortfall(0.101)).toBe("0,11");
  });
});

describe("buildAiInput", () => {
  const input = buildAiInput(syntheticResult());
  const noCareer = buildAiInput(syntheticResult({ career: false }));
  /** One data block section, from its heading to the next one. */
  const sectionOf = (user: string, heading: string) => {
    const start = user.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    return user.slice(start).split("\n\n[")[0]!;
  };

  it("uses the spec system prompt verbatim plus the output description", () => {
    expect(PROMPT_VERSION).toBe("comp-v16");
    expect(input.promptVersion).toBe("comp-v16");
    expect(input.think).toBe(true);
    expect(input.system).toBe(SYSTEM_PROMPT);
    expect(input.system.startsWith("Bạn là cố vấn học tập của EduPath AI, đồng hành cùng sinh viên ngành Công nghệ Thông tin, Trường Đại học Văn Lang.\n")).toBe(true);
    expect(input.system).toContain("1. Không tự tính, ước lượng hay làm tròn lại bất kỳ con số nào.");
    expect(input.system).toContain("7. Nếu có cảnh báo dữ liệu, nói ngắn gọn cảnh báo đó ảnh hưởng thế nào tới độ chính xác.");
    expect(input.system).toContain("Chỉ trả về một đối tượng JSON đúng cấu trúc được mô tả bên dưới, không thêm bất kỳ văn bản nào bên ngoài JSON.\n");
    for (const field of ["summary", "groupInsights", "strengths", "improvements", "careerFit", "gaps", "progress", "nextSteps"]) {
      expect(input.system).toContain(`- ${field}:`);
    }
    expect(input.system).not.toContain("<mô tả");
    expect(input.system).toContain("không viết khóa S…/G… và không viết mã học phần");
    expect(input.system).toContain("không đưa ra chỉ số hay phần trăm phù hợp");
    // comp-v14 (review 2026-11-04: "69" for 69,9): decimals are copied, never cut or rounded.
    expect(input.system).toContain('chép đúng từng chữ số như trong dữ liệu, giữ nguyên phần thập phân sau dấu phẩy, không làm tròn và không bỏ số lẻ: dữ liệu ghi "điểm 69,9/100" thì viết 69,9');
    expect(input.system).toContain("Mọi con số trong văn bản phải có sẵn trong dữ liệu và được chép đủ phần thập phân như dữ liệu ghi");
    expect(input.system).toContain('8. Viết học kỳ đúng như trong dữ liệu, dạng "HK2 2026–2027"; không viết mã học kỳ dạng HK262. Chỉ nhắc học kỳ đang học và các học kỳ sau đó có trong dữ liệu; không bao giờ khuyên học hay đăng ký ở một học kỳ đã qua.');
    expect(input.system).toContain("16. Trang in tên kỹ năng làm tiêu đề của mỗi mục strengths, improvements và gaps, nên mỗi mục chỉ nói về đúng kỹ năng đó");
    expect(input.system).toContain('"high" (cần làm sớm) | "medium" (nên làm) | "low" (có thể để sau)');
    expect(noCareer.system).toBe(SYSTEM_PROMPT);
    // comp-v16 (2026-11-14): without a target career (the assessment no longer needs one), careerFit says where to choose
    // one and never picks a career itself.
    expect(input.system).toContain('nếu chưa chọn nghề (mục [4] ghi "Bạn chưa chọn nghề mục tiêu"), nói ngắn gọn rằng kết quả chưa được so với yêu cầu của nghề nào và khi muốn, bạn chọn vị trí nghề nghiệp mục tiêu ở trang Định hướng nghề nghiệp; không tự chọn, đoán hay gợi ý một nghề cụ thể.');
    expect(sectionOf(noCareer.user, "[4. NGHỀ MỤC TIÊU]")).toBe("[4. NGHỀ MỤC TIÊU]\nBạn chưa chọn nghề mục tiêu.");
  });

  it("asks for concrete course advice, only about the target career, and no graduation comments (comp-v4, comp-v5)", () => {
    const system = input.system;
    expect(system).toContain("Lời khuyên cụ thể (bắt buộc):");
    expect(system).toContain('9. Không viết câu chung chung như "nền tảng yếu", "cần tập trung", "cần chú ý cải thiện", "nên xem xét các học phần liên quan" mà không kèm việc cụ thể.');
    expect(system).toContain("10. Mỗi mục improvements và mỗi bước nextSteps phải nêu tên một học phần cụ thể (học mới, học lại, học cải thiện hoặc ôn lại nội dung của học phần đã học) lấy từ danh sách gợi ý của đúng kỹ năng đó; chỉ khi kỹ năng không có học phần nào mới gợi ý tự học kèm một sản phẩm cụ thể để kiểm chứng.");
    expect(system).toContain('11. Nếu học phần "chưa đủ điều kiện", nói rõ cần đạt học phần tiên quyết nào trước.');
    expect(system).toContain('Học phần đã đạt thì nói "học cải thiện" hoặc "ôn lại", không nói "học mới".');
    expect(system).toContain("12. Khi sinh viên đã chọn nghề mục tiêu, improvements và nextSteps chỉ nói về kỹ năng của nghề đó (mục [4] và [6]). Không khuyên học lại, học cải thiện hay ôn lại cho kỹ năng không thuộc nghề mục tiêu (ví dụ kỹ năng mạng khi nghề là kỹ sư phần mềm).");
    // comp-v15 (user 2026-11-10): never "nothing left to learn"; with every career skill met, a way on beyond the program.
    expect(system).toContain("13. Không bao giờ viết rằng sinh viên đã đủ, đã hoàn thiện hay không cần học thêm gì. Khi mọi kỹ năng của nghề đã đạt ngưỡng, vẫn luôn mở hướng học tiếp");
    expect(system).toContain("nextSteps có ít nhất một việc tự học ngoài chương trình gắn với kỹ năng của nghề");
    expect(system).toContain("14. groupInsights cho nhóm dưới mức Khá: nêu tên 1–2 kỹ năng thấp nhất của nhóm; nếu kỹ năng đó không thuộc nghề mục tiêu thì nói rõ là ngoài yêu cầu của nghề và không đề xuất học lại hay học cải thiện;");
    expect(system).toContain("15. Không nhận xét về điều kiện xét tốt nghiệp (trang Điều kiện xét tốt nghiệp đã có kết quả và lời khuyên riêng); progress chỉ nói về tiến độ so với kế hoạch đào tạo.");
    expect(system).toContain("- summary: 2–3 câu tổng quan, tối đa 600 ký tự; nếu đã chọn nghề, nêu tình trạng so với nghề mục tiêu;");
    expect(system).toContain("về điểm mạnh, ưu tiên kỹ năng của nghề mục tiêu;");
    expect(system).toContain("courses: tối đa 2 mục { courseCode: mã trong danh sách của đúng kỹ năng đó ở mục [6]");
    expect(system).toContain("(khi đã chọn nghề, đó chỉ là kỹ năng của nghề: dưới ngưỡng, hoặc đã đạt ngưỡng nhưng chưa đạt mức Giỏi)");
    expect(system).toContain("- progress: tối đa 500 ký tự, chỉ về tiến độ so với kế hoạch đào tạo (mục [8]); không nhận xét về xét tốt nghiệp.");
    expect(system).not.toContain("kế hoạch đào tạo và xét tốt nghiệp");
  });

  it("sends the fixed Ollama options", () => {
    expect(input.options).toEqual({ num_ctx: 16384, num_predict: 8192, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(AI_OPTIONS.num_ctx).toBe(16384);
  });

  it("renders a delimited data block with every section and the job's keys", () => {
    for (const [user, sixth] of [[input.user, "[6. KỸ NĂNG CỦA NGHỀ MỤC TIÊU"], [noCareer.user, "[6. KỸ NĂNG DƯỚI MỨC KHÁ"]] as const) {
      expect(user.startsWith("=== BẮT ĐẦU DỮ LIỆU")).toBe(true);
      expect(user).toContain("=== KẾT THÚC DỮ LIỆU ===");
      const sections = ["[1. HỒ SƠ]", "[2. ĐIỂM TỔNG", "[3. KỸ NĂNG]", "[4. NGHỀ MỤC TIÊU]", "[5. ỨNG VIÊN", sixth, "[7. KỸ NĂNG CẦN TỰ HỌC", "[8. TIẾN ĐỘ", "[9. CẢNH BÁO"];
      for (const section of sections) expect(user).toContain(section);
      expect(sections.map((section) => user.indexOf(section))).toEqual(sections.map((section) => user.indexOf(section)).sort((a, b) => a - b));
    }
    const user = input.user;
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | thuộc nghề mục tiêu | điểm 88,5/100 | Giỏi");
    expect(user).toContain("S04 | Làm việc nhóm | nhóm G2 | ngoài nghề mục tiêu | Chưa có minh chứng");
    expect(user).toContain("S05 | Điện toán đám mây | Chưa đủ dữ liệu");
    expect(user).not.toContain("Cần tự học (");
    expect(user).toContain("  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: HK2 2026–2027\n");
    expect(user).toContain("- S03 Kiểm thử phần mềm | Bắt buộc | ngưỡng 85/100 | điểm 55/100 | Thấp hơn ngưỡng | thiếu 30 điểm (Thiếu nhiều)");
    expect(user).toContain("Ảnh hưởng: Điểm kỹ năng có thể thấp hơn thực tế.");
    expect(user).toContain("Có thể nêu là điểm mạnh: S01\n");
    expect(user).toContain("Có thể nêu là cần cải thiện: S02, S03\n");
    expect(noCareer.user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | điểm 88,5/100 | Giỏi");
    expect(noCareer.user).toContain("Có thể nêu là điểm mạnh: S01\n");
    expect(noCareer.user).toContain("Có thể nêu là cần cải thiện: S06, S07, S03\n");
  });

  it("calls a career skill only another specialty's courses teach Cần tự học (comp-v10), like the page", () => {
    const result = syntheticResult();
    result.career!.requirements.find((item) => item.skillKey === "S05")!.noDataReason = "other_specialty";
    expect(sectionOf(buildAiInput(result).user, "[4. NGHỀ MỤC TIÊU]")).toContain("| chưa có điểm | Cần tự học (chỉ có trong học phần của chuyên ngành khác)");
    expect(sectionOf(input.user, "[4. NGHỀ MỤC TIÊU]")).toContain("| chưa có điểm | Chưa đủ dữ liệu");
    expect(SYSTEM_PROMPT).toContain("Kỹ năng \"Cần tự học\" nghĩa là kỹ năng chỉ được dạy trong học phần của chuyên ngành khác");
  });
  it("with a career, offers only its skills: below its threshold, or met and still below Giỏi (comp-v5; Thành thạo before comp-v9)", () => {
    const sixth = sectionOf(input.user, "[6. ");
    expect(sixth).toBe([
      "[6. KỸ NĂNG CỦA NGHỀ MỤC TIÊU CẦN CẢI THIỆN HOẶC NÂNG LÊN VÀ HỌC PHẦN GỢI Ý] (dùng cho improvements; chỉ chọn học phần trong danh sách của đúng kỹ năng)",
      "S02 Cơ sở dữ liệu (kỹ năng của nghề mục tiêu đã đạt ngưỡng, có thể nâng lên mức Giỏi):",
      "  - TST240 | Hệ quản trị cơ sở dữ liệu | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: HK1 2026–2027",
      "  - TST130 | Nhập môn cơ sở dữ liệu | 3 TC | đã đạt, điểm 6,8/10 (C+) – có thể học cải thiện",
      "S03 Kiểm thử phần mềm (kỹ năng của nghề mục tiêu dưới ngưỡng):",
      "  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: HK1 2026–2027",
      "  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: HK2 2026–2027"
    ].join("\n"));
    // Mạng máy tính and Sử dụng tiếng Anh are below Khá but outside the career: context only, no courses at all.
    for (const text of ["S06 |", "S07 |", "TST120", "TST310"]) expect(input.user).not.toContain(text);
    const selfStudy = syntheticResult();
    selfStudy.skillPlans[0] = { ...selfStudy.skillPlans[0]!, take: [], improve: [], selfStudy: true };
    expect(buildAiInput(selfStudy).user).toContain("S02 Cơ sở dữ liệu (kỹ năng của nghề mục tiêu đã đạt ngưỡng, có thể nâng lên mức Giỏi):\n" +
      "  (không còn học phần phù hợp; gợi ý một sản phẩm hoặc dự án cụ thể gắn với nghề mục tiêu để kiểm chứng)\n");
    const none = syntheticResult();
    none.skillPlans = [];
    none.career!.requirements = none.career!.requirements.filter((req) => req.status !== "below");
    expect(sectionOf(buildAiInput(none).user, "[6. ")).toContain("\nKhông có kỹ năng nào của nghề mục tiêu cần cải thiện hoặc nâng lên.");
  });

  it("without a career, offers the skills below Khá to strengthen, in plain words (comp-v4)", () => {
    expect(sectionOf(noCareer.user, "[6. ")).toBe([
      "[6. KỸ NĂNG DƯỚI MỨC KHÁ VÀ HỌC PHẦN GỢI Ý] (dùng cho improvements; chỉ chọn học phần trong danh sách của đúng kỹ năng)",
      "S06 Mạng máy tính (dưới mức Khá):",
      "  - TST310 | Quản trị mạng | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Hệ điều hành (TST210) | kế hoạch: HK2 2026–2027",
      // Planned before the term being studied (HK3 2025–2026): its term is not sent, it can be registered from the next one (comp-v13).
      "  - TST150 | Toán rời rạc | 3 TC | chưa đạt – cần học lại | đủ điều kiện đăng ký | đã trễ kế hoạch, đăng ký sớm nhất từ HK1 2026–2027",
      "  - TST120 | Mạng máy tính căn bản | 3 TC | đã đạt, điểm 6,5/10 (C+) – có thể học cải thiện",
      "S07 Sử dụng tiếng Anh (dưới mức Khá):",
      "  (không có học phần phù hợp; gợi ý tự học kèm sản phẩm kiểm chứng)",
      "S03 Kiểm thử phần mềm (dưới mức Khá):",
      "  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: HK1 2026–2027",
      "  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: HK2 2026–2027"
    ].join("\n"));
    const none = syntheticResult({ career: false });
    none.skillPlans = [];
    expect(sectionOf(buildAiInput(none).user, "[6. ")).toContain("\nKhông có kỹ năng nào cần cải thiện.");
  });

  it("words ongoing courses, unconfirmed or prior conditions and unscheduled terms", () => {
    const result = syntheticResult();
    const plan = result.skillPlans[0]!;
    const take = plan.take[0]!;
    plan.take = [
      { ...take, code: "TST401", name: "Cơ sở dữ liệu phân tán", eligibility: "review", eligibilityLabel: "Cần xác nhận", term: null, termLabel: "Chưa xếp lịch" },
      { ...take, code: "TST402", name: "Kho dữ liệu", eligibility: "not_eligible", eligibilityLabel: "Chưa đủ điều kiện", missing: [{ code: "TST210", name: "Hệ điều hành", kind: "prior" }, { code: "TST499", name: null, kind: "prerequisite" }] },
      { ...take, code: "TST403", name: "Khai phá dữ liệu", state: "in_progress" },
      { ...take, code: "TST404", name: "Dữ liệu lớn", state: "graded_unknown", term: "HK253" }
    ];
    const user = buildAiInput(result).user;
    expect(user).toContain("  - TST401 | Cơ sở dữ liệu phân tán | 3 TC | chưa học | cần xác nhận điều kiện với Khoa | chưa xếp lịch\n");
    expect(user).toContain("  - TST402 | Kho dữ liệu | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước học phần TST499; cần học trước Hệ điều hành (TST210) | kế hoạch: HK1 2026–2027\n");
    expect(user).toContain("  - TST403 | Khai phá dữ liệu | 3 TC | đang học\n");
    expect(user).toContain("  - TST404 | Dữ liệu lớn | 3 TC | đã có điểm, chưa rõ kết quả | đủ điều kiện đăng ký | đã trễ kế hoạch, đăng ký sớm nhất từ HK1 2026–2027\n");
  });

  it("sends a course the engine calls overdue to the next term, never its passed term (comp-calc-v17, comp-v13)", () => {
    const result = syntheticResult();
    const take = result.skillPlans[0]!.take[0]!;
    // HK261 is after the latest graded term but is the term being studied: overdue; overdue: false wins over an old term.
    result.skillPlans[0]!.take = [{ ...take, code: "TST405", name: "Học máy", term: "HK261", overdue: true }, { ...take, code: "TST406", name: "Thị giác máy tính", term: "HK252", overdue: false }];
    const user = buildAiInput(result).user;
    expect(user).toContain("  - TST405 | Học máy | 3 TC | chưa học | đủ điều kiện đăng ký | đã trễ kế hoạch, đăng ký sớm nhất từ HK1 2026–2027\n");
    expect(user).toContain("  - TST406 | Thị giác máy tính | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: HK2 2025–2026\n");
  });

  it("states a late choice's shortfall in its requirement's unit, like the pages (comp-v14, plan-progress.ts shortfallText)", () => {
    const result = syntheticResult();
    const option = (code: string, name: string, credits: number) => ({ code, name, credits, state: "not_taken" as const });
    result.progress = { ...result.progress!, late: [
      // A result stored before comp-calc-v19 counted the courses of a credit group in `missing`: 1 for a 6-TC group.
      { kind: "choice", label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", termCode: "HK252", required: 6, unit: "credit", missing: 1, missingCredits: 6, options: [option("TST405", "Đồ án tốt nghiệp", 6)] },
      { kind: "choice", label: "Chọn 1 trong 2 môn sau", termCode: "HK252", required: 1, unit: "course", missing: 1, missingCredits: 3,
        options: [option("TST406", "Phát triển ứng dụng di động", 3), option("TST407", "Hệ quản trị cơ sở dữ liệu nâng cao", 4)] },
    ] };
    const user = buildAiInput(result).user;
    expect(user).toContain("- trễ: Nhóm tự chọn TC406: chọn 6 tín chỉ (đã trễ kế hoạch): còn thiếu 6 TC\n");
    expect(user).toContain("- trễ: Chọn 1 trong 2 môn sau (đã trễ kế hoạch): còn thiếu 1 học phần (3–4 TC)\n");
    expect(user).not.toContain("còn thiếu 1 tín chỉ");
  });

  it("names the term the student chose in Kế hoạch học kỳ, and only a coming one (comp-v13)", () => {
    const result = syntheticResult();
    const user = buildAiInput(result, { planned: new Map([["TST201", "HK262"], ["TST150", "HK263"], ["TST240", "HK252"]]) }).user;
    expect(user).toContain("  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | Kế hoạch học kỳ của bạn: HK2 2026–2027\n");
    expect(user).toContain("- trễ: TST150 Toán rời rạc (Kế hoạch học kỳ của bạn: HK3 2026–2027)");
    // A plan term that has passed is not used.
    expect(user).toContain("  - TST240 | Hệ quản trị cơ sở dữ liệu | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: HK1 2026–2027\n");
  });

  it("names the weakest skills of each group below Khá and, with a career, whether each belongs to it", () => {
    expect(input.user).toContain("G2 | Kỹ năng bổ trợ | điểm 55/100 | Trung bình | tin cậy Thấp | 1/2 kỹ năng có minh chứng\n" +
      "  kỹ năng thấp nhất của nhóm: S03 Kiểm thử phần mềm (điểm 55/100, thuộc nghề mục tiêu); S06 Mạng máy tính (điểm 65,5/100, ngoài nghề mục tiêu)\n");
    expect(noCareer.user).toContain("  kỹ năng thấp nhất của nhóm: S03 Kiểm thử phần mềm (điểm 55/100); S06 Mạng máy tính (điểm 65,5/100)\n");
    // G1 is at Giỏi: no line, although Sử dụng tiếng Anh (61) belongs to it.
    expect(input.user).toContain("G1 | Kỹ thuật phần mềm | điểm 80,5/100 | Giỏi | tin cậy Trung bình | 2/2 kỹ năng có minh chứng\nG2 |");
  });

  it("does not list thesis replacements off that path as courses to come (comp-calc-v7)", () => {
    const result = syntheticResult();
    result.courses.push({ ...result.courses.find((course) => course.code === "TST240")!, code: "TST405", name: "Chuyên đề tốt nghiệp", electiveGroup: "TC406" });
    result.skills[1] = {
      ...result.skills[1]!,
      evidenceCourses: [
        { code: "TST101", weight: 0.5, contribution: 1.5, share: 0.5, role: "score" },
        { code: "TST405", weight: 1, contribution: 3, share: null, role: "planned" },
        { code: "TST240", weight: 1, contribution: 3, share: 0.5, role: "planned" }
      ]
    };
    result.excludedThesisReplacements = ["TST405"];
    const line = (value: typeof result) => buildAiInput(value).user.split("\n").find((text) => text.startsWith("S02 |"))!;
    expect(line(result)).toContain("| sắp học (chưa phải minh chứng): TST240 Hệ quản trị cơ sở dữ liệu (sắp học vào HK1 2026–2027)");
    expect(line(result)).not.toContain("TST405");
    // A result stored before comp-calc-v7 has no such list.
    delete (result as Partial<typeof result>).excludedThesisReplacements;
    expect(line(result)).toContain("TST405 Chuyên đề tốt nghiệp");
  });

  it("no longer sends the graduation check (the graduation page has its own result and advice)", () => {
    const result = syntheticResult();
    result.meta.graduationStandardVersion = 4;
    result.graduation = {
      ...result.graduation, resolution: "specialty", status: "fail", statusLabel: "Chưa đủ điều kiện xét tốt nghiệp", reason: null,
      credits: { lower: 117, upper: 117, required: 126, status: "fail", source: "printed" },
      gpa: { actual: 3.11, required: 2, scale: 4, status: "pass", source: "printed", reason: "" },
      groups: [{ groupId: "row-10", label: "Học phần bắt buộc", kind: "mandatory", code: null, unit: "môn", lower: 31, upper: 31, required: 34, status: "fail", accumulatedCredits: 90, curriculumElectiveCode: null }],
      needsImprovement: true
    };
    const user = buildAiInput(result).user;
    for (const text of ["XÉT TỐT NGHIỆP", "Kết quả tham khảo", "Tín chỉ tích lũy", "Điểm trung bình tích lũy", "Chưa đủ điều kiện xét tốt nghiệp", "Học phần bắt buộc", "điểm trung bình chưa đạt"]) {
      expect(user).not.toContain(text);
    }
    // Neither credits, GPA nor group counts reach the model, so the validator also rejects them in its text.
    for (const value of [117, 126, 3.11, 31, 34]) expect(numbersIn(user)).not.toContain(value);
  });

  it("names every group of a skill in several groups, and only the first one of a result stored before (2026-10-22)", () => {
    const result = syntheticResult();
    const target = result.skills[0]!;
    const other = result.groups.find((group) => group.key !== target.groupKey)!.key;
    result.skills[0] = { ...target, groupKeys: [target.groupKey, other].sort() };
    expect(buildAiInput(result).user).toContain(`${target.key} | ${target.name} | nhóm ${[target.groupKey, other].sort().join(", ")}`);
    result.skills[0] = { ...target, groupKeys: undefined as never };
    expect(buildAiInput(result).user).toContain(`${target.key} | ${target.name} | nhóm ${target.groupKey}`);
  });

  it("names the fit with the current scale (2026-10-22: the competency bounds), also for a result stored with the earlier labels", () => {
    const stored = syntheticResult();
    stored.career = { ...stored.career!, fit: 0.58, fitCode: "fairly_fit" as never, fitLabel: "Khá phù hợp" };
    const user = buildAiInput(stored).user;
    // The level comes from the requirements' điểm phù hợp, whatever was stored: (2 × 88,5 + 72,5 + 2 × 55 + 0 for
    // Điện toán đám mây, no data) / 6 = 59,91 (comp-calc-v14; 71,9 while no-data skills were left out).
    expect(user).toContain("Mức phù hợp: Ít phù hợp\n");
    expect(user).not.toContain("Khá phù hợp");
  });

  it("does not send the numeric fit index, only the label", () => {
    expect(input.user).toContain("Mức phù hợp: Ít phù hợp\n");
    expect(input.user).not.toContain("chỉ số");
    expect(input.user).not.toContain("0,79");
  });

  it("lists ongoing and planned courses apart from the evidence", () => {
    const result = syntheticResult();
    const s01 = result.skills[0]!;
    s01.evidenceCourses = [
      { code: "TST101", weight: 0.5, contribution: 1.5, share: 0.5, role: "score" },
      { code: "TST201", weight: 1, contribution: 3, share: 0.5, role: "planned" },
      { code: "TST202", weight: 1, contribution: 3, share: 0.5, role: "in_progress" }
    ];
    const line = buildAiInput(result).user.split("\n").find((text) => text.startsWith("S01 |"))!;
    expect(line).toContain("| minh chứng: TST101 Nhập môn lập trình (điểm 8,5/10, A)");
    expect(line).toContain("| đang học: TST202 Đảm bảo chất lượng phần mềm (đang học)");
    expect(line).toContain("| sắp học (chưa phải minh chứng): TST201 Kiểm thử phần mềm cơ bản (sắp học vào HK1 2026–2027)");
    expect(line.indexOf("minh chứng: TST101")).toBeLessThan(line.indexOf("đang học"));
    expect(line.split("minh chứng:")[1]!.split("|")[0]).not.toContain("TST201");
  });

  it("sends the numbers the page shows: 0–100 scores floored to the tenth with their scale, whole percentages, no term codes, no passed term (comp-v14)", () => {
    const result = syntheticResult();
    result.overall.score = 83.92;
    result.groups[0] = { ...result.groups[0]!, score: 89.56 };
    result.skills[0] = { ...result.skills[0]!, score: 93.44, coverage: 0.4567 };
    result.career!.requirements[2] = { ...result.career!.requirements[2]!, score: 75.56, deficit: 9.44 };
    const user = buildAiInput(result).user;
    expect(user).toContain("Điểm tổng: 83,9/100 | Khá");
    expect(user).toContain("G1 | Kỹ thuật phần mềm | điểm 89,5/100 | Giỏi");
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | thuộc nghề mục tiêu | điểm 93,4/100 | Giỏi | tin cậy Trung bình | độ phủ 46%");
    // The shortfall adds up with the score as shown: 75,5 + 9,5 = 85.
    expect(user).toContain("ngưỡng 85/100 | điểm 75,5/100 | Thấp hơn ngưỡng | thiếu 9,5 điểm (Thiếu nhiều)");
    for (const shown of [83.9, 89.5, 93.4, 75.5, 9.5]) expect(numbersIn(user)).toContain(shown);
    for (const raw of [83.92, 89.56, 93.44, 75.56, 9.44, 45.67]) expect(numbersIn(user)).not.toContain(raw);
    // Course scores stay on the 10-point scale with up to two decimals, like the page.
    expect(user).toContain("TST101 Nhập môn lập trình (điểm 8,5/10, A)");
    expect(user).toContain("Học kỳ đang học: HK3 2025–2026; học kỳ tới: HK1 2026–2027\n");
    expect(user).toContain("Học kỳ đang học: HK3 2025–2026; học kỳ kế tiếp theo kế hoạch đào tạo: HK1 2026–2027\n");
    expect(user).toContain("- trễ: TST150 Toán rời rạc (đã trễ kế hoạch, đăng ký sớm nhất từ HK1 2026–2027)");
    expect(user).not.toContain("Học kỳ gần nhất có điểm");
    expect(user).not.toContain("HK2 2025–2026");
    for (const user of [input.user, noCareer.user]) expect(user).not.toMatch(/HK\d{3}/);
  });

  it("never sends the competency history (STU-COMP-07, comp-calc-v8) nor its career skills (STU-GAP-07, comp-calc-v9)", () => {
    const result = syntheticResult();
    result.history = [{
      term: "HK253", schoolYear: "2025–2026", semester: 3, gradedCourses: 12,
      overall: { score: 72.25, level: "good", levelLabel: "Khá", skillsWithEvidence: 3, applicableSkills: 4 },
      groups: result.groups.map(({ key, name, score, level, levelLabel }) => ({ key, name, score, level, levelLabel })),
      career: { fitCode: "fit", fitLabel: "Phù hợp", met: 1, total: 1, requirements: [{ requirementId: "00000000-0000-4000-8000-0000000000d1", score: 91, status: "met" }] }
    }];
    expect(buildAiInput(result)).toEqual(input);
  });

  it("sanitizes names taken from the database", () => {
    expect(input.user).toContain("Kỹ sư phần mềm 'thử nghiệm'");
    expect(input.user).not.toContain("<|");
    expect(input.user).not.toContain('"');
  });

  it("stays far below the ~10K token budget for a small result", () => {
    for (const built of [input, noCareer]) expect(built.system.length + built.user.length).toBeLessThan(30_000);
  });
});

describe("buildPromptContext", () => {
  it("with a career: improvements are its skills below the threshold or with a plan to deepen, never strengths (comp-v5)", () => {
    expect(buildPromptContext(syntheticResult())).toEqual({
      groupKeys: ["G1", "G2"],
      // Career skills, then the top/bottom of the rest; the weak skills outside the career are not added.
      skillKeys: ["S01", "S02", "S03", "S05", "S04"],
      // Cơ sở dữ liệu (72,5, met) is to deepen, so it is no strength.
      strengthKeys: ["S01"],
      improvementKeys: ["S02", "S03"],
      improvementSkills: [{ key: "S02", courseCodes: ["TST240", "TST130"] }, { key: "S03", courseCodes: ["TST201", "TST202"] }],
      gapSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S05", courseCodes: [] }]
    });
  });

  it("with a career never offers a skill outside it, even one sent as context or with a comp-calc-v6 plan", () => {
    const result = syntheticResult();
    // Mạng máy tính sent among the weakest other skills, with a plan stored by comp-calc-v6 (no purpose).
    result.promptSelection.bottomSkillKeys = ["S06"];
    const old = { ...syntheticResult({ career: false }).skillPlans[2]! };
    delete (old as Partial<typeof old>).purpose;
    result.skillPlans.push(old);
    const context = buildPromptContext(result);
    expect(context.skillKeys).toContain("S06");
    expect(context.improvementKeys).toEqual(["S02", "S03"]);
    expect(context.strengthKeys).toEqual(["S01"]);
    const user = buildAiInput(result).user;
    expect(user).toContain("S06 | Mạng máy tính | nhóm G2 | ngoài nghề mục tiêu | điểm 65,5/100 | Trung bình");
    expect(user).not.toContain("TST310");
  });

  it("keeps strengths and improvements apart from each other and from missing evidence", () => {
    const result = syntheticResult();
    // A Khá skill below a Bắt buộc threshold is an improvement, never a strength.
    result.skillPlans = [];
    result.skills[1] = { ...result.skills[1]!, score: 73, level: "good", levelLabel: "Khá" };
    result.career!.requirements[1] = { ...result.career!.requirements[1]!, isRequired: true, threshold: 85, score: 73, status: "below" };
    const context = buildPromptContext(result);
    expect(context.strengthKeys).toEqual(["S01"]);
    expect(context.improvementKeys).toEqual(["S02", "S03"]);
    expect(context.improvementSkills[0]).toEqual({ key: "S02", courseCodes: [] });
    // S04 has no evidence and S05 no data: neither list.
    for (const key of ["S04", "S05"]) {
      expect(context.strengthKeys).not.toContain(key);
      expect(context.improvementKeys).not.toContain(key);
    }
  });

  it("names only skills with at least medium confidence as strengths (comp-v8)", () => {
    const result = syntheticResult();
    const strong = buildPromptContext(result).strengthKeys;
    expect(strong.length).toBeGreaterThan(0);
    const index = result.skills.findIndex((skill) => skill.key === strong[0]);
    result.skills[index] = { ...result.skills[index]!, confidence: "low", confidenceLabel: "Thấp" };
    expect(buildPromptContext(result).strengthKeys).not.toContain(strong[0]);
  });

  it("without a career: improvements are the skills below Khá with a plan to strengthen (comp-v4)", () => {
    expect(buildPromptContext(syntheticResult({ career: false }))).toEqual({
      groupKeys: ["G1", "G2"],
      // The 5 strongest, the plans and the weakest of the groups below Khá (already among them).
      skillKeys: ["S01", "S02", "S06", "S07", "S03"],
      // Only the page's "Điểm mạnh" (comp-v13): Cơ sở dữ liệu (72,5) is not one of them in this fixture.
      strengthKeys: ["S01"],
      improvementKeys: ["S06", "S07", "S03"],
      // Plan take courses, then the one to improve; a plan without any course.
      improvementSkills: [
        { key: "S06", courseCodes: ["TST310", "TST150", "TST120"] }, { key: "S07", courseCodes: [] }, { key: "S03", courseCodes: ["TST201", "TST202"] }
      ],
      gapSkills: []
    });
    // A skill below Khá without a plan (e.g. beyond MAX_SKILL_PLANS) is sent but not offered.
    const result = syntheticResult({ career: false });
    result.skillPlans = result.skillPlans.filter((plan) => plan.skillKey !== "S06");
    const context = buildPromptContext(result);
    expect(context.skillKeys).toContain("S06");
    expect(context.improvementKeys).toEqual(["S07", "S03"]);
    expect(context.strengthKeys).not.toContain("S06");
  });

  it("still renders a result stored before skill plans (comp-calc-v6)", () => {
    // Without a career: every sent skill below Khá (comp-v3), not claiming that no course exists.
    const plain = syntheticResult({ career: false });
    delete (plain as Partial<typeof plain>).skillPlans;
    const context = buildPromptContext(plain);
    expect(context.improvementSkills).toEqual([{ key: "S06", courseCodes: [] }, { key: "S07", courseCodes: [] }, { key: "S03", courseCodes: [] }]);
    expect(buildAiInput(plain).user).toContain("S06 Mạng máy tính (dưới mức Khá):\n  (chưa có danh sách học phần gợi ý; có thể gợi ý ôn lại học phần minh chứng ở mục [3])\n");
    // With a career: only its gap; its met Khá skill is a strength again when the page shows it as one (comp-v13).
    const career = syntheticResult();
    delete (career as Partial<typeof career>).skillPlans;
    expect(buildPromptContext(career)).toMatchObject({ strengthKeys: ["S01"], improvementKeys: ["S03"], improvementSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }] });
    career.highlights.strengths = ["S01", "S02"];
    expect(buildPromptContext(career)).toMatchObject({ strengthKeys: ["S01", "S02"], improvementKeys: ["S03"] });
  });

  it("takes the strengths from the page's Điểm mạnh and never offers one of them to improve (comp-v13)", () => {
    // Cơ sở dữ liệu (72,5, met, with a plan to deepen) shown as a strength: a strength, not an improvement.
    const shown = syntheticResult();
    shown.highlights.strengths = ["S01", "S02"];
    expect(buildPromptContext(shown)).toMatchObject({ strengthKeys: ["S01", "S02"], improvementKeys: ["S03"] });
    expect(buildAiInput(shown).user).toContain("Có thể nêu là điểm mạnh: S01, S02\nCó thể nêu là cần cải thiện: S03\n");
    // Below a Bắt buộc threshold too: left to the gaps, neither a strength nor an improvement.
    shown.career!.requirements[1] = { ...shown.career!.requirements[1]!, threshold: 85, score: 72.5, status: "below" };
    const below = buildPromptContext(shown);
    expect(below.strengthKeys).toEqual(["S01"]);
    expect(below.improvementKeys).toEqual(["S03"]);
    // A page strength outside the sent skills is added to them, so the comment has its data.
    const extra = syntheticResult({ career: false });
    extra.highlights.strengths = ["S01", "S04"];
    extra.skills[3] = { ...extra.skills[3]!, status: "scored", score: 81, level: "proficient", levelLabel: "Giỏi", confidence: "medium", confidenceLabel: "Trung bình" };
    expect(buildPromptContext(extra).skillKeys).toContain("S04");
    expect(buildPromptContext(extra).strengthKeys).toEqual(["S01", "S04"]);
  });

  it("keeps what the comment is checked against: coming terms, skill names and the courses of each skill (comp-v13)", () => {
    const checks = buildAiInput(syntheticResult()).checks;
    // The term being studied, the next one and the later terms of the data block; never a passed one.
    expect(checks.terms).toEqual(["HK253", "HK261", "HK262"]);
    expect(checks.names).toMatchObject({ S01: "Lập trình hướng đối tượng", S03: "Kiểm thử phần mềm", S04: "Làm việc nhóm", S05: "Điện toán đám mây" });
    expect(checks.courses.S03).toEqual(expect.arrayContaining(["Kiểm thử phần mềm cơ bản", "Đảm bảo chất lượng phần mềm"]));
    expect(checks.courses.S01).toEqual(["Nhập môn lập trình"]);
    // comp-v14: the scores with decimals as the data block writes them, by name. A whole score (Kiểm thử phần mềm 55) cannot
    // be cut, and a score the block does not show (Toán rời rạc 3,5: failed, listed without its score) was never given.
    expect(checks.scores).toEqual([
      { name: "điểm tổng", value: "72,2" }, { name: "năng lực chung", value: "72,2" }, { name: "Kỹ thuật phần mềm", value: "80,5" },
      { name: "Lập trình hướng đối tượng", value: "88,5" }, { name: "Cơ sở dữ liệu", value: "72,5" }, { name: "Mạng máy tính", value: "65,5" },
      { name: "Nhập môn lập trình", value: "8,5" }, { name: "Nhập môn cơ sở dữ liệu", value: "6,8" },
    ]);
  });

  it("has no gap candidates when no career is selected", () => {
    const input = buildAiInput(syntheticResult({ career: false }));
    expect(buildPromptContext(syntheticResult({ career: false })).gapSkills).toEqual([]);
    expect(input.user).toContain("Bạn chưa chọn nghề mục tiêu.");
  });
});

describe("a student who met every career skill (comp-v15)", () => {
  // User 2026-11-10: "Nhận xét không bao giờ nhận xét bạn đã đủ tất cả mà không cần học gì mà vẫn phải khuyến khích sinh
  // viên học thêm": sections [5], [6] and [7] all said "không có", and the comment only praised the fit.
  it("says nothing is missing, lists the met skills with a way on and counts the Bắt buộc and Ưu tiên ones", () => {
    const result = syntheticResult();
    const career = result.career!;
    career.requirements.forEach((requirement, index) => Object.assign(requirement, {
      status: "met", statusLabel: "Đạt", score: index % 2 ? 91 : 86.5, level: index % 2 ? "excellent" : "proficient", levelLabel: index % 2 ? "Xuất sắc" : "Giỏi",
      deficit: null, deficitBand: null, deficitBandLabel: null, noDataReason: null,
    }));
    const total = career.requirements.length;
    career.counts = { total, met: total, below: 0, upcoming: 0, notStudied: 0, noData: 0, withData: total };
    result.skillPlans = [];
    result.selfStudy = [];
    const { user } = buildAiInput(result);
    expect(user).toContain(`Không có kỹ năng nào của nghề mục tiêu còn thiếu: bạn đã đạt ngưỡng cả ${total}/${total} kỹ năng. Hướng học tiếp ở mục [6].`);
    expect(user).toContain("Kỹ năng của nghề mục tiêu đã đạt, vẫn học tiếp");
    const onward = user.split("\n").filter((line) => /^- S\d+ .+ \((Giỏi|Xuất sắc), điểm [\d,]+\/100\): /.test(line));
    expect(onward.length).toBe(career.requirements.filter((requirement) => requirement.skillKey).length);
    expect(onward.filter((line) => line.endsWith("nâng lên mức Xuất sắc")).length).toBeGreaterThan(0);
    expect(onward.filter((line) => line.endsWith("mở rộng sang kiến thức nâng cao ngoài chương trình")).length).toBeGreaterThan(0);
    expect(user).not.toContain("Không có kỹ năng nào của nghề mục tiêu cần cải thiện hoặc nâng lên.");
    const required = career.requirements.filter((requirement) => requirement.isRequired).length;
    expect(user).toContain(`Tính chất: ${required} kỹ năng Bắt buộc, ${total - required} kỹ năng Ưu tiên`);
  });

  it("keeps a comment with gaps on its gaps: no way-on list", () => {
    const { user } = buildAiInput(syntheticResult());
    expect(user).not.toContain("vẫn học tiếp");
    expect(user).not.toContain("còn thiếu: bạn đã đạt ngưỡng cả");
    expect(user).toMatch(/Tính chất: \d+ kỹ năng Bắt buộc/);
  });
});
