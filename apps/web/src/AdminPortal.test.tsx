import { describe, expect, it } from "vitest";
import { withoutAuthError } from "./AdminPortal";

describe("the address once the admin portal has signed the account in (2026-11-23)", () => {
  it("drops only the sign-in error and keeps the page's own parameters", () => {
    expect(withoutAuthError("?authError=callback_failed")).toBe("");
    expect(withoutAuthError("?authError=admin_required&cohort=K29")).toBe("?cohort=K29");
    // A report's filters, a "Xem hồ sơ" link opened in a new tab and the email test's outcome survive a full page load.
    expect(withoutAuthError("?cohort=K29&major=7480201")).toBe("?cohort=K29&major=7480201");
    expect(withoutAuthError("?id=00000000-0000-4000-8000-000000000010")).toBe("?id=00000000-0000-4000-8000-000000000010");
    expect(withoutAuthError("?emailTest=denied&code=AADSTS65004")).toBe("?emailTest=denied&code=AADSTS65004");
    expect(withoutAuthError("")).toBe("");
  });
});
