// What a student receives by email (2026-11-23): an announcement the faculty sends with email (AD-NOTI-04; defaults the
// user approved: "[EduPath AI] <tiêu đề>", one message per student, replies go to the sender's mailbox), and an automatic
// notification whose email an admin turned on in Cài đặt thông báo. The message holds the notification's title and text, a
// greeting by name and a button to EduPath AI: nothing else about the student.
import { PORTAL_PAGES, isPortalPage } from "../notifications/model.js";
import { escapeHtml, type MailMessage } from "./graph-mail.js";

export type AnnouncementMail = {
  to: string; name: string | null; title: string; body: string; link: string | null;
  /** Sent under EduPath AI's name (migration 068): the last line says so instead of naming the Khoa. */
  sender?: "khoa" | "edupath" | undefined;
};
/** An automatic notification: its button's label too ("Mở Lộ trình học tập"), as the bell shows it. */
export type NotificationMail = AnnouncementMail & { linkLabel: string | null };

/** The subject every email carries. */
export const announcementSubject = (title: string) => `[EduPath AI] ${title.replace(/\s+/g, " ").trim()}`;

/** The text as paragraphs: a blank line starts a new one, a single line break stays a line break. */
function paragraphs(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    .map((part) => escapeHtml(part).replace(/\n/g, "<br>"));
}

function message(mail: AnnouncementMail, button: (link: string) => string, footer: string, webOrigin: string): MailMessage {
  const link = isPortalPage(mail.link) ? mail.link : null;
  const target = new URL(`/dashboard${link ?? ""}`, `${webOrigin}/`).toString();
  const label = link ? button(link) : "Mở EduPath AI";
  const paragraph = (html: string) => `<p style="margin:0 0 12px">${html}</p>`;
  return {
    to: mail.to,
    subject: announcementSubject(mail.title),
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2330">
${mail.name ? paragraph(`Chào ${escapeHtml(mail.name)},`) : ""}
${paragraphs(mail.body).map(paragraph).join("\n")}
<p style="margin:18px 0"><a href="${escapeHtml(target)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#b51639;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="margin:16px 0 0;color:#667085;font-size:12px">${escapeHtml(footer)}</p>
</div>`,
  };
}

/** The last line of an announcement's email, by whose name it was sent under. */
export const announcementFooter = (sender: AnnouncementMail["sender"]) => (sender === "edupath"
  ? "Thông báo do EduPath AI gửi. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI."
  : "Thông báo của Khoa Công nghệ Thông tin, Trường Đại học Văn Lang, gửi qua EduPath AI. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.");

export function announcementMailMessage(mail: AnnouncementMail, webOrigin: string): MailMessage {
  return message(mail, (link) => `Mở ${PORTAL_PAGES[link]} trên EduPath AI`, announcementFooter(mail.sender), webOrigin);
}

/** An automatic notification: the bell's own button, then "trên EduPath AI" ("Mở Lộ trình học tập trên EduPath AI"). */
export function notificationMailMessage(mail: NotificationMail, webOrigin: string): MailMessage {
  return message(mail, (link) => `${mail.linkLabel?.trim() || `Mở ${PORTAL_PAGES[link]}`} trên EduPath AI`,
    "Thư này do EduPath AI gửi tự động khi bạn có thông báo mới; Khoa Công nghệ Thông tin chọn những loại thông báo được gửi qua email. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.",
    webOrigin);
}
