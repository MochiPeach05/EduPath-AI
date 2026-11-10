import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentProfileSteps, { TRANSCRIPT_UPDATED_EVENT, onTranscriptUpdated, profileSteps } from "./StudentProfileSteps";
import { ProfilePage } from "./StudentWorkspace";
import { requiredProfileItems, type StudentProfile } from "./StudentOverview";

type FileSystem = { readFileSync(path: URL, encoding: "utf8"): string };
/** The bar's stylesheet as written (Vitest hands CSS imports to the page empty). */
async function stepsCss(): Promise<string> {
  const nodeFs = "node:fs";
  const fs = (await import(/* @vite-ignore */ nodeFs)) as FileSystem;
  return fs.readFileSync(new URL("./student-profile-steps.css", import.meta.url), "utf8");
}

// The other sections of the page are replaced by their ids, so the order of the page can be read.
vi.mock("./StudentTranscript", async () => {
  const { createElement: element } = await import("react");
  return { default: () => element("section", { id: "bang-diem" }) };
});
vi.mock("./StudentProfileEditor", async () => {
  const { createElement: element } = await import("react");
  return { default: () => element("section", { id: "muc-tieu-hoc-tap" }) };
});
vi.mock("./StudentProfileSurvey", async () => {
  const { createElement: element } = await import("react");
  return { default: () => element("section", { id: "khao-sat-dinh-huong" }) };
});

// An invented student (no real data): nothing done yet.
const empty: StudentProfile = {
  name: "Sinh viên Thử nghiệm", studentCode: null, cohortCode: "K29", className: null, cohortYear: 2023, currentSemester: null, email: null,
  careerGoal: null, interests: null, profileStatus: "incomplete", specialty: null, careerPositionId: null, careerPosition: null,
  surveyUpdatedAt: null, surveyComplete: false, hasTranscript: false,
};
const complete: StudentProfile = {
  ...empty, profileStatus: "complete", specialty: "CNPM", careerPositionId: "00000000-0000-4000-8000-0000000000c1",
  surveyUpdatedAt: "2026-10-20T00:00:00Z", surveyComplete: true, hasTranscript: true,
};
const render = (profile: StudentProfile, advisorView = false) =>
  renderToStaticMarkup(createElement(StudentProfileSteps, { profile, advisorView, onOpen: () => {} }));
const states = (profile: StudentProfile, advisorView = false) => profileSteps(profile, advisorView).map((step) => step.state);

afterEach(() => { vi.unstubAllGlobals(); });

describe("the steps of Hồ sơ và bảng điểm", () => {
  it("are the items of the Tổng quan gate, in its order and words, each opening the section where it is filled in", () => {
    const steps = profileSteps(empty);
    expect(steps.map((step) => step.label)).toEqual(requiredProfileItems(empty, false).map((item) => item.label));
    expect(steps.map((step) => step.label)).toEqual(["Bảng điểm học tập", "Chuyên ngành", "Vị trí nghề nghiệp mục tiêu", "Khảo sát định hướng"]);
    expect(steps.map((step) => step.section)).toEqual(["bang-diem", "muc-tieu-hoc-tap", "muc-tieu-hoc-tap", "khao-sat-dinh-huong"]);
  });

  it("make the first missing item the next step, with a short action, and keep the gate's hints on the others", () => {
    const first = profileSteps(empty);
    expect(first.map((step) => step.state)).toEqual(["next", "todo", "todo", "todo"]);
    expect(first.map((step) => step.action)).toEqual(["Import bảng điểm", null, null, null]);
    expect(first.slice(1).map((step) => step.note)).toEqual(requiredProfileItems(empty, false).slice(1).map((item) => item.hint));

    const withTranscript = profileSteps({ ...empty, hasTranscript: true });
    expect(withTranscript.map((step) => step.state)).toEqual(["done", "next", "todo", "todo"]);
    expect(withTranscript[0]!.note).toBe("Đã hoàn thành");
    expect(withTranscript[1]!.action).toBe("Chọn chuyên ngành");

    expect(profileSteps({ ...complete, careerPositionId: null }).find((step) => step.state === "next")?.action).toBe("Chọn vị trí nghề nghiệp");
    expect(profileSteps({ ...complete, surveyUpdatedAt: null, surveyComplete: false })[3]!.action).toBe("Làm khảo sát");
    // Saved answers that no longer count (a newer question set or policy).
    expect(profileSteps({ ...complete, surveyComplete: false })[3]!.action).toBe("Cập nhật khảo sát");
    // A later step missing while an earlier one is done: the first missing one is next, wherever it is.
    expect(states({ ...complete, specialty: null, surveyComplete: false })).toEqual(["done", "next", "done", "todo"]);
  });

  it("show what is done and point at the next step", () => {
    const html = render({ ...empty, hasTranscript: true });
    expect(html).toContain("Hoàn thành hồ sơ");
    expect(html).toContain("Đã xong 1/4");
    expect(html).toContain("EduPath AI cần đủ 4 mục này để đánh giá năng lực và gợi ý lộ trình học tập cho bạn.");
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    const next = html.slice(html.indexOf('aria-current="step"'), html.indexOf("</button>", html.indexOf('aria-current="step"')));
    expect(next).toContain("Chuyên ngành");
    expect(next).toContain("Chọn chuyên ngành");
    // Every step is a button, in the order of the gate.
    expect(html.match(/<button type="button"/g)).toHaveLength(4);
    const at = ["Bảng điểm học tập", "Chuyên ngành", "Vị trí nghề nghiệp mục tiêu", "Khảo sát định hướng"].map((label) => html.indexOf(`<strong>${label}</strong>`));
    expect(at.every((value, index) => value > (at[index - 1] ?? -1))).toBe(true);
    expect(html).toContain("(chưa hoàn thành)");
    expect(html).not.toContain("sps-complete");
  });

  it("fold into one quiet line once all four are done", () => {
    const html = render(complete);
    expect(html).toContain("sps-complete");
    expect(html).toContain("Hồ sơ đã đủ 4/4");
    expect(html.match(/<button type="button"/g)).toHaveLength(4);
    for (const label of ["Bảng điểm học tập", "Chuyên ngành", "Vị trí nghề nghiệp mục tiêu", "Khảo sát định hướng"]) expect(html).toContain(label);
    for (const loud of ["Hoàn thành hồ sơ", "Đã xong", "aria-current", "chưa hoàn thành", "so-gate"]) expect(html).not.toContain(loud);
  });

  it("let a cố vấn học tập or the Khoa do every step for the student, the survey too (policy 2026-11-10)", () => {
    // Nothing done: the transcript first (AD-AST-07); the notes speak of the student, never "của bạn".
    const steps = profileSteps(empty, true);
    expect(steps.map((step) => step.state)).toEqual(["next", "todo", "todo", "todo"]);
    expect(steps.map((step) => step.action)).toEqual(["Import bảng điểm", null, null, null]);
    expect(steps.slice(1).map((step) => step.note)).toEqual([...requiredProfileItems(empty, false).slice(1, 3).map((item) => item.hint), "Sinh viên chưa làm"]);
    const html = render(empty, true);
    expect(html).toContain("Hồ sơ của sinh viên");
    expect(html).toContain("Bạn import được bảng điểm, chọn chuyên ngành, vị trí nghề nghiệp mục tiêu và làm Khảo sát định hướng thay sinh viên.");
    for (const words of ["do sinh viên tự làm", "cho bạn", "của bạn", "Sinh viên chưa chọn"]) expect(html).not.toContain(words);
    const imported = { ...empty, hasTranscript: true, surveyUpdatedAt: "2026-10-20T00:00:00Z" };
    expect(states(imported, true)).toEqual(["done", "next", "todo", "todo"]);
    expect(profileSteps({ ...imported, specialty: "CNPM" }, true).map((step) => step.action)).toEqual([null, null, "Chọn vị trí nghề nghiệp", null]);
    // The goals chosen: the survey is the next step, as for the student.
    const chosen = { ...imported, specialty: "CNPM", careerPositionId: "00000000-0000-4000-8000-0000000000c1" };
    expect(states(chosen, true)).toEqual(["done", "done", "done", "next"]);
    expect(profileSteps(chosen, true)[3]!.action).toBe("Cập nhật khảo sát");
    expect(profileSteps({ ...chosen, surveyUpdatedAt: null }, true)[3]!.action).toBe("Làm khảo sát");
    expect(render(chosen, true).match(/aria-current="step"/g)).toHaveLength(1);
    // A survey filled in for the student counts once the API says it does (surveyComplete).
    expect(render({ ...chosen, surveyComplete: true }, true)).toContain("Hồ sơ đã đủ 4/4");
    // The student withdrew the consent (Xóa câu trả lời): never the staff's next step; the student still sees it as theirs.
    const withdrawn = { ...chosen, surveyUpdatedAt: null, surveyWithdrawn: true };
    expect(states(withdrawn, true)).toEqual(["done", "done", "done", "todo"]);
    expect(profileSteps(withdrawn, true)[3]!.note).toBe("Sinh viên đã rút đồng ý");
    expect(profileSteps(withdrawn)[3]!.action).toBe("Làm khảo sát");
  });

  it("keeps its text at 12px or more and follows its own width, not the screen's", async () => {
    const css = await stepsCss();
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    expect(css).not.toMatch(/@media/);
    expect(css).toContain("@container sps");
  });
});

describe("the order of Hồ sơ và bảng điểm", () => {
  const card = createElement("section", { className: "sw-panel sw-profile" });
  const page = (profile: StudentProfile | null) =>
    renderToStaticMarkup(createElement(ProfilePage, { profile, card, advisorView: false, onSaved: () => {} }));

  it("puts the steps first, the two short cards next, then the transcript, and the survey last", () => {
    const html = page({ ...empty, hasTranscript: true });
    const order = ['class="sps', 'class="sw-panel sw-profile"', 'id="muc-tieu-hoc-tap"', 'id="bang-diem"', 'id="khao-sat-dinh-huong"'].map((part) => html.indexOf(part));
    expect(order.every((value) => value >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.startsWith('<div class="sr-profile-layout">')).toBe(true);
  });

  it("shows the card and the transcript while the profile loads, without steps", () => {
    const html = page(null);
    expect(html).toBe('<div class="sr-profile-layout"><section class="sw-panel sw-profile"></section><section id="bang-diem"></section></div>');
  });
});

describe("live updates of the steps", () => {
  it("hears StudentTranscript's event after an import or a delete, until it stops listening", () => {
    vi.stubGlobal("window", new EventTarget());
    const heard = vi.fn();
    const stop = onTranscriptUpdated(heard);
    // The event StudentTranscript dispatches (contract of 2026-11-04).
    window.dispatchEvent(new CustomEvent("edupath-transcript-updated"));
    window.dispatchEvent(new CustomEvent(TRANSCRIPT_UPDATED_EVENT));
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new CustomEvent(TRANSCRIPT_UPDATED_EVENT));
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
