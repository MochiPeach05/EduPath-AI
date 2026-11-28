import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailConsentClient } from "../auth/mail-consent-client.js";
import type { DatabasePool } from "../db/pool.js";
import type { MailMessage, MailResult } from "../mail/graph-mail.js";
import type { MailGrant, MailGrantStore, MailSenderStatus } from "../mail/grants.js";
import { createAnnouncementsRouter } from "./admin-router.js";

// The faculty's announcements (AD-NOTI-01/02) over a fake database. Synthetic ids only.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222221";
const B = "22222222-2222-4222-8222-222222222222";
const ANN = "77777777-7777-4777-8777-777777777777";
const origin = "https://edupath.example";
const announcement = (extra: Record<string, unknown> = {}) => ({
  id: ANN, title: "Lịch đăng ký học phần", body: "Mở từ 01/12.", link: "#plans", target: { cohorts: ["K29"], majors: ["7480201"] },
  recipients: 2, read: 1, createdAt: new Date("2026-10-30T02:00:00Z"), createdBy: "Quản trị viên mẫu", withdrawnAt: null, ...extra,
});

type Rows = (sql: string, params: unknown[]) => { rowCount: number; rows: unknown[] } | undefined;
type Mail = { client: MailConsentClient; grants: MailGrantStore; sendMail: (token: string, message: MailMessage) => Promise<MailResult> };
function setup(options: { role?: string; admin?: boolean; rows?: Rows; mail?: Mail } = {}) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active")) {
      return options.admin === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: ADMIN }] };
    }
    return options.rows?.(sql, params) ?? { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: { userId: ADMIN, tenantId: "t", role: options.role ?? "admin", name: "Nguyễn Văn Cán Bộ" } } });
    next();
  });
  app.use("/a", createAnnouncementsRouter(pool, origin, { staffEmailDomains: new Set(["vlu.edu.vn"]), ...(options.mail ? { mail: options.mail } : {}) }));
  return { app, query, release, sql: () => query.mock.calls.map(([text, params]) => [String(text), params] as const) };
}

afterEach(() => vi.restoreAllMocks());

describe("announcements API", () => {
  it("is for active admins only, and writes need the web origin", async () => {
    await request(setup({ role: "student" }).app).get("/a").expect(403, { error: "insufficient_role" });
    await request(setup({ admin: false }).app).get("/a").expect(403, { error: "insufficient_role" });
    await request(setup().app).post("/a").send({ title: "T", body: "B" }).expect(403, { error: "invalid_origin" });
  });

  it("offers the cohorts and majors of the students, and counts who an announcement reaches", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("SELECT DISTINCT p.cohort_code") ? { rowCount: 3, rows: [{ cohort: "K30", major: "7480201" }, { cohort: "K9", major: "7480104" }, { cohort: null, major: null }] }
        : text.startsWith("SELECT count(*)::int AS count") ? { rowCount: 1, rows: [{ count: 312, withEmail: 300 }] } : undefined),
    });
    expect((await request(app).get("/a/options").expect(200)).body).toEqual({
      cohorts: ["K9", "K30"], majors: [{ code: "7480104", name: "Hệ thống thông tin" }, { code: "7480201", name: "Công nghệ thông tin" }],
    });
    await request(app).get("/a/reach?cohorts=K29,K30&majors=7480201").expect(200, { count: 312, withEmail: 300 });
    const reach = sql().find(([text]) => text.startsWith("SELECT count(*)::int AS count"))!;
    expect(reach[0]).toContain("COALESCE(u.role_override,u.role)='student'");
    expect(reach[1]).toEqual([["K29", "K30"], ["7480201"], ["vlu.edu.vn"], []]);
    await request(app).get("/a/reach?cohorts=29").expect(400, { error: "invalid_input" });
  });

  it("names a programme outside the faculty's catalog readably, after the faculty's majors, in the options and the sent list", async () => {
    const { app } = setup({
      rows: (text) => (text.startsWith("SELECT DISTINCT p.cohort_code") ? { rowCount: 3, rows: [{ cohort: "K29", major: "7480201" }, { cohort: "K29", major: "7340201" }, { cohort: "K30", major: "7480104" }] }
        : text.includes("FROM ad_announcements a LEFT JOIN users u") ? { rowCount: 1, rows: [announcement({ target: { cohorts: ["K29"], majors: ["7340201", "7480201"] } })] } : undefined),
    });
    expect((await request(app).get("/a/options").expect(200)).body.majors).toEqual([
      { code: "7480104", name: "Hệ thống thông tin" }, { code: "7480201", name: "Công nghệ thông tin" }, { code: "7340201", name: "Ngành khác (mã 7340201)" },
    ]);
    expect((await request(app).get("/a").expect(200)).body.items[0].targetLabel).toBe("K29 · Công nghệ thông tin, Ngành khác (mã 7340201)");
  });

  it("refuses an empty title or body, a link outside the portal and an audience of nobody", async () => {
    const { app } = setup();
    const send = (body: Record<string, unknown>) => request(app).post("/a").set("Origin", origin).send(body);
    await send({ title: "  ", body: "Nội dung" }).expect(400, { error: "title_required" });
    await send({ title: "Tiêu đề", body: "\n " }).expect(400, { error: "body_required" });
    await send({ title: "Tiêu đề", body: "Nội dung", link: "https://example.com" }).expect(400, { error: "invalid_input" });
    await send({ title: "T".repeat(121), body: "Nội dung" }).expect(400, { error: "invalid_input" });
    await send({ title: "Tiêu đề", body: "Nội dung", cohorts: ["K99"] }).expect(400, { error: "no_recipients" });
  });

  it("sends one notification per recipient in one transaction", async () => {
    const { app, sql, release } = setup({
      rows: (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 2, rows: [{ id: A }, { id: B }] }
        : text.includes("FROM ad_announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1") ? { rowCount: 1, rows: [announcement()] } : undefined),
    });
    const response = await request(app).post("/a").set("Origin", origin)
      .send({ title: " Lịch đăng ký học phần ", body: "Mở từ 01/12.", link: "#plans", cohorts: ["K29", "K29"], majors: ["7480201"] }).expect(201);
    expect(response.body.announcement).toMatchObject({ id: ANN, targetLabel: "K29 · Công nghệ thông tin", recipients: 2, read: 1, createdAt: "2026-10-30T02:00:00.000Z" });
    const statements = sql().map(([text]) => text);
    expect(statements[statements.indexOf("BEGIN") + 1]).toContain("FOR SHARE");
    const inserted = sql().find(([text]) => text.startsWith("INSERT INTO ad_announcements"))!;
    expect(inserted[1]).toEqual([expect.any(String), "Lịch đăng ký học phần", "Mở từ 01/12.", "#plans", JSON.stringify({ cohorts: ["K29"], majors: ["7480201"] }), 2, ADMIN, "khoa"]);
    const fanOut = sql().find(([text]) => text.startsWith("INSERT INTO stu_notifications"))!;
    const params = fanOut[1] as unknown[][];
    expect(params[1]).toEqual([A, B]);
    expect(params[2]).toEqual(["khoa", "khoa"]);
    expect(params[3]).toEqual(["announcement", "announcement"]);
    expect(params[7]).toEqual(["Mở Kế hoạch đào tạo", "Mở Kế hoạch đào tạo"]);
    expect(params[8]).toEqual([`announcement:${inserted[1]![0]}`, `announcement:${inserted[1]![0]}`]);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("sends under EduPath AI's name when asked: the bell says Hệ thống, never Từ Khoa (2026-11-25)", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 1, rows: [{ id: A }] }
        : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ sender: "edupath", recipients: 1 })] } : undefined),
    });
    const response = await request(app).post("/a").set("Origin", origin).send({ title: "Nhắc đăng ký học phần", body: "Nội dung.", sender: "edupath" }).expect(201);
    expect(response.body.announcement.sender).toBe("edupath");
    const inserted = sql().find(([text]) => text.startsWith("INSERT INTO ad_announcements"))!;
    expect((inserted[1] as unknown[])[7]).toBe("edupath");
    const fanOut = sql().find(([text]) => text.startsWith("INSERT INTO stu_notifications"))!;
    expect((fanOut[1] as unknown[][])[2]).toEqual(["sys"]);
    await request(app).post("/a").set("Origin", origin).send({ title: "T", body: "B", sender: "phong-dao-tao" }).expect(400, { error: "invalid_input" });
    // An older row without the column reads as the Khoa's.
    const old = setup({ rows: (text) => (text.includes("FROM ad_announcements a LEFT JOIN users u") ? { rowCount: 1, rows: [announcement()] } : undefined) });
    expect((await request(old.app).get("/a").expect(200)).body.items[0].sender).toBe("khoa");
  });

  it("withdraws an announcement once and takes it out of every bell", async () => {
    let withdrawn = false;
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("UPDATE ad_announcements SET withdrawn_at=now()") ? (withdrawn ? { rowCount: 0, rows: [] } : ((withdrawn = true), { rowCount: 1, rows: [] }))
        : text === "SELECT 1 FROM ad_announcements WHERE id=$1" ? { rowCount: 1, rows: [{}] }
        : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ withdrawnAt: new Date("2026-10-30T03:00:00Z") })] } : undefined),
    });
    const first = await request(app).post(`/a/${ANN}/withdraw`).set("Origin", origin).send({}).expect(200);
    expect(first.body.announcement.withdrawnAt).toBe("2026-10-30T03:00:00.000Z");
    expect(sql().some(([text, params]) => text.startsWith("UPDATE stu_notifications SET deleted_at=now() WHERE announcement_id=$1") && (params as unknown[])[0] === ANN)).toBe(true);
    // Its emails that have not gone out are cancelled; a sent email cannot be recalled.
    expect(sql().some(([text, params]) => text.startsWith("UPDATE ad_announcement_emails SET status='cancelled'") && (params as unknown[])[0] === ANN)).toBe(true);
    await request(app).post(`/a/${ANN}/withdraw`).set("Origin", origin).send({}).expect(409, { error: "already_withdrawn" });
  });

  it("lists the announcements in the order a column asks for", async () => {
    const { app, sql } = setup({ rows: (text) => (text.includes("FROM ad_announcements a LEFT JOIN users u") ? { rowCount: 1, rows: [announcement()] } : undefined) });
    expect((await request(app).get("/a?sort=read&order=desc").expect(200)).body.items[0]).toMatchObject({ id: ANN, targetLabel: "K29 · Công nghệ thông tin" });
    expect(sql().find(([text]) => text.includes("FROM ad_announcements a LEFT JOIN users u"))![0])
      .toContain("(SELECT count(*) FROM stu_notifications n WHERE n.announcement_id=a.id AND n.read_at IS NOT NULL) DESC NULLS LAST");
    await request(app).get("/a?sort=nope").expect(400, { error: "invalid_input" });
  });
});

// "Chọn sinh viên" (2026-11-25): an announcement for students picked one by one. Made-up students only.
describe("an announcement for picked students", () => {
  const picked = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: "Trần Minh An", studentCode: "2374802019001", className: "71K29CNTT08", cohort: "K29", hasEmail: true, ...extra });

  it("finds students by every word typed, without tones or case, and names them as the admin lists do", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("SELECT u.id,COALESCE(NULLIF(btrim(p.full_name),''),u.display_name) AS name") ? { rowCount: 2, rows: [
        picked(A), picked(B, { name: "2374802019002 - Lê Thu Hà - 71K29CNTT08", studentCode: "2374802019002", hasEmail: false }),
      ] } : undefined),
    });
    const found = await request(app).get("/a/students").query({ q: "  Hà  LÊ ", limit: 5 }).expect(200);
    expect(found.body.items).toEqual([picked(A), picked(B, { name: "Lê Thu Hà", studentCode: "2374802019002", hasEmail: false })]);
    const [text, params] = sql().find(([statement]) => statement.startsWith("SELECT u.id,COALESCE(NULLIF(btrim(p.full_name),''),u.display_name) AS name"))!;
    // Only accounts an announcement can reach: active students, no staff mailbox.
    expect(text).toContain("u.is_active AND COALESCE(u.role_override,u.role)='student'");
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM unnest($5::text[]) AS word WHERE strpos(lower(translate(concat_ws(' ',p.full_name,u.display_name,p.student_code,");
    expect(params).toEqual([[], [], ["vlu.edu.vn"], [], ["ha", "le"], 5]);
    // Nothing typed lists the first twenty.
    await request(app).get("/a/students").expect(200);
    expect(sql().at(-1)![1]).toEqual([[], [], ["vlu.edu.vn"], [], [], 20]);
    await request(app).get("/a/students?limit=500").expect(400, { error: "invalid_input" });
    await request(app).get("/a/students?cohort=K29").expect(400, { error: "invalid_input" });
  });

  it("sends to the picked students that can still be reached, and keeps who they were", async () => {
    const { app, sql } = setup({
      // B's account was locked meanwhile: only A is reached.
      rows: (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 1, rows: [{ id: A }] }
        : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ target: { cohorts: [], majors: [], students: [A] }, recipients: 1, read: 0 })] } : undefined),
    });
    const response = await request(app).post("/a").set("Origin", origin).send({ title: "Nhắc lịch gặp cố vấn", body: "Chiều thứ Sáu.", students: [A, B, A] }).expect(201);
    expect(response.body.announcement).toMatchObject({ target: { cohorts: [], majors: [], students: [A] }, targetLabel: "1 sinh viên được chọn", recipients: 1 });
    const chosen = sql().find(([text]) => text.startsWith("SELECT u.id FROM users u"))!;
    expect(chosen[0]).toContain("(cardinality($4::uuid[])=0 OR u.id=ANY($4::uuid[]))");
    expect(chosen[1]).toEqual([[], [], ["vlu.edu.vn"], [A, B]]);
    const inserted = sql().find(([text]) => text.startsWith("INSERT INTO ad_announcements"))!;
    expect((inserted[1] as unknown[])[4]).toBe(JSON.stringify({ cohorts: [], majors: [], students: [A] }));
    expect((inserted[1] as unknown[])[5]).toBe(1);
    const fanOut = sql().find(([text]) => text.startsWith("INSERT INTO stu_notifications"))!;
    expect((fanOut[1] as unknown[][])[1]).toEqual([A]);
  });

  it("refuses picked students together with a cohort or a major, more than 200, and nobody reachable", async () => {
    const { app } = setup();
    const send = (body: Record<string, unknown>) => request(app).post("/a").set("Origin", origin).send({ title: "T", body: "B", ...body });
    await send({ students: [A], cohorts: ["K29"] }).expect(400, { error: "invalid_input" });
    await send({ students: [A], majors: ["7480201"] }).expect(400, { error: "invalid_input" });
    await send({ students: ["not-an-id"] }).expect(400, { error: "invalid_input" });
    await send({ students: Array.from({ length: 201 }, (_, index) => `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`) }).expect(400, { error: "invalid_input" });
    await send({ students: [A] }).expect(400, { error: "no_recipients" });
  });

  it("keeps the label of a picked announcement whose list was cleared after 90 days, and lists nobody", async () => {
    const cleared = announcement({ target: { cohorts: [], majors: [], picked: 3 }, recipients: 3 });
    const { app, sql } = setup({ rows: (text) => (text.includes("FROM ad_announcements a LEFT JOIN users u") ? { rowCount: 1, rows: [cleared] } : undefined) });
    const listed = (await request(app).get("/a").expect(200)).body.items[0];
    expect(listed).toMatchObject({ target: { cohorts: [], majors: [], picked: 3 }, targetLabel: "3 sinh viên được chọn" });
    expect(listed.target.students).toBeUndefined();
    await request(app).get(`/a/${ANN}/recipients`).expect(200, { items: [] });
    expect(sql().some(([text]) => text.includes("WHERE u.id=ANY($1::uuid[])"))).toBe(false);
  });

  it("lists the students an announcement was sent to by picking them", async () => {
    const rows: Rows = (text) => (text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ target: { cohorts: [], majors: [], students: [A, B] } })] }
      : text.includes("WHERE u.id=ANY($1::uuid[])") ? { rowCount: 2, rows: [picked(A), picked(B, { name: "Lê Thu Hà" })] } : undefined);
    const { app, sql } = setup({ rows });
    expect((await request(app).get(`/a/${ANN}/recipients`).expect(200)).body.items.map((item: { name: string }) => item.name)).toEqual(["Trần Minh An", "Lê Thu Hà"]);
    expect(sql().find(([text]) => text.includes("WHERE u.id=ANY($1::uuid[])"))![1]).toEqual([[A, B]]);
    // One sent to cohorts and majors has no such list, and asks the database for none.
    const group = setup({ rows: (text) => (text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement()] } : undefined) });
    await request(group.app).get(`/a/${ANN}/recipients`).expect(200, { items: [] });
    expect(group.sql().some(([text]) => text.includes("WHERE u.id=ANY($1::uuid[])"))).toBe(false);
    await request(setup().app).get(`/a/${ANN}/recipients`).expect(404, { error: "not_found" });
  });
});

// AD-NOTI-04/05/06 (2026-11-23): email from the sender's school mailbox, its outcome, and Cài đặt thông báo. Made-up
// addresses and tokens only; nothing reaches Microsoft.
function mailFakes(options: { status?: MailSenderStatus | null; grant?: MailGrant | null; acquire?: () => Promise<{ accessToken: string; cache: string }>; result?: MailResult } = {}) {
  const grant: MailGrant = { userId: ADMIN, address: "can.bo@example.edu", tenantId: "t", cache: "cache-1" };
  const grants: MailGrantStore = {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => (options.grant === undefined ? grant : options.grant)),
    remove: vi.fn(async () => true),
    status: vi.fn(async () => (options.status === undefined ? { address: grant.address, grantedAt: "2026-11-23T02:00:00.000Z", lastError: null } : options.status)),
    markFailed: vi.fn(async () => undefined),
  };
  const client: MailConsentClient = {
    getConsentUrl: vi.fn(), exchangeCode: vi.fn(),
    acquireToken: vi.fn(options.acquire ?? (async () => ({ accessToken: "graph-token", cache: "cache-2" }))),
  };
  const sent: MailMessage[] = [];
  const sendMail = vi.fn(async (_token: string, message: MailMessage) => { sent.push(message); return options.result ?? { ok: true as const }; });
  return { mail: { client, grants, sendMail }, grants, client, sendMail, sent };
}

describe("announcement emails and notification settings", () => {
  it("says whether email can be sent and from which mailbox, and forgets the permission on request", async () => {
    expect((await request(setup().app).get("/a/mail-sender").expect(200)).body).toEqual({ available: false, sender: null });
    const fakes = mailFakes();
    const { app } = setup({ mail: fakes.mail });
    expect((await request(app).get("/a/mail-sender").expect(200)).body).toEqual({
      available: true, sender: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: null },
    });
    await request(app).delete("/a/mail-sender").expect(403, { error: "invalid_origin" });
    await request(app).delete("/a/mail-sender").set("Origin", origin).expect(204);
    expect(fakes.grants.remove).toHaveBeenCalledWith(ADMIN);
    await request(setup().app).delete("/a/mail-sender").set("Origin", origin).expect(503, { error: "mail_unavailable" });
  });

  it("sends the draft, or a plain test message, to the member's own mailbox only", async () => {
    const fakes = mailFakes();
    const { app } = setup({ mail: fakes.mail });
    const draft = await request(app).post("/a/mail-sender/test").set("Origin", origin)
      .send({ title: " Lịch đăng ký học phần ", body: "Mở từ 01/12.", link: "#plans" }).expect(200);
    expect(draft.body).toEqual({ sent: true, to: "can.bo@example.edu", preview: true });
    expect(fakes.sendMail).toHaveBeenCalledWith("graph-token", expect.anything());
    expect(fakes.sent[0]).toMatchObject({ to: "can.bo@example.edu", subject: "[EduPath AI] Lịch đăng ký học phần" });
    expect(fakes.sent[0]!.html).toContain("Chào Nguyễn Văn Cán Bộ,");
    expect(fakes.sent[0]!.html).toContain("https://edupath.example/dashboard#plans");
    // The renewed permission is kept.
    expect(fakes.grants.save).toHaveBeenCalledWith(expect.objectContaining({ cache: "cache-2" }));
    expect((await request(app).post("/a/mail-sender/test").set("Origin", origin).send({}).expect(200)).body.preview).toBe(false);
    expect(fakes.sent[1]!.subject).toBe("[EduPath AI] Thư thử gửi thông báo qua email");
    // Anything but the draft's fields is refused: the address is never the caller's choice.
    await request(app).post("/a/mail-sender/test").set("Origin", origin).send({ to: "khac@example.edu" }).expect(400, { error: "invalid_input" });
  });

  it("asks to allow EduPath AI again when there is no usable permission, and passes a refusal on", async () => {
    const unreadable = mailFakes({ grant: null });
    await request(setup({ mail: unreadable.mail }).app).post("/a/mail-sender/test").set("Origin", origin).send({})
      .expect(409, { error: "mail_grant_required" });
    expect(unreadable.grants.markFailed).toHaveBeenCalledWith(ADMIN, "grant_required");
    const refused = mailFakes({ acquire: async () => { throw Object.assign(new Error("again"), { errorCode: "grant_required" }); } });
    await request(setup({ mail: refused.mail }).app).post("/a/mail-sender/test").set("Origin", origin).send({}).expect(409, { error: "mail_grant_required" });
    expect(refused.grants.markFailed).toHaveBeenCalledWith(ADMIN, "grant_required");
    const failing = mailFakes({ result: { ok: false, status: 403, code: "ErrorAccessDenied" } });
    await request(setup({ mail: failing.mail }).app).post("/a/mail-sender/test").set("Origin", origin).send({})
      .expect(502, { error: "send_failed", code: "ErrorAccessDenied" });
  });

  it("sends an announcement by email only from a usable permission, and queues one message per recipient", async () => {
    const rows: Rows = (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 2, rows: [{ id: A }, { id: B }] }
      : text.startsWith("WITH r AS (SELECT u.id AS user_id") ? { rowCount: 1, rows: [{ queued: 1, noAddress: 1 }] }
      : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({
        emailRequested: true, emailFrom: "can.bo@example.edu", email: { total: 2, sent: 0, pending: 1, failed: 0, cancelled: 0, noAddress: 1 },
      })] } : undefined);
    const send = (app: express.Express) => request(app).post("/a").set("Origin", origin).send({ title: "Lịch đăng ký học phần", body: "Mở từ 01/12.", email: true });
    await send(setup({ rows }).app).expect(503, { error: "mail_unavailable" });
    await send(setup({ rows, mail: mailFakes({ status: null }).mail }).app).expect(409, { error: "mail_grant_required" });
    await send(setup({ rows, mail: mailFakes({ status: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: "grant_required" } }).mail }).app)
      .expect(409, { error: "mail_grant_required" });
    const { app, sql } = setup({ rows, mail: mailFakes().mail });
    const response = await send(app).expect(201);
    expect(response.body.announcement.email).toEqual({ from: "can.bo@example.edu", total: 2, sent: 0, pending: 1, failed: 0, cancelled: 0, noAddress: 1 });
    const marked = sql().find(([text]) => text.startsWith("UPDATE ad_announcements SET email_requested=true"))!;
    expect((marked[1] as unknown[]).slice(1)).toEqual([ADMIN, "can.bo@example.edu"]);
    const queued = sql().find(([text]) => text.startsWith("WITH r AS (SELECT u.id AS user_id"))!;
    expect((queued[1] as unknown[])[1]).toEqual([A, B]);
    const statements = sql().map(([text]) => text);
    expect(statements.indexOf(queued[0])).toBeLessThan(statements.lastIndexOf("COMMIT"));
    // Without email nothing is queued, and the announcement says so.
    const plain = setup({ rows: (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 1, rows: [{ id: A }] }
      : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement()] } : undefined) });
    expect((await request(plain.app).post("/a").set("Origin", origin).send({ title: "T", body: "B" }).expect(201)).body.announcement.email).toBeNull();
    expect(plain.sql().some(([text]) => text.startsWith("WITH r AS (SELECT u.id AS user_id") || text.startsWith("UPDATE ad_announcements SET email_requested"))).toBe(false);
  });

  it("lists the messages that did not go out and sends the failed ones again", async () => {
    let withdrawn = false;
    const rows: Rows = (text) => (text.startsWith("SELECT COALESCE(NULLIF(btrim(p.full_name),''),u.display_name,'') AS name") ? { rowCount: 2, rows: [
      { name: "Trần Minh An", studentCode: "2374802019001", address: "an@example.edu", status: "failed", error: "ErrorInvalidRecipients", at: new Date("2026-11-23T03:00:00Z") },
      { name: "Lê Thu Hà", studentCode: "2374802019002", address: null, status: "no_address", error: null, at: new Date("2026-11-23T02:00:00Z") },
    ] } : text.startsWith("UPDATE ad_announcement_emails SET status='pending',attempts=0") ? { rowCount: 1, rows: [] }
      : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ withdrawnAt: withdrawn ? new Date("2026-11-23T04:00:00Z") : null })] } : undefined);
    const fakes = mailFakes();
    const { app, sql } = setup({ rows, mail: fakes.mail });
    expect((await request(app).get(`/a/${ANN}/emails`).expect(200)).body.items).toEqual([
      { name: "Trần Minh An", studentCode: "2374802019001", address: "an@example.edu", status: "failed", error: "ErrorInvalidRecipients", at: "2026-11-23T03:00:00.000Z" },
      { name: "Lê Thu Hà", studentCode: "2374802019002", address: null, status: "no_address", error: null, at: "2026-11-23T02:00:00.000Z" },
    ]);
    const retried = await request(app).post(`/a/${ANN}/emails/retry`).set("Origin", origin).send({}).expect(200);
    expect(retried.body.requeued).toBe(1);
    // They go from the mailbox of the member who asks.
    const sender = sql().find(([text]) => text.startsWith("UPDATE ad_announcements SET email_sender_id=$2"))!;
    expect(sender[1]).toEqual([ANN, ADMIN, "can.bo@example.edu"]);
    withdrawn = true;
    await request(app).post(`/a/${ANN}/emails/retry`).set("Origin", origin).send({}).expect(409, { error: "already_withdrawn" });
    await request(setup({ mail: fakes.mail }).app).get(`/a/${ANN}/emails`).expect(404, { error: "not_found" });
  });

  it("turns a kind of automatic notification off and on, never the faculty's announcements nor the bell of an action done for a student", async () => {
    const db = settingsDb();
    const { app } = setup({ rows: db.rows });
    const listed = (await request(app).get("/a/settings").expect(200)).body;
    expect(listed.items.map((item: { key: string }) => item.key)).toEqual(["transcript", "assessment_comment", "roadmap", "graduation_advice", "warning", "catalog_updated", "advisor_action"]);
    expect(listed.items.every((item: { enabled: boolean; email: boolean }) => item.enabled && !item.email)).toBe(true);
    expect(listed.items.find((item: { key: string }) => item.key === "advisor_action").bellLocked).toBe(true);
    // The emails of the last 30 days, per kind.
    expect(listed.items.find((item: { key: string }) => item.key === "roadmap").emails).toEqual({ sent: 12, pending: 1, failed: 2, noAddress: 0 });
    expect(listed.mail).toEqual({ available: false, sender: null, me: null });
    const turned = await request(app).put("/a/settings/roadmap").set("Origin", origin).send({ enabled: false }).expect(200);
    // Named as the admin portal names a person, never "MSSV - Họ tên - Lớp".
    expect(turned.body.setting).toMatchObject({ key: "roadmap", label: "Lộ trình AI", enabled: false, email: false, updatedAt: "2026-11-23T05:00:00.000Z", updatedBy: "Nguyễn Văn Cán Bộ" });
    expect(db.state.saved).toEqual([["roadmap", false, null, ADMIN]]);
    // The bell off takes the email off too, and what has not gone out is cancelled.
    expect(db.state.cancelled).toEqual(["roadmap"]);
    await request(app).put("/a/settings/announcement").set("Origin", origin).send({ enabled: false }).expect(400, { error: "invalid_input" });
    await request(app).put("/a/settings/roadmap").set("Origin", origin).send({ enabled: "no" }).expect(400, { error: "invalid_input" });
    await request(app).put("/a/settings/roadmap").set("Origin", origin).send({}).expect(400, { error: "invalid_input" });
    await request(app).put("/a/settings/advisor_action").set("Origin", origin).send({ enabled: false }).expect(400, { error: "bell_locked" });
  });

  it("sends a kind by email from the mailbox of the admin who turns the first one on, once they allowed EduPath AI", async () => {
    await request(setup({ rows: settingsDb().rows }).app).put("/a/settings/roadmap").set("Origin", origin).send({ email: true }).expect(503, { error: "mail_unavailable" });
    const without = settingsDb();
    await request(setup({ rows: without.rows, mail: mailFakes({ status: null }).mail }).app).put("/a/settings/roadmap").set("Origin", origin).send({ email: true })
      .expect(409, { error: "mail_grant_required" });
    expect(without.state.sender).toBeNull();

    const db = settingsDb();
    const { app } = setup({ rows: db.rows, mail: mailFakes().mail });
    const on = await request(app).put("/a/settings/roadmap").set("Origin", origin).send({ email: true }).expect(200);
    expect(on.body.setting).toMatchObject({ key: "roadmap", enabled: true, email: true });
    expect(db.state.sender).toBe(ADMIN);
    expect(on.body.mail).toEqual({
      available: true, sender: { name: "Nguyễn Văn Cán Bộ", address: "can.bo@example.edu", lastError: null, mine: true },
      me: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: null },
    });
    // An email goes only with the bell notification.
    await request(app).put("/a/settings/warning").set("Origin", origin).send({ enabled: false, email: true }).expect(400, { error: "invalid_input" });
    await request(app).put("/a/settings/warning").set("Origin", origin).send({ enabled: false }).expect(200);
    await request(app).put("/a/settings/warning").set("Origin", origin).send({ email: true }).expect(409, { error: "bell_off" });
    // The email of an action done for a student may go on, its bell stays.
    expect((await request(app).put("/a/settings/advisor_action").set("Origin", origin).send({ email: true }).expect(200)).body.setting)
      .toMatchObject({ key: "advisor_action", enabled: true, email: true });
    db.state.cancelled = [];
    await request(app).put("/a/settings/roadmap").set("Origin", origin).send({ email: false }).expect(200);
    expect(db.state.cancelled).toEqual(["roadmap"]);
  });

  it("lets another admin send from their own mailbox, and sends the failed automatic emails again", async () => {
    const db = settingsDb();
    await request(setup({ rows: db.rows, mail: mailFakes({ status: null }).mail }).app).post("/a/settings/mail-sender").set("Origin", origin).send({})
      .expect(409, { error: "mail_grant_required" });
    await request(setup({ rows: db.rows, mail: mailFakes().mail }).app).post("/a/settings/retry-emails").set("Origin", origin).send({})
      .expect(409, { error: "mail_grant_required" });
    const { app } = setup({ rows: db.rows, mail: mailFakes().mail });
    expect((await request(app).post("/a/settings/mail-sender").set("Origin", origin).send({}).expect(200)).body.mail.sender).toMatchObject({ mine: true });
    expect(db.state.sender).toBe(ADMIN);
    const retried = await request(app).post("/a/settings/retry-emails").set("Origin", origin).send({}).expect(200);
    expect(retried.body.requeued).toBe(2);
    expect(db.state.requeuedFrom).toEqual([ADMIN]);
    await request(app).post("/a/settings/retry-emails").set("Origin", origin).send({ all: true }).expect(400, { error: "invalid_input" });
  });
});

/** A fake of Cài đặt thông báo's tables that keeps what was saved (made-up names and addresses). */
function settingsDb() {
  const state = {
    settings: new Map<string, { enabled: boolean; email: boolean }>(), saved: [] as unknown[][], cancelled: [] as unknown[],
    sender: null as string | null, requeuedFrom: [] as unknown[],
  };
  const rows: Rows = (text, params) => {
    if (text.startsWith("INSERT INTO ad_notification_settings")) {
      const [key, enabled, email] = params as [string, boolean | null, boolean | null];
      state.saved.push(params);
      const prior = state.settings.get(key) ?? { enabled: true, email: false };
      const nextEnabled = enabled ?? prior.enabled;
      const next = { enabled: nextEnabled, email: (email ?? prior.email) && nextEnabled };
      state.settings.set(key, next);
      return { rowCount: 1, rows: [{ email: next.email }] };
    }
    if (text.startsWith("SELECT s.setting,s.enabled")) {
      return { rowCount: state.settings.size, rows: [...state.settings].map(([setting, value]) => ({
        setting, ...value, updatedAt: new Date("2026-11-23T05:00:00Z"), updatedBy: "2374802010145 - Nguyễn Văn Cán Bộ - 71K29CNTT08" })) };
    }
    if (text.startsWith("SELECT (CASE WHEN e.kind")) return { rowCount: 1, rows: [{ setting: "roadmap", sent: 12, pending: 1, failed: 2, noAddress: 0 }] };
    if (text.startsWith("UPDATE stu_notification_emails SET status='cancelled'")) { state.cancelled.push(params[0]); return { rowCount: 0, rows: [] }; }
    if (text.startsWith("SELECT m.sender_id")) {
      return state.sender ? { rowCount: 1, rows: [{ userId: state.sender, name: "2374802010145 - Nguyễn Văn Cán Bộ - 71K29CNTT08", address: "can.bo@example.edu", lastError: null }] } : { rowCount: 0, rows: [] };
    }
    if (text.startsWith("INSERT INTO ad_notification_mail")) { state.sender = params[0] as string; return { rowCount: 1, rows: [] }; }
    if (text.startsWith("UPDATE stu_notification_emails SET status='pending',attempts=0")) { state.requeuedFrom.push(params[0]); return { rowCount: 2, rows: [] }; }
    return undefined;
  };
  return { state, rows };
}
