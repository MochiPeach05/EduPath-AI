// What a question to Trợ lý AI asks about (STU-CHAT-01..05), read from its words. The server picks the student's own
// data for the prompt from it: a small model calls tools unreliably, so it never chooses them itself. Several intents can
// match; none means a general question (STU-CHAT-03), still answered with the student's core results.
import { fold } from "../competency-assessment/specialty.js";

export type AssistantIntent = "gaps" | "roadmap" | "course_reason" | "graduation" | "resources";

/** Patterns over the folded question (no diacritics, lower case). */
const PATTERNS: readonly (readonly [AssistantIntent, RegExp])[] = [
  ["gaps", /\b(thieu|khoang trong|chua dat|duoi nguong|diem yeu|yeu (o|ve|nhat)|nang luc|ky nang|phu hop|nghe muc tieu|danh gia|muc do|diem manh|gioi (o|ve|nhat))\b/],
  ["roadmap", /\b(lo trinh|hoc ky (toi|sau|tiep|nay)|ky (toi|sau|nay)|nam (toi|sau)|nen hoc|hoc (gi|mon gi|mon nao|nhung mon)|dang ky|ke hoach|tien do|hoc lai|hoc cai thien|cai thien|tre han|no mon|rot mon)\b/],
  ["course_reason", /\b(tai sao|vi sao|ly do|de xuat|goi y mon|sao lai|co can (hoc|thiet))\b/],
  ["graduation", /\b(tot nghiep|ra truong|khoa luan|do an tot nghiep|chuyen de tot nghiep|tin chi|diem trung binh|gpa|chuan dau ra)\b/],
  ["resources", /\b(tai lieu|tu hoc|khoa hoc (online|truc tuyen|mien phi|tren mang)|nguon hoc|hoc o dau|link|youtube|(?<!danh )sach|website|trang web|tai nguyen|chung chi|bai tap|luyen tap|hoc them)\b/],
];

export function detectIntents(question: string): AssistantIntent[] {
  const text = fold(question);
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([intent]) => intent);
}

const FOLLOW_UP_START = /^(con|vay|the|thi|nhung|neu vay|sao|tai sao|vi sao|mon do|mon nay|cai do|cai nay|no|ky nang do|ky nang nay|nghe do)\b/;

/**
 * A short or pronoun-led question ("còn môn kia thì sao?", "vì sao vậy?") is searched together with the previous
 * question of the conversation, so retrieval finds what it refers to.
 */
export function isFollowUp(question: string): boolean {
  const text = fold(question).replace(/[^a-z0-9 ]+/g, " ").trim();
  return text.split(/\s+/).filter(Boolean).length <= 5 || FOLLOW_UP_START.test(text);
}
