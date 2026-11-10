import { describe, expect, it } from "vitest";
import { layoutHeight, layoutZoom, setPageScale, syncPageScale, type PageScale } from "./page-scale";

type FileSystem = { readFileSync(path: URL, encoding: "utf8"): string };
/** A stylesheet as written (Vitest hands CSS imports to the page empty). */
async function css(name: string): Promise<string> {
  const nodeFs = "node:fs";
  const fs = (await import(/* @vite-ignore */ nodeFs)) as FileSystem;
  return fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const fakeRoot = () => ({ dataset: {} as Record<string, string | undefined> }) as unknown as HTMLElement;
const scaleAt = (address: string) => {
  const url = new URL(address, "https://edupath.local");
  const root = fakeRoot();
  syncPageScale(url.pathname, url.search, root);
  return root.dataset.epScale ?? null;
};

describe("page scale (user 2026-11-10: landing 100%, login 80%, student portal 90%, policy and FAQ content 80%, admin unchanged)", () => {
  it("marks each page by the address that opens it", () => {
    const expected: Record<string, PageScale | null> = {
      "/quantri": "admin", "/quantri/": "admin", "/quantri/tong-quan": "admin", "/quantri/quan-ly-sinh-vien": "admin",
      // Không tìm thấy trang under /quantri belongs to the admin portal.
      "/quantri/khong-co-trang-nay": "admin",
      "/login": "login", "/login?returnTo=%2Fquantri": "login", "/?authError=microsoft_denied": "login",
      "/dashboard": "student", "/dashboard?sv=00000000-0000-4000-8000-000000000001": "student", "/auth/callback": "student",
      "/chinh-sach-va-dieu-khoan": "info", "/chinh-sach-bao-mat": "info", "/dieu-khoan-su-dung": "info", "/cau-hoi-thuong-gap": "info",
      "/": null, "/index.html": null, "/khong-co": null, "/quantrivien": null,
    };
    for (const [address, scale] of Object.entries(expected)) expect(scaleAt(address), address).toBe(scale);
  });

  it("changes or takes away the mark", () => {
    const root = fakeRoot();
    setPageScale("login", root);
    setPageScale("student", root);
    expect(root.dataset.epScale).toBe("student");
    setPageScale(null, root);
    expect(root.dataset.epScale).toBeUndefined();
  });

  it("draws each scale from 1200px: 80% for the admin portal and Đăng nhập, 90% for the student portal, the text a little larger", async () => {
    const styles = await css("styles.css");
    const desktop = styles.slice(styles.indexOf("@media (min-width: 1200px)"));
    const block = desktop.slice(0, desktop.indexOf("\n}\n"));
    expect(block).toMatch(/:root\[data-ep-scale="admin"\],\s*:root\[data-ep-scale="login"\]\s*\{\s*--ep-zoom:\s*\.8;\s*--ep-vh:\s*calc\(1dvh \/ \.8\);\s*--ep-vw:\s*calc\(1vw \/ \.8\);\s*--ep-text-adjust:\s*0\.57;\s*--ep-serif-adjust:\s*0\.48;\s*\}/);
    expect(block).toMatch(/:root\[data-ep-scale="student"\]\s*\{\s*--ep-zoom:\s*\.9;\s*--ep-vh:\s*calc\(1dvh \/ \.9\);\s*--ep-vw:\s*calc\(1vw \/ \.9\);\s*--ep-text-adjust:\s*0\.57;\s*--ep-serif-adjust:\s*0\.48;\s*\}/);
    expect(block).toMatch(/:root:is\(\[data-ep-scale="admin"\], \[data-ep-scale="login"\], \[data-ep-scale="student"\]\) body\s*\{\s*zoom:\s*var\(--ep-zoom\);\s*\}/);
    // Outside the desktop widths every page keeps its natural size.
    const before = styles.slice(0, styles.indexOf("@media (min-width: 1200px)"));
    expect([...before.matchAll(/--ep-zoom:\s*([^;]+);/g)].map((match) => match[1])).toEqual(["1"]);
    expect(before).toMatch(/--ep-text-adjust:\s*none;/);
  });

  it("zooms only the content of Chính sách & Điều khoản and Câu hỏi thường gặp, so their header and footer stay as large as the landing page's", async () => {
    const styles = await css("styles.css");
    const rule = styles.match(/:root\[data-ep-scale="info"\] \.pi-page > main\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const declaration of ["--ep-zoom: .8;", "--ep-vh: calc(1dvh / .8);", "--ep-vw: calc(1vw / .8);", "--ep-text-adjust: 0.57;", "--ep-serif-adjust: 0.48;",
      "zoom: var(--ep-zoom);", "font-size-adjust: var(--ep-text-adjust);"]) expect(rule).toContain(declaration);
    expect(styles).not.toMatch(/data-ep-scale="info"\][^{]*(body|header|footer)/);
    // Anchors of the policy clear the 92px header, which the zoom of the content does not shrink.
    expect(await css("public-information.css")).toContain("scroll-margin-top: calc(124px / var(--ep-zoom));");
  });
});

describe("layoutZoom", () => {
  it("reads the painted zoom, 1 where there is none", () => {
    expect(layoutZoom({ currentCSSZoom: 0.8 } as unknown as Element)).toBe(0.8);
    expect(layoutZoom({ currentCSSZoom: 0.9 } as unknown as Element)).toBe(0.9);
    expect(layoutZoom({ currentCSSZoom: 1 } as unknown as Element)).toBe(1);
    expect(layoutZoom({} as Element)).toBe(1);
    expect(layoutZoom({ currentCSSZoom: 0 } as unknown as Element)).toBe(1);
  });

  it("gives heights back in the stylesheet's px", () => {
    const admin = { currentCSSZoom: 0.8, getBoundingClientRect: () => ({ height: 73.6 }) } as unknown as Element;
    expect(layoutHeight(admin)).toBeCloseTo(92);
    const student = { currentCSSZoom: 0.9, getBoundingClientRect: () => ({ height: 82.8 }) } as unknown as Element;
    expect(layoutHeight(student)).toBeCloseTo(92);
    const landing = { currentCSSZoom: 1, getBoundingClientRect: () => ({ height: 92 }) } as unknown as Element;
    expect(layoutHeight(landing)).toBe(92);
  });
});
