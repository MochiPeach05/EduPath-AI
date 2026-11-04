// Mã lớp (QA review 2026-11-04): the one form a class is matched, grouped and filtered in, as a TypeScript function
// (classCode: imports, forms, filters) and as the same rule in SQL (classCodeSql: students), built from the same patterns.
//
// Two forms met. The Khoa writes a class in full, as the university does (its advisor workbook, MÃ LỚP): the program
// prefix, K and the cohort, the class: 71K29CNTT08. The prefix is not always 71: the same file has 72K27CNTT01…
// 72K32CNTT01 and 74K31CNTT01, classes of other programs of those cohorts. A student's profile keeps neither: the sign-in
// reads "2374802010994 - Họ Tên - 71K29CNTT08" into class CNTT08 and cohort K29 (migrations 005, 044, 045; K26 names
// "… - K26T-IT11" give IT11 and K26). Compared as written, no profile class ever met an advisor's class, and classes of
// two cohorts with the same name were counted as one.
//
// The rule, upper case without spaces:
//  - a code that starts with digits, K and two digits (71K29CNTT08) is kept as it is;
//  - a class of letters and digits (CNTT08) with a cohort (K29) becomes prefix + cohort + class (71K29CNTT08), and a class
//    written with its cohort but no prefix (K29CNTT08) gets the prefix. The prefix is the one the student's Microsoft
//    display name writes before that same class ("… - 72K29CNTT01" → 72K29CNTT01), else 71: the Khoa's regular classes,
//    whose course codes start with 71 too (71IT…);
//  - anything else, and a class without a cohort, stays as it is.
// Nothing stored is rewritten: the profile keeps its class and the student pages show it as before.

/** The prefix of the Khoa's classes when nothing says otherwise (71K29CNTT08; the course codes are 71IT…). */
export const CLASS_PREFIX = "71";

// The shapes, as patterns JavaScript and PostgreSQL read the same way (ASCII classes, \s, a non-capturing group).
const FULL = "^[0-9]+K[0-9]{2}";
const NO_PREFIX = "^K[0-9]{2,3}[A-Z]+[0-9]+$";
const SHORT = "^[A-Z]+[0-9]+$";
const COHORT = "^K[0-9]{2,3}$";
// The class at the end of a display name ("2374802010994 - Họ Tên - 72K29CNTT01", upper case): its prefix, and the rest.
const NAME_PREFIX = "(?:^|[^0-9])([0-9]+)K[0-9]{2,3}[A-Z]+[0-9]+\\s*$";
const NAME_CLASS = "(?:^|[^0-9])[0-9]+(K[0-9]{2,3}[A-Z]+[0-9]+)\\s*$";

const matches = (pattern: string, value: string) => new RegExp(pattern).test(value);

/** "71k29 cntt01 " → "71K29CNTT01": upper case, no spaces (also a cohort: " k29" → "K29"). */
export const normalizeClassName = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** The prefix the display name writes before this class without its prefix ("K29CNTT01"), else CLASS_PREFIX. */
function prefixFor(displayName: string | null | undefined, rest: string): string {
  const name = (displayName ?? "").toUpperCase();
  if (new RegExp(NAME_CLASS).exec(name)?.[1] !== rest) return CLASS_PREFIX;
  return new RegExp(NAME_PREFIX).exec(name)?.[1] ?? CLASS_PREFIX;
}

/**
 * The canonical code of a class (see above): classCode("CNTT08", "K29") → "71K29CNTT08", classCode("CNTT01", "K29",
 * "… - 72K29CNTT01") → "72K29CNTT01", classCode("71k29cntt08") → "71K29CNTT08", classCode("CNTT08") → "CNTT08".
 */
export function classCode(className: string | null | undefined, cohort?: string | null, displayName?: string | null): string {
  const name = normalizeClassName(className ?? "");
  if (!name || matches(FULL, name)) return name;
  if (matches(NO_PREFIX, name)) return prefixFor(displayName, name) + name;
  const k = normalizeClassName(cohort ?? "");
  if (matches(SHORT, name) && matches(COHORT, k)) return prefixFor(displayName, k + name) + k + name;
  return name;
}

/** A class still written without its cohort (CNTT08): it matches no student's class, so a list must name the cohort. */
export const needsCohort = (code: string) => matches(SHORT, code);

/** "K29" from a Khóa cell ("K29", "k 29", "29", "Khóa 29"); null when the cell is no cohort. */
export function cohortCode(text: string | null | undefined): string | null {
  const folded = normalizeClassName(text ?? "").normalize("NFD").replace(/\p{M}/gu, "");
  const digits = /^(?:KHOA)?K?(\d{2,3})$/.exec(folded)?.[1];
  return digits ? `K${digits}` : null;
}

/**
 * classCode in SQL for a student: p names student_profiles (class_name, cohort_code), u names users (display_name).
 * NULL when the profile has no class (classCode: ""); a NULL cohort or display name fails its test, as "" does.
 */
export function classCodeSql(p = "p", u = "u"): string {
  const name = `upper(regexp_replace(${p}.class_name, '\\s', '', 'g'))`;
  const cohort = `upper(regexp_replace(${p}.cohort_code, '\\s', '', 'g'))`;
  const display = `upper(${u}.display_name)`;
  const prefix = (rest: string) => `(CASE WHEN substring(${display} FROM '${NAME_CLASS}') = (${rest})
      THEN COALESCE(substring(${display} FROM '${NAME_PREFIX}'), '${CLASS_PREFIX}') ELSE '${CLASS_PREFIX}' END)`;
  return `(CASE WHEN ${name} ~ '${FULL}' THEN ${name}
    WHEN ${name} ~ '${NO_PREFIX}' THEN ${prefix(name)} || ${name}
    WHEN ${name} ~ '${SHORT}' AND ${cohort} ~ '${COHORT}' THEN ${prefix(`${cohort} || ${name}`)} || ${cohort} || ${name}
    ELSE NULLIF(${name}, '') END)`;
}

/** A student's class in its canonical form, for SQL over p = student_profiles and u = users. */
export const CLASS_OF = classCodeSql("p", "u");
