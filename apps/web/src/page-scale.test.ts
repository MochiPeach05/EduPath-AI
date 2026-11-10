import { describe, expect, it } from "vitest";
import { layoutHeight, layoutZoom, syncPageScale } from "./page-scale";

type FileSystem = { readFileSync(path: URL, encoding: "utf8"): string };
/** A stylesheet as written (Vitest hands CSS imports to the page empty). */
async function css(name: string): Promise<string> {
  const nodeFs = "node:fs";
  const fs = (await import(/* @vite-ignore */ nodeFs)) as FileSystem;
  return fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const fakeRoot = () => ({ dataset: {} as Record<string, string | undefined> }) as unknown as HTMLElement;

describe("page scale (user 2026-11-10: the landing page and the student portal at 100%, the admin portal unchanged)", () => {
  it("marks only the admin portal's addresses", () => {
    for (const path of ["/quantri", "/quantri/", "/quantri/tong-quan", "/quantri/quan-ly-sinh-vien", "/quantri/khong-co-trang-nay"]) {
      const root = fakeRoot();
      syncPageScale(path, root);
      expect(root.dataset.epScale, path).toBe("admin");
    }
    for (const path of ["/", "/dashboard", "/login", "/auth/callback", "/chinh-sach-va-dieu-khoan", "/cau-hoi-thuong-gap", "/khong-co", "/quantrivien"]) {
      const root = fakeRoot();
      syncPageScale(path, root);
      expect(root.dataset.epScale, path).toBeUndefined();
    }
  });

  it("takes the mark away when the address leaves the admin portal", () => {
    const root = fakeRoot();
    syncPageScale("/quantri/tai-khoan", root);
    syncPageScale("/dashboard", root);
    expect(root.dataset.epScale).toBeUndefined();
  });

  it("draws the 80% desktop scale and the larger text for the admin portal only", async () => {
    const styles = await css("styles.css");
    const desktop = styles.slice(styles.indexOf("@media (min-width: 1200px)"));
    const block = desktop.slice(0, desktop.indexOf("\n}\n"));
    expect(block).toMatch(/:root\[data-ep-scale="admin"\]\s*\{[^}]*--ep-zoom:\s*\.8;[^}]*--ep-text-adjust:\s*0\.57;[^}]*--ep-serif-adjust:\s*0\.48;/);
    expect(block).toMatch(/:root\[data-ep-scale="admin"\] body\s*\{\s*zoom:\s*var\(--ep-zoom\);/);
    // Nothing else sets the scale: every other page keeps --ep-zoom 1 and no font-size-adjust.
    expect([...styles.matchAll(/--ep-zoom:\s*([^;]+);/g)].map((match) => match[1])).toEqual(["1", ".8"]);
    expect([...styles.matchAll(/^\s*zoom:/gm)]).toHaveLength(1);
  });
});

describe("layoutZoom", () => {
  it("reads the painted zoom, 1 where there is none", () => {
    expect(layoutZoom({ currentCSSZoom: 0.8 } as unknown as Element)).toBe(0.8);
    expect(layoutZoom({ currentCSSZoom: 1 } as unknown as Element)).toBe(1);
    expect(layoutZoom({} as Element)).toBe(1);
    expect(layoutZoom({ currentCSSZoom: 0 } as unknown as Element)).toBe(1);
  });

  it("gives heights back in the stylesheet's px", () => {
    const header = { currentCSSZoom: 0.8, getBoundingClientRect: () => ({ height: 73.6 }) } as unknown as Element;
    expect(layoutHeight(header)).toBeCloseTo(92);
    const student = { currentCSSZoom: 1, getBoundingClientRect: () => ({ height: 92 }) } as unknown as Element;
    expect(layoutHeight(student)).toBe(92);
  });
});
