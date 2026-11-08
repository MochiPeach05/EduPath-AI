import { describe, expect, it } from "vitest";
import { modelLabel, modelPlace } from "./ai-model";

describe("the model that wrote an AI output and where it ran (2026-11-08)", () => {
  it("names the PC's Gemma and Cloudflare's alike, and says where each ran", () => {
    expect(modelLabel("gemma4:e4b")).toBe("Gemma 4 E4B");
    expect(modelLabel("@cf/google/gemma-4-26b-a4b-it")).toBe("Gemma 4 26B");
    expect(modelLabel(null)).toBe("Gemma 4 E4B");
    expect(modelPlace("gemma4:e4b")).toBe("chạy cục bộ");
    expect(modelPlace(null)).toBe("chạy cục bộ");
    expect(modelPlace("@cf/google/gemma-4-26b-a4b-it")).toBe("chạy trên Cloudflare Workers AI");
  });
});
