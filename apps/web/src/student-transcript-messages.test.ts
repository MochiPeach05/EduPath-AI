import { describe, expect, it } from "vitest";
import { failedImportMessage } from "./StudentTranscript";

describe("failed transcript imports", () => {
  it("say once that the previous transcript is kept", () => {
    for (const code of ["invalid_ocr_result", "unreadable_rows", "unreadable_grades", "ocr_failed", "unknown_code", null]) {
      expect({ code, kept: failedImportMessage(code).match(/giữ nguyên/g)?.length }).toEqual({ code, kept: 1 });
    }
  });
});
