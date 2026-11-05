import type { PlanData } from "../plans/model.js";
import { courseKey, electiveCodeOf } from "./course-state.js";
import type { ElectiveQuota } from "./graduation.js";
import { fold } from "./specialty.js";
import type { CourseState, LateEntry, NextEntry, PlanCourseRef, PlanProgressResult } from "./types.js";

type PlanItem = PlanData["items"][number];
type PlanSection = PlanData["sections"][number];

/** What progress needs to know about one curriculum course. */
export type PlanCourseInfo = {
  code: string;
  name: string;
  credits: number;
  state: CourseState;
  /** In the applicable set A (common, own specialty, or already attempted). */
  applicable: boolean;
  electiveCode: string | null;
  /** A condition-only course (GDTC/GDQP, the engine's conditionCodes): still listed, counted in no credit total (comp-calc-v19). */
  conditionOnly?: boolean;
};

/** The key of physicalEducationGroups holding the courses named for one GDTC slot ("GDTC1", "GDTC2"). */
const namedSlotKey = (slot: number) => `GDTC${slot}`;

/**
 * Same object plans/student-router.ts returns: PE elective codes per group (TC002, TC102). Courses named for a slot
 * ("Giáo dục thể chất (1)", K26–K28 DGT0010/DGT0020 of type BBKTL, outside TC002/TC102) are added under GDTC1/GDTC2 when there
 * are any (comp-calc-v17): before, a K26 student who passed DGT0010 read "Giáo dục thể chất 1 — Đã đạt 0/1" as late.
 */
export function physicalEducationGroupsFor(courses: readonly { code: string; type: string; name?: string }[]): Record<string, string[]> {
  const groups: Record<string, string[]> = Object.fromEntries(["TC002", "TC102"].map((group) => [group,
    [...new Set(courses.filter((course) => electiveCodeOf(course.type) === group).map((course) => courseKey(course.code)))]]));
  for (const slot of [1, 2]) {
    const codes = [...new Set(courses.filter((course) => physicalEducationCourseSlot(course.name ?? "") === slot).map((course) => courseKey(course.code)))];
    if (codes.length) groups[namedSlotKey(slot)] = codes;
  }
  return groups;
}

/** "GDTC 1", "GDTC2", "Giáo dục thể chất 1" → slot number (port of student-plan-results.ts). */
export function physicalEducationSlot(name: string): number | null {
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const slot = /^(?:GDTC|GIAO DUC THE CHAT)\s*([12])$/.exec(folded);
  return slot ? Number(slot[1]) : null;
}

/** A CTĐT course named for a GDTC slot: "Giáo dục thể chất (1)", "Giáo dục thể chất 2 (*)", "GDTC 1" → 1 or 2; else null. */
export function physicalEducationCourseSlot(name: string): number | null {
  const slot = /^(?:gdtc|giao duc the chat)\s*\(?\s*([12])(?!\d)/.exec(fold(name));
  return slot ? Number(slot[1]) : null;
}

/**
 * A plan choice label as the student reads it (comp-calc-v17): spaces normalised ("Chọn1 trong 3 môn sau" → "Chọn 1 trong 3
 * môn sau") and, when the label's "trong n" is not the number of options the student really has (a course of another
 * specialty, one outside the CTĐT, or a typo: "Chọn 1 trong 4 môn sau" over 3 courses), "Chọn k trong n" rebuilt from them.
 */
export function choiceLabel(label: string, required?: number, optionCount?: number): string {
  let text = label.normalize("NFC").replace(/\s+/g, " ").trim()
    .replace(/(ch[oọ]n)\s*(\d+)/iu, "$1 $2").replace(/(\d+)\s*(trong)(?![\p{L}])/iu, "$1 $2").replace(/(trong)\s*(\d+)/iu, "$1 $2");
  const rule = /(ch[oọ]n )(\d+)( trong )(\d+)/iu.exec(text);
  if (rule && optionCount && optionCount > 0 && Number(rule[4]) !== optionCount) {
    const k = Math.min(required ?? Number(rule[2]), optionCount);
    text = text.replace(rule[0], `${rule[1]}${k}${rule[3]}${optionCount}`);
  }
  return text;
}

type ChoiceRule = {
  /** k in "Chọn k trong n", or null. */
  k: number | null;
  /** n in "trong n", or null. */
  stated: number | null;
  /** A choice-like section that is never late: no k, or "(Không tính vào tích lũy)". */
  informational: boolean;
  /** The label describes a choice at all ("Chọn …"). */
  choice: boolean;
};

/** Reads k from the folded label with /ch[oọ]n\s*(\d+)/ ("Chọn1 trong 3", "Chọn 2 trong 4 HP tự chọn Chuyên ngành"). */
export function choiceRule(label: string): ChoiceRule {
  const folded = fold(label);
  const k = /ch[oọ]n\s*(\d+)/i.exec(folded)?.[1];
  const stated = /trong\s*(\d+)/i.exec(folded)?.[1];
  const choice = /(?:^|[^a-z])chon/.test(folded);
  return {
    k: k ? Number(k) : null,
    stated: stated ? Number(stated) : null,
    choice,
    informational: choice && (!k || Number(k) < 1 || folded.includes("khong tinh vao tich luy")),
  };
}

const done = (state: CourseState) => state === "passed" || state === "exempt";
/** Registered, or graded with an unreadable result: never reported as late. */
const ongoing = (state: CourseState) => state === "in_progress" || state === "graded_unknown";
/** An option still to choose: neither passed nor under way (a failed one can be taken again or replaced). */
const openOption = (option: { state: CourseState }) => !done(option.state) && !ongoing(option.state);
const ref = (course: PlanCourseInfo): PlanCourseRef => ({ code: course.code, name: course.name, credits: course.credits, state: course.state });
const minCredits = (courses: readonly PlanCourseInfo[]) => courses.length ? Math.min(...courses.map((course) => course.credits)) : 0;
const maxCredits = (courses: readonly PlanCourseInfo[]) => courses.length ? Math.max(...courses.map((course) => course.credits)) : 0;
/** Condition-only entries (comp-calc-v19) carry the flag; the others leave it out, as results stored before do. */
const conditionFlag = (conditionOnly: boolean): { conditionOnly?: true } => (conditionOnly ? { conditionOnly: true } : {});

/**
 * The credits of the k courses still to choose of a "Chọn k trong n" choice (comp-calc-v19): the k cheapest options still open
 * (low, what "Trễ kế hoạch" and "học kỳ tới" count) and the k dearest (high). Every option counts when fewer than k are open
 * (the others filled another choice); before v19 it was k × the cheapest option, passed or not.
 */
export function choiceCreditRange(options: readonly { credits: number | null; state: CourseState }[], k: number): { low: number; high: number } {
  if (k <= 0 || !options.length) return { low: 0, high: 0 };
  const open = options.filter(openOption);
  const pool = (open.length >= k ? open : options).map((option) => (option.credits !== null && Number.isFinite(option.credits) && option.credits > 0 ? option.credits : 0))
    .sort((a, b) => a - b);
  if (pool.length < k) return { low: k * pool[0]!, high: k * pool.at(-1)! };
  const sum = (list: number[]) => list.reduce((total, credits) => total + credits, 0);
  return { low: sum(pool.slice(0, k)), high: sum(pool.slice(-k)) };
}

const numberText = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

/**
 * A choice's shortfall in the unit its requirement is written in: the one wording of every page, the AI comment and the
 * roadmap (comp-calc-v19; user review 2026-11-04: one elective group read "còn thiếu 1 TC" on Đánh giá năng lực and Lộ trình
 * AI and "còn thiếu 6 TC" on Tổng quan and Xét tốt nghiệp, a course count printed with the TC unit):
 * - an elective group of credits ("Nhóm tự chọn TC406: chọn 6 tín chỉ", the KHĐT's courses of a graduation group without a
 *   "Chọn k" section): the credits, "6 TC", the figure Xét tốt nghiệp prints for the group;
 * - a KHĐT choice "Chọn k trong n": the courses and their credits, "1 học phần (3 TC)", or "1 học phần (3–6 TC)" when the
 *   options still open differ in credits.
 * A credit choice reads `missingCredits`, so a result stored before v19 (whose `missing` was a course count) reads the same.
 */
export function shortfallText(entry: {
  unit: "course" | "credit"; missing: number; missingCredits: number; options?: readonly { credits: number | null; state: CourseState }[];
}): string {
  if (entry.unit === "credit") return `${numberText(entry.missingCredits)} TC`;
  const { low, high } = entry.options?.length ? choiceCreditRange(entry.options, entry.missing) : { low: entry.missingCredits, high: entry.missingCredits };
  if (high <= 0) return `${numberText(entry.missing)} học phần`;
  return `${numberText(entry.missing)} học phần (${low === high ? numberText(low) : `${numberText(low)}–${numberText(high)}`} TC)`;
}

type ChoiceSlot = {
  section: PlanSection;
  need: number;
  options: PlanCourseInfo[];
  electiveCodes: Set<string>;
  done: number;
  ongoing: number;
};

type QuotaGroup = {
  code: string;
  quota: number | null;
  items: { course: PlanCourseInfo; termCode: string }[];
  dueTerm: string;
  doneCredits: number;
  ongoingCredits: number;
};

/**
 * Progress against the training plan (spec §7.8):
 * - current term = the term being studied (studyTermCode: the term after the latest graded one with registrations
 *   without grades, else the latest graded term); an item is late when its term is BEFORE the current term and it is
 *   neither passed nor in progress (comp-calc-v19, user 2026-11-04); the open items of the current term are its plan
 *   (`current`), never late (v13–v18 counted them late);
 * - condition-only courses (GDTC/GDQP, PlanCourseInfo.conditionOnly, and every GDTC slot) stay listed with conditionOnly but
 *   count in no credit total: late, current, next (v19);
 * - a choice's `missing`/`remaining` is in its unit: courses for "Chọn k", credits for an elective group of credits (v19;
 *   a late credit choice's `missing` counted courses before);
 * - GDTC slots (DGT0010/DGT0020, "GDTC1") count passed PE electives; a slot with courses named for it ("Giáo dục thể chất
 *   (1)", K26–K28) is met by one of those (v17);
 * - "Chọn k …" sections need k courses; sections without k or "(Không tính vào tích lũy)" are never late; their labels are
 *   spaced and say the real number of options (choiceLabel, v17);
 * - each passed course is allocated to one choice section only, earliest first, then same-group substitutes;
 * - elective items outside choice sections (TC406) form one quota choice in credits;
 * - applicability comes from the curriculum (PlanCourseInfo.applicable), never from section labels;
 * - in-progress (and graded with an unknown result) is never late; items outside the curriculum are skipped except GDTC slots.
 */
export function planProgress(args: {
  plan: Pick<PlanData, "items" | "sections" | "terms">;
  physicalEducationGroups: Record<string, string[]>;
  currentTerm: string | null;
  courses: ReadonlyMap<string, PlanCourseInfo>;
  quotas: ReadonlyMap<string, ElectiveQuota>;
}): PlanProgressResult {
  const { currentTerm, courses } = args;
  // v19: late = planned before the term being studied; the term being studied's own open items are its plan, not late.
  const before = (term: string) => currentTerm !== null && term < currentTerm;
  const during = (term: string) => currentTerm !== null && term === currentTerm;
  const items = [...args.plan.items].sort((a, b) => (a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.position - b.position));
  const sections = [...args.plan.sections].sort((a, b) =>
    a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const rules = new Map(sections.map((section) => [section.id, choiceRule(section.label)]));

  const countMismatches: PlanProgressResult["countMismatches"] = [];
  for (const section of sections) {
    const stated = rules.get(section.id)!.stated;
    const actual = items.filter((item) => item.sectionId === section.id).length;
    if (stated !== null && stated !== actual) countMismatches.push({ label: section.label, termCode: section.termCode, stated, actual });
  }

  const slots: { item: PlanItem; number: number }[] = [];
  const plain = new Map<string, { course: PlanCourseInfo; termCode: string }>();
  const choiceSlots: ChoiceSlot[] = [];
  const informational = new Map<string, { label: string; termCode: string; options: PlanCourseInfo[] }>();
  const quotaGroups = new Map<string, QuotaGroup>();
  const slotBySection = new Map<string, ChoiceSlot>();

  for (const item of items) {
    const number = physicalEducationSlot(item.name);
    if (number !== null) { slots.push({ item, number }); continue; }
    const course = courses.get(courseKey(item.code));
    if (!course || !course.applicable) continue; // Not in the curriculum, or another specialty's course.
    const section = item.sectionId ? sectionById.get(item.sectionId) : undefined;
    const rule = section ? rules.get(section.id)! : null;
    if (section && rule?.choice && rule.informational) {
      const entry = informational.get(section.id) ?? { label: section.label, termCode: section.termCode, options: [] };
      if (!entry.options.some((option) => option.code === course.code)) entry.options.push(course);
      informational.set(section.id, entry);
    } else if (section && rule?.choice && rule.k !== null) {
      let slot = slotBySection.get(section.id);
      if (!slot) { slot = { section, need: rule.k, options: [], electiveCodes: new Set(), done: 0, ongoing: 0 }; slotBySection.set(section.id, slot); choiceSlots.push(slot); }
      if (!slot.options.some((option) => option.code === course.code)) slot.options.push(course);
      if (course.electiveCode) slot.electiveCodes.add(course.electiveCode);
    } else if (course.electiveCode) {
      const quota = args.quotas.get(course.electiveCode)?.quota ?? null;
      const group = quotaGroups.get(course.electiveCode) ?? { code: course.electiveCode, quota, items: [], dueTerm: item.termCode, doneCredits: 0, ongoingCredits: 0 };
      if (!group.items.some((entry) => entry.course.code === course.code)) group.items.push({ course, termCode: item.termCode });
      if (item.termCode > group.dueTerm) group.dueTerm = item.termCode;
      quotaGroups.set(course.electiveCode, group);
    } else if (!plain.has(course.code)) {
      plain.set(course.code, { course, termCode: item.termCode });
    }
  }
  for (const slot of choiceSlots) slot.need = Math.min(slot.need, Math.max(slot.options.length, 1));

  // One allocation per course: own options first (passed, then in progress), then substitutes
  // from the same CTĐT elective group, earliest section first.
  const allocated = new Set<string>();
  const allocate = (slot: ChoiceSlot, candidates: readonly PlanCourseInfo[], accept: (state: CourseState) => boolean, field: "done" | "ongoing") => {
    for (const course of candidates) {
      if (slot.done + slot.ongoing >= slot.need) return;
      if (allocated.has(course.code) || !accept(course.state)) continue;
      allocated.add(course.code);
      slot[field]++;
    }
  };
  for (const slot of choiceSlots) allocate(slot, slot.options, done, "done");
  for (const slot of choiceSlots) allocate(slot, slot.options, ongoing, "ongoing");
  const substitutes = (slot: ChoiceSlot) => [...courses.values()]
    .filter((course) => course.applicable && course.electiveCode !== null && slot.electiveCodes.has(course.electiveCode))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const slot of choiceSlots) allocate(slot, substitutes(slot), done, "done");
  for (const slot of choiceSlots) allocate(slot, substitutes(slot), ongoing, "ongoing");
  // A choice of a CTĐT elective group whose credits are reached (passed, else passed and in progress) is met: a plan can list
  // more choices of a group than its credits, and a student who took them all in other terms is not late (comp-calc-v20,
  // user 2026-11-05: "người ta học đúng kế hoạch mà").
  const groupCredits = (code: string, accept: (state: CourseState) => boolean) => [...courses.values()]
    .filter((course) => course.applicable && course.electiveCode === code && accept(course.state)).reduce((sum, course) => sum + course.credits, 0);
  const reached = (codes: ReadonlySet<string>, accept: (state: CourseState) => boolean) => codes.size > 0 && [...codes].every((code) => {
    const quota = args.quotas.get(code)?.quota ?? null;
    return quota !== null && quota > 0 && groupCredits(code, accept) >= quota;
  });
  for (const slot of choiceSlots) {
    const missing = slot.need - slot.done - slot.ongoing;
    if (missing <= 0) continue;
    if (reached(slot.electiveCodes, done)) slot.done += missing;
    else if (reached(slot.electiveCodes, (state) => done(state) || ongoing(state))) slot.ongoing += missing;
  }

  for (const group of quotaGroups.values()) {
    for (const course of courses.values()) {
      if (!course.applicable || course.electiveCode !== group.code || allocated.has(course.code)) continue;
      if (done(course.state)) group.doneCredits += course.credits;
      else if (ongoing(course.state)) group.ongoingCredits += course.credits;
    }
  }

  const peCodes = [...new Set(Object.values(args.physicalEducationGroups).flat().map(courseKey))];
  const peCourses = peCodes.map((code) => courses.get(code)).filter((course): course is PlanCourseInfo => Boolean(course));
  const pePassed = peCourses.filter((course) => done(course.state)).length;
  const peOngoing = peCourses.filter((course) => ongoing(course.state)).length;
  const peCredits = (item: PlanItem) => item.credits ?? minCredits(peCourses);
  const slotLabel = (item: PlanItem, number: number) => item.name.trim() || `GDTC ${number}`;
  // A slot whose courses are named for it (K26–K28 "Giáo dục thể chất (1)", v17) is met by one of them; any other slot by
  // the number of PE courses (TC002/TC102 electives) passed, or passed and in progress.
  const namedSlotCourses = (number: number) => (args.physicalEducationGroups[namedSlotKey(number)] ?? [])
    .map((code) => courses.get(courseKey(code))).filter((course): course is PlanCourseInfo => Boolean(course));
  const slotMet = (number: number, accept: (state: CourseState) => boolean, count: number) => {
    const named = namedSlotCourses(number);
    return named.length ? named.some((course) => accept(course.state)) : count >= number;
  };
  const choiceText = (slot: ChoiceSlot) => choiceLabel(slot.section.label, slot.need, slot.options.length);
  const groupLabel = (group: QuotaGroup) => `Nhóm tự chọn ${group.code}: chọn ${group.quota} tín chỉ`;
  const conditionOnlyAll = (options: readonly PlanCourseInfo[]) => options.length > 0 && options.every((option) => option.conditionOnly === true);

  /**
   * The items of the terms `include` accepts that are neither passed nor in progress, in plan order: `late` (terms before the
   * one being studied) and `current` (the term being studied). count: courses (a choice its courses still to choose, a credit
   * choice its credits over its largest course); credits: condition-only items left out (v19).
   */
  const openItems = (include: (term: string) => boolean): { entries: LateEntry[]; count: number; credits: number } => {
    const timed: { term: string; order: number; entry: LateEntry }[] = [];
    let count = 0, credits = 0;
    const add = (term: string, entry: LateEntry, courseCount: number, entryCredits: number) => {
      timed.push({ term, order: timed.length, entry });
      count += courseCount;
      if (!entry.conditionOnly) credits += entryCredits;
    };
    for (const { course, termCode } of plain.values()) {
      if (!include(termCode) || done(course.state) || ongoing(course.state)) continue;
      add(termCode, {
        kind: "course", code: course.code, name: course.name, credits: course.credits, termCode, state: course.state, ...conditionFlag(course.conditionOnly === true),
      }, 1, course.credits);
    }
    for (const slot of choiceSlots) {
      const missing = slot.need - slot.done - slot.ongoing;
      if (!include(slot.section.termCode) || missing <= 0) continue;
      const missingCredits = choiceCreditRange(slot.options, missing).low;
      add(slot.section.termCode, {
        kind: "choice", label: choiceText(slot), termCode: slot.section.termCode, required: slot.need, unit: "course",
        missing, missingCredits, options: slot.options.map(ref), ...conditionFlag(conditionOnlyAll(slot.options)),
      }, missing, missingCredits);
    }
    for (const group of quotaGroups.values()) {
      if (group.quota === null || !include(group.dueTerm)) continue;
      const missingCredits = group.quota - group.doneCredits - group.ongoingCredits;
      if (missingCredits <= 0) continue;
      const options = group.items.map((entry) => entry.course);
      // `missing` in the unit of the group, credits (v19); its course count goes to `count` only.
      add(group.dueTerm, {
        kind: "choice", label: groupLabel(group), termCode: group.dueTerm, required: group.quota, unit: "credit",
        missing: missingCredits, missingCredits, options: options.map(ref), ...conditionFlag(conditionOnlyAll(options)),
      }, Math.max(1, Math.ceil(missingCredits / Math.max(maxCredits(options), 1))), missingCredits);
    }
    for (const { item, number } of slots) {
      if (!include(item.termCode) || slotMet(number, (state) => done(state) || ongoing(state), pePassed + peOngoing)) continue;
      // GDTC is a condition: listed, its credits never counted (v19).
      add(item.termCode, {
        kind: "physical_education", label: slotLabel(item, number), termCode: item.termCode, required: number, passed: pePassed, missingCredits: peCredits(item),
        conditionOnly: true,
      }, 1, peCredits(item));
    }
    timed.sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : a.order - b.order));
    return { entries: timed.map((entry) => entry.entry), count, credits };
  };
  const late = openItems(before);
  const current = openItems(during);

  const termCodes = [...new Set([...args.plan.terms.map((term) => term.code), ...items.map((item) => item.termCode)])].sort();
  const nextTerm = termCodes.find((term) => currentTerm === null || term > currentTerm) ?? null;
  const next: NextEntry[] = [];
  // Courses, not entries (v17): K30's "3 courses + Chọn 2 trong 4" is 5, it read 4. Condition-only credits never count (v19).
  let nextCount = 0, nextCredits = 0;
  if (nextTerm) {
    for (const { course, termCode } of plain.values()) {
      if (termCode !== nextTerm || done(course.state)) continue;
      next.push({ kind: "course", code: course.code, name: course.name, credits: course.credits, state: course.state, ...conditionFlag(course.conditionOnly === true) });
      nextCount++;
      if (!course.conditionOnly) nextCredits += course.credits;
    }
    for (const slot of choiceSlots) {
      const remaining = slot.need - slot.done - slot.ongoing;
      if (slot.section.termCode !== nextTerm || remaining <= 0) continue;
      next.push({ kind: "choice", label: choiceText(slot), required: slot.need, unit: "course", remaining, options: slot.options.map(ref) });
      nextCount += remaining;
      if (!conditionOnlyAll(slot.options)) nextCredits += choiceCreditRange(slot.options, remaining).low;
    }
    for (const group of quotaGroups.values()) {
      if (group.quota === null || !group.items.some((entry) => entry.termCode === nextTerm)) continue;
      const remaining = group.quota - group.doneCredits - group.ongoingCredits;
      if (remaining <= 0) continue;
      const options = group.items.map((entry) => entry.course).filter((course) => !done(course.state));
      next.push({ kind: "choice", label: groupLabel(group), required: group.quota, unit: "credit", remaining, options: options.map(ref) });
      // As many courses as the credits take with the group's largest course, like a late credit choice.
      nextCount += Math.max(1, Math.ceil(remaining / Math.max(maxCredits(group.items.map((entry) => entry.course)), 1)));
      if (!conditionOnlyAll(group.items.map((entry) => entry.course))) nextCredits += remaining;
    }
    for (const { item, number } of slots) {
      if (item.termCode !== nextTerm || slotMet(number, done, pePassed)) continue;
      next.push({ kind: "physical_education", label: slotLabel(item, number), required: number, passed: pePassed, conditionOnly: true });
      nextCount++;
    }
  }

  const informationalSections = [...informational.values()].map((entry) => ({ label: choiceLabel(entry.label), termCode: entry.termCode, options: entry.options.map(ref) }));
  for (const group of quotaGroups.values()) {
    if (group.quota !== null) continue;
    informationalSections.push({ label: `Nhóm tự chọn ${group.code}`, termCode: group.dueTerm, options: group.items.map((entry) => ref(entry.course)) });
  }
  return {
    currentTerm, nextTerm,
    late: late.entries, lateCount: late.count, lateCredits: late.credits,
    current: current.entries, currentCount: current.count, currentCredits: current.credits,
    next, nextCount, nextCredits,
    informationalSections, countMismatches,
  };
}
