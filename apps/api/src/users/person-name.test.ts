import { describe, expect, it } from "vitest";
import { personName } from "./person-name.js";

// Synthetic display names in the shapes Microsoft gives VLU accounts; the web reads them the same way (person-name.ts).
describe("person names", () => {
  it("keeps only the name of 'MSSV - Họ tên - Lớp'", () => {
    expect(personName("2374802010145 - Đào Văn Hòa - 71K29CNTT08")).toBe("Đào Văn Hòa");
    expect(personName("207CT12345 - Nguyễn Thị Lan - K26T-IT11")).toBe("Nguyễn Thị Lan");
    expect(personName(" 2174802010992 – Sinh viên Thử nghiệm K27 — 71K27CNTT99 ")).toBe("Sinh viên Thử nghiệm K27");
    expect(personName("2174802010992 - Nguyễn Văn An")).toBe("Nguyễn Văn An");
    expect(personName("Nguyễn Văn An - 71K29CNTT01")).toBe("Nguyễn Văn An");
  });

  it("keeps any other name whole", () => {
    expect(personName("  Trần Thị Mai-Anh ")).toBe("Trần Thị Mai-Anh");
    expect(personName("ThS. Nguyễn Văn Cố Vấn")).toBe("ThS. Nguyễn Văn Cố Vấn");
    expect(personName("Phòng Đào tạo - Khoa CNTT")).toBe("Phòng Đào tạo - Khoa CNTT");
    expect(personName("qtv.thunghiem@vlu.edu.vn")).toBe("qtv.thunghiem@vlu.edu.vn");
    expect(personName("")).toBe("");
  });
});
