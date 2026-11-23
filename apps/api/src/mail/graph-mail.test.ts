import { describe, expect, it, vi } from "vitest";
import { GRAPH_SEND_MAIL, sendGraphMail, testMailMessage, vietnamTime } from "./graph-mail.js";

// Microsoft Graph is never called: fetch is a fake. Made-up addresses only.
const message = { to: "nguoi.gui@example.edu", subject: "Tiêu đề", html: "<p>Nội dung</p>" };

describe("sending mail through Microsoft Graph (AD-NOTI-04, 2026-11-23)", () => {
  it("posts one message to /me/sendMail and keeps no copy in Sent Items", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 202 }));
    expect(await sendGraphMail("graph-token", message, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(GRAPH_SEND_MAIL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer graph-token", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      message: { subject: "Tiêu đề", body: { contentType: "HTML", content: "<p>Nội dung</p>" }, toRecipients: [{ emailAddress: { address: "nguoi.gui@example.edu" } }] },
      saveToSentItems: false,
    });
  });

  it("names a refusal by Graph's own code, or by the status when there is none", async () => {
    const answer = (status: number, body: string | null) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await sendGraphMail("t", message, answer(403, JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }))))
      .toEqual({ ok: false, status: 403, code: "ErrorAccessDenied" });
    expect(await sendGraphMail("t", message, answer(404, JSON.stringify({ error: { code: "MailboxNotEnabledForRESTAPI" } }))))
      .toEqual({ ok: false, status: 404, code: "MailboxNotEnabledForRESTAPI" });
    expect(await sendGraphMail("t", message, answer(500, "<html>busy</html>"))).toEqual({ ok: false, status: 500, code: "http_500" });
    // A code that could carry anything else is not passed on.
    expect(await sendGraphMail("t", message, answer(400, JSON.stringify({ error: { code: "bad code <script>" } }))))
      .toEqual({ ok: false, status: 400, code: "http_400" });
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await sendGraphMail("t", message, offline)).toEqual({ ok: false, status: 0, code: "network_error" });
  });

  it("writes the test message in Vietnam time, with the name escaped and a link back to the page", () => {
    const test = testMailMessage("nguoi.gui@example.edu", "Nguyễn <Văn> A", new Date("2026-11-23T02:15:00Z"), "https://edupath.example");
    expect(test.to).toBe("nguoi.gui@example.edu");
    expect(test.subject).toBe("[EduPath AI] Thư thử gửi thông báo qua email");
    expect(test.html).toContain("Chào Nguyễn &#60;Văn&#62; A,");
    expect(test.html).toContain("gửi lúc 09:15 23/11/2026 từ hộp thư trường của bạn đến chính bạn.");
    expect(test.html).toContain("Chưa có thư nào được gửi đến sinh viên.");
    expect(test.html).toContain('href="https://edupath.example/quantri/gui-thong-bao"');
    expect(vietnamTime(new Date("2026-12-31T17:05:00Z"))).toBe("00:05 01/01/2027");
  });
});
