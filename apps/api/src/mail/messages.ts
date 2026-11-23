// What a student receives by email when the faculty sends an announcement with email (AD-NOTI-04, 2026-11-23; defaults
// the user approved: "[EduPath AI] <tiêu đề>", one message per student, replies go to the sender's mailbox). The message
// holds the announcement's title and text, a greeting by name and a button to EduPath AI: nothing else about the student.
import { PORTAL_PAGES, isPortalPage } from "../notifications/model.js";
import { escapeHtml, type MailMessage } from "./graph-mail.js";

export type AnnouncementMail = { to: string; name: string | null; title: string; body: string; link: string | null };

/** The subject every announcement email carries. */
export const announcementSubject = (title: string) => `[EduPath AI] ${title.replace(/\s+/g, " ").trim()}`;

/** The text as paragraphs: a blank line starts a new one, a single line break stays a line break. */
function paragraphs(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    .map((part) => escapeHtml(part).replace(/\n/g, "<br>"));
}

export function announcementMailMessage(mail: AnnouncementMail, webOrigin: string): MailMessage {
  const link = isPortalPage(mail.link) ? mail.link : null;
  const target = new URL(`/dashboard${link ?? ""}`, `${webOrigin}/`).toString();
  const button = link ? `Mở ${PORTAL_PAGES[link]} trên EduPath AI` : "Mở EduPath AI";
  const paragraph = (html: string) => `<p style="margin:0 0 12px">${html}</p>`;
  return {
    to: mail.to,
    subject: announcementSubject(mail.title),
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2330">
${mail.name ? paragraph(`Chào ${escapeHtml(mail.name)},`) : ""}
${paragraphs(mail.body).map(paragraph).join("\n")}
<p style="margin:18px 0"><a href="${escapeHtml(target)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#b51639;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="margin:16px 0 0;color:#667085;font-size:12px">Thông báo của Khoa Công nghệ Thông tin, Trường Đại học Văn Lang, gửi qua EduPath AI. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.</p>
</div>`,
  };
}
