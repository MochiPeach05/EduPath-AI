// Gửi email qua Microsoft Graph (AD-NOTI-04; bước thử 2026-11-23, người dùng: "Trước tiên làm bước thử đã đi"). A message
// leaves from the mailbox of the signed-in staff member, with the delegated Mail.Send permission they grant on Microsoft's
// consent page (auth/mail-consent-client.ts). Render's free plan blocks the SMTP ports, so mail goes over HTTPS only.
// Graph answers 202 without a body once Exchange accepts the message; a later delivery failure comes back to the
// sender's mailbox as a bounce, never here.

export const GRAPH_SEND_MAIL = "https://graph.microsoft.com/v1.0/me/sendMail";

export type MailMessage = { to: string; subject: string; html: string };
/** code: Graph's error code ("ErrorAccessDenied", "MailboxNotEnabledForRESTAPI"…), "http_<status>" or "network_error". */
export type MailResult = { ok: true } | { ok: false; status: number; code: string };
export type SendMail = (accessToken: string, message: MailMessage) => Promise<MailResult>;

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,80}$/;

/** POST /me/sendMail. saveToSentItems is off so a message to a whole cohort does not fill the sender's Sent Items. */
export async function sendGraphMail(accessToken: string, message: MailMessage, fetchImpl: typeof fetch = fetch): Promise<MailResult> {
  let response: Response;
  try {
    response = await fetchImpl(GRAPH_SEND_MAIL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body: { contentType: "HTML", content: message.html },
          toRecipients: [{ emailAddress: { address: message.to } }],
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, status: 0, code: "network_error" };
  }
  if (response.status === 202) return { ok: true };
  const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
  const code = body?.error?.code;
  return { ok: false, status: response.status, code: typeof code === "string" && SAFE_CODE.test(code) ? code : `http_${response.status}` };
}

/** Text made safe inside HTML. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** "09:15 23/11/2026" in Vietnam time, as every page writes a moment. */
export function vietnamTime(at: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hourCycle: "h23",
  }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}

/**
 * The message of the test step: from the staff member's school mailbox to that same mailbox, saying what it proves.
 * It carries no student data.
 */
export function testMailMessage(to: string, name: string, sentAt: Date, webOrigin: string): MailMessage {
  const page = new URL("/quantri/gui-thong-bao", `${webOrigin}/`).toString();
  const paragraph = (text: string) => `<p style="margin:0 0 12px">${text}</p>`;
  return {
    to,
    subject: "[EduPath AI] Thư thử gửi thông báo qua email",
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2330">
${paragraph(`Chào ${escapeHtml(name)},`)}
${paragraph(`Đây là thư thử của EduPath AI, gửi lúc ${vietnamTime(sentAt)} từ hộp thư trường của bạn đến chính bạn.`)}
${paragraph("Bạn nhận được thư này nghĩa là EduPath AI gửi được email bằng quyền gửi thư bạn vừa cấp trên trang Microsoft. Chưa có thư nào được gửi đến sinh viên.")}
${paragraph(`<a href="${escapeHtml(page)}" style="color:#b51639;font-weight:700">Mở trang Gửi thông báo</a>`)}
<p style="margin:16px 0 0;color:#667085;font-size:12px">Thư tự động từ EduPath AI · Khoa Công nghệ Thông tin, Trường Đại học Văn Lang.</p>
</div>`,
  };
}
