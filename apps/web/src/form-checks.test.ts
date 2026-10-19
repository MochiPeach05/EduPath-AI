import { describe, expect, it } from "vitest";
import { countWords, DESCRIPTION_MAX_WORDS, fieldMessage, LONG_DESCRIPTION_MAX_WORDS, summaryMessage, wordLimitMessage, type FieldState } from "./form-checks";

const valid: FieldState["validity"] = {
  valueMissing: false, typeMismatch: false, patternMismatch: false, tooLong: false, tooShort: false,
  rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false, customError: false,
};
const field = (patch: Partial<FieldState> & { invalid?: Partial<FieldState["validity"]> }): FieldState => {
  const { invalid, ...rest } = patch;
  return { tag: "input", type: "text", required: false, value: "", label: "Tên nhóm năng lực", validity: { ...valid, ...invalid }, validationMessage: "", ...rest };
};

describe("field messages", () => {
  it("asks for a required field in Vietnamese, also when it holds only spaces", () => {
    expect(fieldMessage(field({ required: true, invalid: { valueMissing: true } }))).toBe("Vui lòng nhập tên nhóm năng lực.");
    expect(fieldMessage(field({ required: true, value: "   " }))).toBe("Vui lòng nhập tên nhóm năng lực.");
    expect(fieldMessage(field({ required: true, value: "Chuyên môn" }))).toBe("");
    expect(fieldMessage(field({ tag: "textarea", type: "", required: true, value: "\n", label: "Mô tả" }))).toBe("Vui lòng nhập mô tả.");
    expect(fieldMessage(field({ tag: "select", type: "", required: true, label: "Nhóm năng lực", invalid: { valueMissing: true } }))).toBe("Vui lòng chọn nhóm năng lực.");
  });

  it("keeps acronyms and labels that already say what to do", () => {
    expect(fieldMessage(field({ required: true, label: "CTĐT áp dụng", invalid: { valueMissing: true } }))).toBe("Vui lòng nhập CTĐT áp dụng.");
    expect(fieldMessage(field({ required: true, label: "Nhập K30 để xác nhận", invalid: { valueMissing: true } }))).toBe("Vui lòng nhập K30 để xác nhận.");
    expect(fieldMessage(field({ tag: "select", type: "", required: true, label: "Chọn lĩnh vực", invalid: { valueMissing: true } }))).toBe("Vui lòng chọn lĩnh vực.");
    expect(fieldMessage(field({ type: "checkbox", required: true, label: "Tôi xác nhận xóa", invalid: { valueMissing: true } }))).toBe("Vui lòng đánh dấu ô xác nhận trước khi tiếp tục.");
    expect(fieldMessage(field({ required: true, label: "", invalid: { valueMissing: true } }))).toBe("Vui lòng nhập thông tin này.");
  });

  it("explains formats, lengths and number ranges", () => {
    expect(fieldMessage(field({ type: "email", label: "Email Microsoft", value: "abc", invalid: { typeMismatch: true } }))).toBe("Email chưa đúng định dạng, ví dụ ten@vlu.edu.vn.");
    expect(fieldMessage(field({ value: "x", maxLength: 160, invalid: { tooLong: true } }))).toBe("Tên nhóm năng lực tối đa 160 ký tự.");
    expect(fieldMessage(field({ value: "x", minLength: 3, invalid: { tooShort: true } }))).toBe("Tên nhóm năng lực cần ít nhất 3 ký tự.");
    const credits = { type: "number", label: "Tổng tín chỉ quy định", value: "500", min: "1", max: "400" };
    expect(fieldMessage(field({ ...credits, invalid: { rangeOverflow: true } }))).toBe("Tổng tín chỉ quy định phải từ 1 đến 400.");
    expect(fieldMessage(field({ ...credits, max: undefined, value: "0", invalid: { rangeUnderflow: true } }))).toBe("Tổng tín chỉ quy định phải từ 1 trở lên.");
    expect(fieldMessage(field({ type: "number", label: "Số tín chỉ", value: "2.5", step: "1", invalid: { stepMismatch: true } }))).toBe("Số tín chỉ phải là số nguyên.");
    expect(fieldMessage(field({ type: "number", label: "Số tín chỉ", invalid: { badInput: true } }))).toBe("Số tín chỉ phải là số.");
    expect(fieldMessage(field({ title: "Chỉ gồm chữ thường và số.", invalid: { patternMismatch: true } }))).toBe("Chỉ gồm chữ thường và số.");
  });

  it("shows the field's own message for a custom check such as the word limit", () => {
    const message = wordLimitMessage("Mô tả", DESCRIPTION_MAX_WORDS, 215);
    expect(message).toBe("Mô tả tối đa 200 từ (hiện có 215 từ).");
    expect(fieldMessage(field({ tag: "textarea", type: "", label: "Mô tả", invalid: { customError: true }, validationMessage: message }))).toBe(message);
  });

  it("summarises a refused save", () => {
    expect(summaryMessage(["", ""])).toBe("");
    expect(summaryMessage(["", "Vui lòng nhập tên nhóm năng lực."])).toBe("Vui lòng nhập tên nhóm năng lực.");
    expect(summaryMessage(["Vui lòng nhập tên kỹ năng.", "", "Vui lòng chọn nhóm năng lực."])).toBe("Còn 2 thông tin cần nhập hoặc sửa. Vui lòng nhập tên kỹ năng.");
  });
});

describe("description word limits", () => {
  it("counts Vietnamese words by syllable, as word processors do", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n ")).toBe(0);
    expect(countWords(" Kỹ năng  làm việc\nnhóm. ")).toBe(5);
  });

  it("is generous: about 3 times the longest description in use (about 60 words)", () => {
    expect(DESCRIPTION_MAX_WORDS).toBe(200);
    expect(LONG_DESCRIPTION_MAX_WORDS).toBe(400);
  });
});
