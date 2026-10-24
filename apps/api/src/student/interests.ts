import { z } from "zod";

// "Sở thích" of the profile as choices (user 2026-10-24: "làm dạng các công nghệ, sở thích khi rảnh ... để tránh việc sv
// bỏ trống hoặc nhập bừa"): 1 to 5 technologies the student likes and 1 to 5 things they do in free time (migration 049).
// The labels live in the web (apps/web/src/profile-interests.ts); interests.test.ts keeps both lists the same.

export const INTEREST_MAX = 5;
export const INTEREST_TECH_IDS = [
  "web_frontend", "web_backend", "mobile", "python_data", "ai_ml", "database", "cloud_devops", "security", "networking", "game",
  "embedded_iot", "uiux", "testing", "blockchain",
] as const;
export const INTEREST_HOBBY_IDS = [
  "side_projects", "reading", "online_courses", "coding_contests", "gaming", "sports", "music", "art_design", "content",
  "clubs_volunteer", "travel", "languages",
] as const;

const choices = <T extends readonly [string, ...string[]]>(ids: T) =>
  z.array(z.enum(ids)).min(1).max(INTEREST_MAX).refine((list) => new Set(list).size === list.length);

/** PATCH /api/student/profile fields: both lists together, or neither. */
export const interestFields = {
  interestTech: choices(INTEREST_TECH_IDS).optional(),
  interestHobbies: choices(INTEREST_HOBBY_IDS).optional(),
};
export const bothOrNeither = (input: { interestTech?: unknown; interestHobbies?: unknown }) =>
  (input.interestTech === undefined) === (input.interestHobbies === undefined);
