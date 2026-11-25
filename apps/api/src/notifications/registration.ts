// Lịch đăng ký học tập (2026-11-25; the user, with Phòng Đào tạo's notices of HK252, HK253 and HK261: "Hãy dựa vào cái
// lịch này thêm 1 cái nút thông báo nhắc nhở đăng ký kế hoạch học tập khi đến thời gian"). An admin enters each window of
// the official notice: đăng ký kế hoạch học tập or đăng ký học phần, its đợt, the cohorts it is for and its times (the
// notices give them per cohort: "K30 & K31 từ 22g00 ngày 15/4/2026 đến 14g00 ngày 16/4/2026"). When the window's time comes
// (its opening, or one or two days before) EduPath AI reminds those students in the bell under its own name (type sys,
// kind registration_reminder; the user: "không có xưng là khoa nha là EduPath AI được rồi"), and by email when the kind's
// email is on in Cài đặt thông báo. Migration 069. The reminder runs from the API process every minute; Render's free
// instance sleeps after a while without visits, so a reminder due while it sleeps goes out when it wakes, unless the
// window has ended by then.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { personName } from "../users/person-name.js";
import { termName } from "../term-name.js";
import { notifyMany } from "./notify.js";
import { reachableStudentIds } from "./repository.js";
import { kindTurnedOff } from "./settings.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

export const REGISTRATION_KINDS = { study_plan: "Đăng ký kế hoạch học tập", course: "Đăng ký học phần" } as const;
export type RegistrationKind = keyof typeof REGISTRATION_KINDS;
/** Minutes before the opening the reminder goes out: at the opening, one or two days before. */
export const REMIND_BEFORE = [0, 1440, 2880] as const;
export type RemindBefore = (typeof REMIND_BEFORE)[number];
/** Where students register (Phòng Đào tạo's notices). */
export const REGISTRATION_SITE = "https://regist.vlu.edu.vn/";
export const ROUND_MAX = 60;
export const NOTE_MAX = 300;

export type RegistrationWindowInput = {
  termCode: string; kind: RegistrationKind; round: string; cohorts: string[]; opensAt: Date; closesAt: Date; remindBefore: RemindBefore; note: string | null;
};
/** What happened to a window's reminder: sent, closed (the window ended first), turned_off (the kind is off), nobody. */
export type ReminderOutcome = "sent" | "closed" | "turned_off" | "nobody";
export type RegistrationWindowRow = RegistrationWindowInput & {
  id: string; remindAt: Date; remindedAt: Date | null; outcome: ReminderOutcome | null; recipients: number | null; withdrawnAt: Date | null;
  read: number; createdBy: string | null; createdAt: Date; updatedAt: Date;
};

const VN = "Asia/Ho_Chi_Minh";
const vnTime = (at: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: VN, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
const vnDate = (at: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: VN, day: "2-digit", month: "2-digit", year: "numeric" }).format(at);
/** "22:00 ngày 26/11/2026", as Phòng Đào tạo's notices write a time. */
export const whenText = (at: Date) => `${vnTime(at)} ngày ${vnDate(at)}`;
/** "sinh viên K29, K30" or "tất cả sinh viên". */
export const cohortsText = (cohorts: readonly string[]) => (cohorts.length ? `sinh viên ${cohorts.join(", ")}` : "tất cả sinh viên");

/** A rule of the notices worth repeating in each reminder of its kind. */
const KIND_TIP: Readonly<Record<RegistrationKind, string>> = {
  study_plan: "Chưa đăng ký kế hoạch học tập thì không được đăng ký học phần ở Đợt 1 (đợt chính thức), chỉ đăng ký được ở các đợt bổ sung.",
  course: "Chưa hoàn tất học phí các học kỳ trước thì chưa đăng ký được học phần.",
};

/**
 * The reminder of a window as students get it, sent at `at`: before the opening it gives both times, once open it gives
 * the closing time. Under EduPath AI's name; the admin's note goes before the closing lines.
 */
export function reminderText(window: Pick<RegistrationWindowInput, "termCode" | "kind" | "round" | "cohorts" | "opensAt" | "closesAt" | "note">, at: Date) {
  const kind = REGISTRATION_KINDS[window.kind];
  const term = termName(window.termCode);
  const round = window.round.replace(/\s+/g, " ").trim();
  const what = `${round} ${kind.toLowerCase()} ${term} dành cho ${cohortsText(window.cohorts)}`;
  const when = at.getTime() >= window.opensAt.getTime()
    ? `${what} đang mở, đến ${whenText(window.closesAt)}.`
    : `${what} mở lúc ${whenText(window.opensAt)} và kết thúc lúc ${whenText(window.closesAt)}.`;
  const note = window.note?.replace(/\r\n?/g, "\n").trim();
  return {
    title: `Nhắc ${kind.toLowerCase()} ${term}: ${round}`,
    body: [
      `${when} Bạn đăng ký tại ${REGISTRATION_SITE} và nên trao đổi với cố vấn học tập trước khi đăng ký.`,
      KIND_TIP[window.kind],
      ...(note ? [note] : []),
      "Bạn xem Kế hoạch học kỳ trên EduPath AI để chọn môn phù hợp với lộ trình.\nEduPath AI",
    ].join("\n\n"),
  };
}

/** The time the reminder goes out: the opening, less one or two days. */
export const remindAtOf = (opensAt: Date, remindBefore: number) => new Date(opensAt.getTime() - remindBefore * 60_000);

const columns = `w.id,w.term_code AS "termCode",w.kind,w.round,w.cohorts,w.opens_at AS "opensAt",w.closes_at AS "closesAt",
  w.remind_before AS "remindBefore",w.remind_at AS "remindAt",w.note,w.reminded_at AS "remindedAt",w.outcome,w.recipients,
  w.withdrawn_at AS "withdrawnAt",u.display_name AS "createdBy",w.created_at AS "createdAt",w.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM stu_notifications n WHERE n.kind='registration_reminder' AND n.source_key='registration:'||w.id AND n.read_at IS NOT NULL) AS read`;
const fromWindows = "FROM ad_registration_windows w LEFT JOIN users u ON u.id=w.created_by";
const fix = (row: RegistrationWindowRow): RegistrationWindowRow => ({
  ...row, createdBy: row.createdBy ? personName(row.createdBy) || row.createdBy : null,
  opensAt: new Date(row.opensAt), closesAt: new Date(row.closesAt), remindAt: new Date(row.remindAt),
  remindedAt: row.remindedAt ? new Date(row.remindedAt) : null, withdrawnAt: row.withdrawnAt ? new Date(row.withdrawnAt) : null,
  createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt),
});

/** Every window, by opening time. */
export async function listWindows(db: Db): Promise<RegistrationWindowRow[]> {
  return (await db.query<RegistrationWindowRow>(`SELECT ${columns} ${fromWindows} ORDER BY w.opens_at,w.created_at,w.id`)).rows.map(fix);
}

export async function findWindow(db: Db, id: string, lock = false): Promise<RegistrationWindowRow | null> {
  const row = (await db.query<RegistrationWindowRow>(
    `SELECT ${columns} ${fromWindows} WHERE w.id=$1${lock ? " FOR UPDATE OF w" : ""}`, [id])).rows[0];
  return row ? fix(row) : null;
}

export async function createWindow(db: Db, input: RegistrationWindowInput, actorId: string): Promise<RegistrationWindowRow> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ad_registration_windows(id,term_code,kind,round,cohorts,opens_at,closes_at,remind_before,remind_at,note,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [id, input.termCode, input.kind, input.round, input.cohorts, input.opensAt, input.closesAt, input.remindBefore,
      remindAtOf(input.opensAt, input.remindBefore), input.note, actorId]);
  return (await findWindow(db, id))!;
}

/** Changes a window whose reminder has not gone out; "missing" or "reminded" otherwise. */
export async function updateWindow(db: Db, id: string, input: RegistrationWindowInput, actorId: string): Promise<RegistrationWindowRow | "missing" | "reminded"> {
  const updated = await db.query(
    `UPDATE ad_registration_windows SET term_code=$2,kind=$3,round=$4,cohorts=$5,opens_at=$6,closes_at=$7,remind_before=$8,remind_at=$9,note=$10,
        updated_by=$11,updated_at=now()
      WHERE id=$1 AND reminded_at IS NULL`,
    [id, input.termCode, input.kind, input.round, input.cohorts, input.opensAt, input.closesAt, input.remindBefore,
      remindAtOf(input.opensAt, input.remindBefore), input.note, actorId]);
  if (updated.rowCount) return (await findWindow(db, id))!;
  return (await db.query("SELECT 1 FROM ad_registration_windows WHERE id=$1", [id])).rowCount ? "reminded" : "missing";
}

/** Removes a window from the schedule; a reminder already in the bells stays there (withdraw it first to take it out). */
export async function deleteWindow(db: Db, id: string): Promise<boolean> {
  return Boolean((await db.query("DELETE FROM ad_registration_windows WHERE id=$1", [id])).rowCount);
}

/**
 * Sends a window's reminder now, inside the caller's transaction (the row locked by the caller): nothing when the window
 * has ended or the kind is turned off in Cài đặt thông báo; otherwise one notification per student of its cohorts (and the
 * email the kind's setting asks for). Records what happened.
 */
export async function deliverReminder(client: Pick<PoolClient, "query">, window: RegistrationWindowRow, staffDomains: readonly string[],
  at = new Date()): Promise<ReminderOutcome> {
  let outcome: ReminderOutcome;
  let recipients = 0;
  if (window.closesAt.getTime() <= at.getTime()) outcome = "closed";
  else if ((await client.query<{ off: boolean }>(`SELECT ${kindTurnedOff("'registration_reminder'::text")} AS off`)).rows[0]?.off) outcome = "turned_off";
  else {
    const ids = await reachableStudentIds(client, { cohorts: window.cohorts, majors: [] }, staffDomains);
    if (!ids.length) outcome = "nobody";
    else {
      const text = reminderText(window, at);
      recipients = await notifyMany(client, ids, {
        type: "sys", kind: "registration_reminder", title: text.title, body: text.body, link: "#roadmap", sourceKey: `registration:${window.id}`,
      });
      outcome = recipients ? "sent" : "turned_off";
    }
  }
  await client.query("UPDATE ad_registration_windows SET reminded_at=now(),outcome=$2,recipients=$3,updated_at=now() WHERE id=$1",
    [window.id, outcome, recipients]);
  return outcome;
}

/** Takes a sent reminder out of every bell (its emails not yet sent are cancelled by the mail worker's tidying). */
export async function withdrawReminder(client: Pick<PoolClient, "query">, id: string): Promise<number> {
  const removed = await client.query(
    "UPDATE stu_notifications SET deleted_at=now() WHERE kind='registration_reminder' AND source_key=$1 AND deleted_at IS NULL", [`registration:${id}`]);
  await client.query("UPDATE ad_registration_windows SET withdrawn_at=now(),updated_at=now() WHERE id=$1", [id]);
  return removed.rowCount ?? 0;
}

/** One round of the reminders: every window whose time has come and that has not been handled, at most ten at a time. */
export async function remindDueWindows(pool: Pick<DatabasePool, "connect">, staffDomains: readonly string[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = (await client.query<RegistrationWindowRow>(
      `SELECT ${columns} ${fromWindows} WHERE w.reminded_at IS NULL AND w.remind_at<=now()
        ORDER BY w.remind_at,w.id LIMIT 10 FOR UPDATE OF w SKIP LOCKED`)).rows.map(fix);
    for (const window of due) await deliverReminder(client, window, staffDomains);
    await client.query("COMMIT");
    return due.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs remindDueWindows every minute (the first time a few seconds after start), never two rounds at once; stop() ends it. */
export function startRegistrationReminders(pool: Pick<DatabasePool, "connect">, staffDomains: readonly string[], intervalMs = 60_000) {
  let running = false;
  const round = () => {
    if (running) return;
    running = true;
    void remindDueWindows(pool, staffDomains)
      .then((handled) => { if (handled) console.log(`[REGISTRATION] ${handled} reminder window(s) handled`); })
      .catch((error: unknown) => console.error(`[REGISTRATION] The reminder round failed (${(error as { code?: string } | null)?.code ?? "error"})`))
      .finally(() => { running = false; });
  };
  const first = setTimeout(round, 5_000);
  const timer = setInterval(round, intervalMs);
  first.unref?.();
  timer.unref?.();
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
