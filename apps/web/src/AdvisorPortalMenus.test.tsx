import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassTable, StudentTable } from "./AdvisorPortal";
import { useTableSort } from "./table-sort";
import type { AdvisedStudentRow, AdvisorClass } from "./advisor-types";

// The real ⋮ menu lists its items only once opened; this one lists them all, keeps them for the test and names the
// menu, so the markup shows what each class row offers.
const menus = vi.hoisted(() => [] as { label: string; items: { key: string; label: string; onSelect: () => void }[] }[]);
vi.mock("./admin-ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("./admin-ui")>(),
  ActionMenu: ({ label, items }: { label: string; items: { key: string; label: string; onSelect: () => void }[] }) => {
    menus.push({ label, items });
    return <ul aria-label={label}>{items.map((item) => <li key={item.key}>{item.label}</li>)}</ul>;
  },
}));
afterEach(() => { menus.length = 0; });

const classes: AdvisorClass[] = [
  { className: "71K29CNTT01", cohort: "K29", students: 45, signedIn: 40, withTranscript: 38, assessed: 30, surveyDone: 20, roadmap: 12, advisorName: "Nguyễn Văn An" },
  { className: "71K29CNTT02", cohort: "K29", students: 0, signedIn: 0, withTranscript: 0, assessed: 0, surveyDone: 0, roadmap: 0, advisorName: null },
];

function Classes({ onPick, onImport }: { onPick: (className: string) => void; onImport?: (className: string) => void }) {
  const { sort, sortHeader } = useTableSort();
  return <ClassTable classes={classes} sort={sort} sortHeader={sortHeader} selected="" onPick={onPick} onImport={onImport} />;
}

describe("Quản lý sinh viên: the ⋮ menu of a class (reviewer note 2026-11-14)", () => {
  it("groups the actions of each class in the ⋮ menu of its Thao tác cell, named after the class", () => {
    const html = renderToStaticMarkup(<Classes onPick={() => undefined} onImport={() => undefined} />);
    expect(menus.map((menu) => menu.label)).toEqual(["Thao tác với lớp 71K29CNTT01", "Thao tác với lớp 71K29CNTT02"]);
    for (const menu of menus) expect(menu.items.map((item) => item.label)).toEqual(["Xem danh sách sinh viên", "Import danh sách sinh viên"]);
    // The old button is gone.
    expect(html).not.toContain("am-outline");
    expect(html).toMatch(/<td><ul aria-label="Thao tác với lớp 71K29CNTT02"><li>Xem danh sách sinh viên<\/li><li>Import danh sách sinh viên<\/li><\/ul><\/td><\/tr><\/tbody>/);
  });

  it("offers the import only where the page gives it one", () => {
    renderToStaticMarkup(<Classes onPick={() => undefined} />);
    for (const menu of menus) expect(menu.items.map((item) => item.label)).toEqual(["Xem danh sách sinh viên"]);
  });

  it("gives a student of a class list who never signed in a ⋮ menu that removes them; a student who signed in keeps Xem chi tiết", () => {
    const listed: AdvisedStudentRow = { stt: 1, userId: null, signedIn: false, email: null, studentCode: "2374802019001", name: "Nguyễn Văn Thử", className: "71K29CNTT99",
      cohort: "K29", specialty: null, targetCareer: null, hasTranscript: false, assessed: false, surveyDone: false, roadmap: false, lastLoginAt: null };
    const account: AdvisedStudentRow = { ...listed, stt: 2, userId: "s2", signedIn: true, studentCode: "2374802010994", name: "Sinh Viên Đã Vào" };
    const onRemove = vi.fn();
    function Students() {
      const { sortHeader } = useTableSort();
      return <StudentTable students={[listed, account]} page={1} sortHeader={sortHeader} opening={null} onOpen={() => undefined} onRemove={onRemove} />;
    }
    const html = renderToStaticMarkup(<Students />);
    expect(menus.map((menu) => [menu.label, menu.items.map((item) => item.label)])).toEqual([["Thao tác với sinh viên Nguyễn Văn Thử", ["Xóa khỏi danh sách lớp"]]]);
    expect(html.match(/Xem chi tiết<\/button>/g)).toHaveLength(1);
    menus[0]!.items[0]!.onSelect();
    expect(onRemove).toHaveBeenCalledWith(listed);
  });

  it("Import danh sách sinh viên opens the import of its row's class", () => {
    const onImport = vi.fn();
    renderToStaticMarkup(<Classes onPick={() => undefined} onImport={onImport} />);
    menus.find((menu) => menu.label.endsWith("71K29CNTT01"))!.items.find((item) => item.key === "import")!.onSelect();
    expect(onImport).toHaveBeenCalledWith("71K29CNTT01");
  });

  it("Xem danh sách sinh viên picks the class of its row, as the button did", () => {
    const onPick = vi.fn();
    renderToStaticMarkup(<Classes onPick={onPick} />);
    menus.find((menu) => menu.label.endsWith("71K29CNTT02"))!.items.find((item) => item.key === "students")!.onSelect();
    expect(onPick).toHaveBeenCalledWith("71K29CNTT02");
  });
});
