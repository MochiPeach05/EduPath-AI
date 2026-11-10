// The student's own CTĐT and KHĐT (user 2026-11-10: "Không cho sinh viên chọn Khung chương trình đào tạo và CTĐT như vậy
// nó sẽ cố định theo thông tin của sinh viên luôn như trang xét tốt nghiệp vậy"). The API picks them from the cohort in the
// account and the major of the MSSV, as the competency engine, Lộ trình học tập and Xét tốt nghiệp do
// (apps/api/src/curricula/own-program.ts); the pages Chương trình đào tạo and Kế hoạch đào tạo offer no other and say
// which one they show, or why there is none, in the words of Xét tốt nghiệp.
import { majorOptions } from "./majors";
import { Icon } from "./student-icons";

/** API OwnProgramResolution: absent from a server before 2026-11-10 (then the list alone tells). */
export type OwnProgramResolution = "found" | "not_found" | "ambiguous" | "cohort_unknown";

/** What GET /api/student/curricula and /api/student/plans say besides the student's own item. */
export type OwnProgramFacts = {
  profileCohort: string | null;
  /** The major code of the MSSV ("7480201"), null without one. */
  profileMajor?: string | null;
  resolution?: OwnProgramResolution;
};

/** The student's own item of the list: the one the API names (suggestedId), never another one. */
export function ownItem<T extends { id: string }>(list: { items: readonly T[]; suggestedId: string | null } | null | undefined): T | null {
  if (!list?.suggestedId) return null;
  return list.items.find((item) => item.id === list.suggestedId) ?? null;
}

export type OwnProgramKind = "curriculum" | "plan";
const NOUN: Record<OwnProgramKind, string> = { curriculum: "chương trình đào tạo", plan: "kế hoạch đào tạo" };
/** The text with its first letter in capital ("khóa K29, …" → "Khóa K29, …"). */
export const upperFirst = (text: string) => text.charAt(0).toLocaleUpperCase("vi-VN") + text.slice(1);

/** "Công nghệ thông tin" for 7480201, null without a major or for a programme the Faculty does not teach. */
const majorName = (facts: OwnProgramFacts) => {
  const code = facts.profileMajor?.trim();
  return code ? majorOptions.find((option) => option.code === code)?.name ?? null : null;
};

/** "khóa K29, ngành Công nghệ thông tin"; "khóa K29" without a major; a programme the Faculty does not teach by its code. */
export function ownScope(facts: OwnProgramFacts): string {
  const code = facts.profileMajor?.trim();
  const name = majorName(facts);
  return [`khóa ${facts.profileCohort ?? "của bạn"}`, name ? `ngành ${name}` : code ? `mã ngành ${code}` : null].filter(Boolean).join(", ");
}

/** "Chương trình đào tạo của khóa K29, ngành Công nghệ thông tin theo hồ sơ của bạn." */
export const ownProgramLine = (kind: OwnProgramKind, facts: OwnProgramFacts) =>
  `${upperFirst(NOUN[kind])} của ${ownScope(facts)} theo hồ sơ của bạn.`;

/** The line under the title of the student's own CTĐT or KHĐT, with the way to check the profile it was picked from. */
export function OwnProgramNote({ kind, facts }: { kind: OwnProgramKind; facts: OwnProgramFacts }) {
  return <p className="sc-own-note">
    <Icon name="info" />
    <span>{ownProgramLine(kind, facts)} <a className="sp-link" href="#profile">Xem hồ sơ</a></span>
  </p>;
}

type MissingCopy = { title: string; text: string; action: boolean };

/** Why no CTĐT or KHĐT can be shown (another cohort's or major's never is), as Xét tốt nghiệp words a missing standard. */
export function missingProgramCopy(kind: OwnProgramKind, facts: OwnProgramFacts): MissingCopy {
  const noun = NOUN[kind], scope = ownScope(facts);
  switch (facts.resolution) {
    case "cohort_unknown":
      return {
        title: "Hồ sơ chưa có khóa học",
        text: `${upperFirst(noun)} được chọn theo khóa trong tài khoản và ngành trong hồ sơ của bạn. Thông tin khóa được đồng bộ từ tài khoản trường; nếu mục Khóa học trong hồ sơ còn trống, hãy liên hệ Khoa để được cập nhật.`,
        action: true,
      };
    case "ambiguous":
      // Only a profile without a major meets several: the cohort has a CTĐT or KHĐT per major.
      return facts.profileMajor?.trim()
        ? {
          title: `Có nhiều ${noun} cùng phù hợp với bạn`,
          text: `${upperFirst(scope)} đang có hơn một ${noun} nên hệ thống chưa chọn được bản đúng. Khoa sẽ rà soát lại; bạn chưa cần làm gì thêm.`,
          action: false,
        }
        : {
          title: "Hồ sơ chưa có ngành học",
          text: `Khóa ${facts.profileCohort ?? "của bạn"} có ${noun} của nhiều ngành. Ngành học được lấy từ mã số sinh viên trong hồ sơ; hãy kiểm tra mã số sinh viên hoặc liên hệ Khoa để được cập nhật.`,
          action: true,
        };
    default:
      return {
        title: `Chưa có ${noun} cho ${scope}`,
        text: `Khoa chưa công bố ${noun} của ${scope}. Hãy quay lại sau; nếu khóa hoặc ngành trong hồ sơ chưa đúng, hãy liên hệ Khoa để được cập nhật.`,
        action: true,
      };
  }
}

/** The card in place of the student's own CTĐT or KHĐT when there is none, with the profile facts it was picked by. */
export function MissingProgram({ kind, facts }: { kind: OwnProgramKind; facts: OwnProgramFacts }) {
  const copy = missingProgramCopy(kind, facts);
  const major = majorName(facts) ?? (facts.profileMajor?.trim() ? `Mã ngành ${facts.profileMajor.trim()}` : "Chưa có");
  return <section className="sw-panel sc-own-missing" aria-labelledby="sc-own-missing-title">
    <div className="sc-own-heading">
      <p className="sc-eyebrow">{upperFirst(NOUN[kind])} của bạn</p>
      <h2 id="sc-own-missing-title">{copy.title}</h2>
      <ul className="sc-own-tags">
        <li><span>Khóa trong tài khoản:</span> <strong>{facts.profileCohort ?? "Chưa có"}</strong></li>
        <li><span>Ngành trong hồ sơ:</span> <strong>{major}</strong></li>
      </ul>
    </div>
    <div className="sc-unresolved">
      <p>{copy.text}</p>
      {copy.action && <a className="sw-outline" href="#profile">Xem hồ sơ</a>}
    </div>
  </section>;
}
