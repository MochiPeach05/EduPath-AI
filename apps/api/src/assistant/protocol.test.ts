import { describe, expect, it } from "vitest";
import { standaloneQuestion } from "./protocol.js";

describe("standalone question of a rewrite", () => {
  it("takes the first line without its label or quotes", () => {
    expect(standaloneQuestion('Câu hỏi viết lại: "Mình nên học Kiểm thử phần mềm hay Hệ quản trị CSDL trước?"\nVì bạn hỏi…'))
      .toBe("Mình nên học Kiểm thử phần mềm hay Hệ quản trị CSDL trước?");
    expect(standaloneQuestion("  \r\n  Kubernetes tự học ở đâu?  ")).toBe("Kubernetes tự học ở đâu?");
  });

  it("refuses nothing, a word, a page of text or a data block, so the server searches with its own text", () => {
    expect(standaloneQuestion(null)).toBeNull();
    expect(standaloneQuestion(" \n ")).toBeNull();
    expect(standaloneQuestion("ok")).toBeNull();
    expect(standaloneQuestion("x".repeat(501))).toBeNull();
    expect(standaloneQuestion("=== BẮT ĐẦU DỮ LIỆU ===")).toBeNull();
  });
});
