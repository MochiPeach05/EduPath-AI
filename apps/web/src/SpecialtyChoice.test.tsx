import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpecialtyChoice, {
  NO_SPECIALTY, SpecialtyForm, initialPick, pickChanges, pickedSpecialty, saveSpecialty, specialtyErrorMessage, specialtyOptions, specialtyText,
} from "./SpecialtyChoice";

// The specialty chosen where the transcript is imported (GVHD 2026-11-13, plan "Một bước để bắt đầu", 2026-11-14).
// Synthetic profiles only; without a DOM these tests draw the first render.
const noop = () => {};
const k29 = { cohortCode: "K29", majorCode: "7480201", specialty: null };

afterEach(() => { vi.unstubAllGlobals(); });

describe("the choices", () => {
  it("offers the specialties of the major and the cohort, then Chưa có chuyên ngành", () => {
    expect(specialtyOptions(k29).map((option) => option.label)).toEqual(["Công nghệ phần mềm", "Công nghệ dữ liệu", "Trí tuệ nhân tạo", "Chưa có chuyên ngành"]);
    expect(specialtyOptions({ ...k29, cohortCode: "K27" }).map((option) => option.value)).toEqual(["CNPM", "CNDL", "TTNT", "ANM", "KCN", NO_SPECIALTY]);
    expect(specialtyOptions({ ...k29, majorCode: "7480104" }, false).map((option) => option.label))
      .toEqual(["Hệ thống thông tin – Chuyển đổi số", "Hệ thống thông tin – Địa lý"]);
    // A major without specialties of its own: only the way out.
    expect(specialtyOptions({ ...k29, majorCode: "7340201" })).toEqual([{ value: NO_SPECIALTY, label: "Chưa có chuyên ngành" }]);
  });

  it("starts from the profile, stores none for Chưa có chuyên ngành, and saves only a change", () => {
    expect(initialPick("CNPM")).toBe("CNPM");
    expect(initialPick(null)).toBe("");
    expect(pickedSpecialty(NO_SPECIALTY)).toBeNull();
    expect(pickedSpecialty("")).toBeNull();
    expect(pickedSpecialty("TTNT")).toBe("TTNT");
    expect(pickChanges("", null)).toBe(false);
    expect(pickChanges(NO_SPECIALTY, null)).toBe(false);
    expect(pickChanges(NO_SPECIALTY, "CNPM")).toBe(true);
    expect(pickChanges("CNPM", "CNPM")).toBe(false);
    expect(pickChanges("CNDL", null)).toBe(true);
    expect(specialtyText(null)).toBe("Chưa có chuyên ngành");
    expect(specialtyText("CNDL")).toBe("Công nghệ dữ liệu");
  });
});

describe("the choice drawn", () => {
  it("draws radio cards with the chosen one marked and the hint of the cohort", () => {
    const html = renderToStaticMarkup(createElement(SpecialtyChoice, { profile: k29, value: "CNDL", onChange: noop }));
    expect(html).toMatch(/^<fieldset class="spc spc-cards" aria-describedby="[^"]+-hint"><legend class="spc-label">Chuyên ngành của bạn<span class="spc-required" aria-hidden="true"> \*<\/span><\/legend>/);
    expect(html).toMatch(/<label class="spc-option is-on"><input type="radio" required="" name="[^"]+" checked="" value="CNDL"\/><span>Công nghệ dữ liệu<\/span><\/label>/);
    expect(html).toMatch(/<label class="spc-option spc-none"><input type="radio" required="" name="[^"]+" value="none"\/><span>Chưa có chuyên ngành<\/span><\/label>/);
    expect(html).toContain("Cùng với khóa K29, dùng để chọn tiêu chuẩn xét tốt nghiệp và học phần chuyên ngành khi đánh giá năng lực. Đổi lại được bất cứ lúc nào.");
  });

  it("draws a select with a first line to choose from when nothing is chosen yet, and says why a save was refused", () => {
    const html = renderToStaticMarkup(createElement(SpecialtyChoice, { profile: k29, value: "", onChange: noop, variant: "select", error: "Hãy chọn chuyên ngành." }));
    expect(html).toMatch(/<label class="spc-label" for="([^"]+)-select">Chuyên ngành của bạn.*<select id="\1-select" required="" aria-describedby="\1-hint \1-error" aria-invalid="true">/);
    expect(html).toMatch(/<option value=""[^>]*>Chọn chuyên ngành…<\/option><option value="CNPM">/);
    expect(html).toMatch(/<p id="[^"]+-error" class="spc-error" role="alert">Hãy chọn chuyên ngành\.<\/p>/);
  });

  it("saves on its own with Lưu, off until a choice is made", () => {
    const empty = renderToStaticMarkup(createElement(SpecialtyForm, { profile: k29, withNone: false, onSaved: noop }));
    expect(empty).toContain('<button type="submit" class="sw-primary" disabled="">Lưu chuyên ngành</button>');
    expect(empty).not.toContain("Chưa có chuyên ngành");
    const suggested = renderToStaticMarkup(createElement(SpecialtyForm, { profile: k29, initial: "TTNT", onSaved: noop, onCancel: noop }));
    expect(suggested).toMatch(/checked="" value="TTNT"/);
    expect(suggested).toContain('<button type="button" class="sr-secondary">Hủy</button><button type="submit" class="sw-primary">Lưu chuyên ngành</button>');
  });
});

describe("saving the specialty", () => {
  it("sends only the specialty to PATCH /api/student/profile", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await saveSpecialty("CNPM", false);
    expect(fetch).toHaveBeenCalledWith("/api/student/profile", expect.objectContaining({ method: "PATCH", credentials: "include", body: JSON.stringify({ specialty: "CNPM" }) }));
    await saveSpecialty(null, false);
    expect(fetch).toHaveBeenLastCalledWith("/api/student/profile", expect.objectContaining({ body: JSON.stringify({ specialty: null }) }));
  });

  it("says why a save was refused, in the student's words or, for a cố vấn học tập, of the student", () => {
    expect(specialtyErrorMessage("specialty_unavailable", 400)).toBe("Chuyên ngành này không áp dụng cho khóa của bạn. Hãy chọn chuyên ngành khác.");
    expect(specialtyErrorMessage("specialty_unavailable", 400, true)).toBe("Chuyên ngành này không áp dụng cho khóa của sinh viên. Hãy chọn chuyên ngành khác.");
    expect(specialtyErrorMessage(undefined, 401)).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    expect(specialtyErrorMessage("invalid_profile", 400)).toBe("Chuyên ngành chưa hợp lệ. Vui lòng chọn lại.");
    expect(specialtyErrorMessage(undefined, 500)).toBe("Chưa lưu được chuyên ngành. Vui lòng thử lại.");
  });

  it("tells the page a session that ran out", async () => {
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const expired = vi.fn();
    page.addEventListener("edupath-session-expired", expired);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(saveSpecialty("CNPM", false)).rejects.toThrow("Phiên đăng nhập đã hết hạn.");
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
