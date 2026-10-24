import { fold } from "../careers/shared.js";
import { INTEREST_TECH } from "../student/interests.js";
import { SURVEY_QUESTIONS } from "../student/survey.js";

// Which careers of the catalog match what the student answered in Khảo sát định hướng (the field of interest and the
// technologies they like). The catalog is managed by the faculty, so careers are matched by their names and field, read
// without diacritics; a career no rule recognizes simply has no match. Shown to the student only, never sent to the AI.

type CareerText = { nameVi: string; nameEn: string; categoryName: string | null };

const DATA_NAMES = /tri tue nhan tao|hoc may|machine learning|thi giac may tinh|computer vision|data scientist|data analyst|data engineer|phan tich du lieu|khoa hoc du lieu|ky su du lieu|\bai engineer/;
const SECURITY_NAMES = /bao mat|an ninh|security|xam nhap|penetration/;

/** survey `field` answer → careers it points to. */
const FIELD_RULES: Record<string, (name: string, category: string) => boolean> = {
  web: (name) => /\bweb\b|frontend|front-end|backend|back-end|full-stack|fullstack|may chu|\bjava\b|\bseo\b|thuong mai dien tu/.test(name),
  mobile: (name) => /mobile|di dong/.test(name),
  data: (name, category) => /du lieu|tri tue nhan tao/.test(category) || DATA_NAMES.test(name) || /co so du lieu|database/.test(name),
  security: (name, category) => /an ninh mang|an toan thong tin/.test(category) || SECURITY_NAMES.test(name),
  cloud: (name) => /cloud|dam may|devops|ky su mang|network engineer/.test(name),
  game: (name) => /\bgame\b/.test(name),
  embedded: (name) => /\biot\b|nhung|embedded/.test(name),
};

/** Technology the student likes (interests.ts id) → careers that work with it. */
const TECH_RULES: Record<string, RegExp> = {
  web_frontend: /frontend|front-end|giao dien web|full-stack|fullstack/,
  web_backend: /backend|back-end|may chu|full-stack|fullstack|\bjava\b|software engineer|ky su phan mem/,
  mobile: /mobile|di dong/,
  python_data: DATA_NAMES,
  ai_ml: /tri tue nhan tao|hoc may|machine learning|thi giac may tinh|computer vision|data scientist|khoa hoc du lieu|\bai engineer/,
  database: /co so du lieu|database|data engineer|ky su du lieu/,
  cloud_devops: /cloud|dam may|devops/,
  security: SECURITY_NAMES,
  networking: /ky su mang|network/,
  game: /\bgame\b/,
  embedded_iot: /\biot\b|nhung|embedded/,
  uiux: /\bux\b|ui designer|thiet ke trai nghiem|giao dien/,
  testing: /kiem thu phan mem|\bqa\b|test engineer/,
  blockchain: /blockchain/,
};

export type InterestMatch = {
  /** The label of the field of interest when the career belongs to it ("AI, dữ liệu"). */
  field: string | null;
  /** The labels of the liked technologies the career works with. */
  tech: string[];
};

const FIELD_OPTIONS = SURVEY_QUESTIONS.find((question) => question.id === "field")!.options;

export function interestMatch(career: CareerText, survey: { field: string | null; tech: readonly string[] }): InterestMatch {
  const name = fold(`${career.nameVi} ${career.nameEn}`);
  const category = fold(career.categoryName ?? "");
  const fieldRule = survey.field ? FIELD_RULES[survey.field] : undefined;
  return {
    field: fieldRule?.(name, category) ? FIELD_OPTIONS.find((option) => option.id === survey.field)?.label ?? null : null,
    tech: INTEREST_TECH.filter((option) => survey.tech.includes(option.id) && TECH_RULES[option.id]?.test(name)).map((option) => option.label),
  };
}
