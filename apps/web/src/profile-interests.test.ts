import { describe, expect, it } from "vitest";
import { INTEREST_HOBBIES, INTEREST_MAX, INTEREST_TECH, hasInterests, interestLabels, interestProblem, toggleInterest } from "./profile-interests";

describe("profile interests", () => {
  it("adds and removes a choice, never past the limit", () => {
    expect(toggleInterest([], "ai_ml")).toEqual(["ai_ml"]);
    expect(toggleInterest(["ai_ml", "game"], "ai_ml")).toEqual(["game"]);
    const full = INTEREST_TECH.slice(0, INTEREST_MAX).map((option) => option.id);
    expect(toggleInterest(full, "blockchain")).toEqual(full);
  });

  it("names the choices in list order and asks for at least one of each list", () => {
    expect(interestLabels(INTEREST_TECH, ["uiux", "ai_ml", "unknown"])).toEqual(["Trí tuệ nhân tạo, học máy", "Thiết kế UI/UX"]);
    expect(interestLabels(INTEREST_HOBBIES, null)).toEqual([]);
    expect(interestProblem("tech", [])).toBe("Vui lòng chọn ít nhất một công nghệ bạn thích.");
    expect(interestProblem("hobbies", [])).toBe("Vui lòng chọn ít nhất một sở thích khi rảnh.");
    expect(interestProblem("tech", ["ai_ml"])).toBe("");
    expect(hasInterests({ interestTech: ["ai_ml"], interestHobbies: [] })).toBe(false);
    expect(hasInterests({ interestTech: ["ai_ml"], interestHobbies: ["reading"] })).toBe(true);
    expect(hasInterests(null)).toBe(false);
  });
});
