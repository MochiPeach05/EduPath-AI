import { describe, expect, it } from "vitest";
import { nameInitials, personIdentity, personName } from "./person-name";

// Synthetic display names in the shapes Microsoft gives VLU accounts.
describe("person names", () => {
  it("keeps only the name of 'MSSV - Họ tên - Lớp' and keeps the code apart", () => {
    expect(personIdentity("2374802010145 - Đào Văn Hòa - 71K29CNTT08")).toEqual({ name: "Đào Văn Hòa", code: "2374802010145" });
    expect(personIdentity("207CT12345 - Nguyễn Thị Lan - K26T-IT11")).toEqual({ name: "Nguyễn Thị Lan", code: "207CT12345" });
    expect(personIdentity("2174802010992 – Sinh viên Thử nghiệm K27 — 71K27CNTT99")).toEqual({ name: "Sinh viên Thử nghiệm K27", code: "2174802010992" });
    expect(personIdentity("2174802010992 - Nguyễn Văn An")).toEqual({ name: "Nguyễn Văn An", code: "2174802010992" });
    expect(personIdentity("Nguyễn Văn An - 71K29CNTT01")).toEqual({ name: "Nguyễn Văn An", code: null });
  });

  it("keeps any other name whole", () => {
    expect(personName("  Trần Thị Mai-Anh ")).toBe("Trần Thị Mai-Anh");
    expect(personName("ThS. Nguyễn Văn Cố Vấn")).toBe("ThS. Nguyễn Văn Cố Vấn");
    expect(personName("Phòng Đào tạo - Khoa CNTT")).toBe("Phòng Đào tạo - Khoa CNTT");
    expect(personName("qtv.thunghiem@vlu.edu.vn")).toBe("qtv.thunghiem@vlu.edu.vn");
  });

  it("builds the avatar's initials from the name, as the student portal does", () => {
    expect(nameInitials("Nguyễn Bảo Duy")).toBe("BD");
    expect(nameInitials(personName("2374802010145 - Đào Văn Hòa - 71K29CNTT08"))).toBe("VH");
    expect(nameInitials("đặng thị ánh")).toBe("TÁ");
    expect(nameInitials("2374802010145")).toBe("");
  });
});
