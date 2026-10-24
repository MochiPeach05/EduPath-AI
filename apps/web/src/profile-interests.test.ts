import { describe, expect, it } from "vitest";
import { interestLabels, interestProblem, toggleInterest } from "./profile-interests";

const options = [{ id: "web_frontend", label: "Web front-end" }, { id: "ai_ml", label: "Trí tuệ nhân tạo, học máy" }, { id: "uiux", label: "Thiết kế UI/UX" }];

describe("survey interest lists", () => {
  it("adds and removes a choice, never past the limit", () => {
    expect(toggleInterest([], "ai_ml", 5)).toEqual(["ai_ml"]);
    expect(toggleInterest(["ai_ml", "game"], "ai_ml", 5)).toEqual(["game"]);
    expect(toggleInterest(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });

  it("names the choices in list order and asks for at least one of each list", () => {
    expect(interestLabels(options, ["uiux", "ai_ml", "unknown"])).toEqual(["Trí tuệ nhân tạo, học máy", "Thiết kế UI/UX"]);
    expect(interestLabels(options, null)).toEqual([]);
    expect(interestProblem("tech", [])).toBe("Vui lòng chọn ít nhất một công nghệ bạn thành thạo.");
    expect(interestProblem("hobbies", [])).toBe("Vui lòng chọn ít nhất một sở trường.");
    expect(interestProblem("tech", ["ai_ml"])).toBe("");
  });
});
