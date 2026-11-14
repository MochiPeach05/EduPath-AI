// A cố vấn học tập or a Khoa admin working in a student's page confirms an action that replaces the student's results
// or choices and tells the student in the bell (QA 2026-11-07: "Đánh giá lại chạy ngay khi bấm … bấm nhầm là có hậu
// quả"; the specialty and the target vị trí nghề nghiệp, Kế hoạch học kỳ and Khảo sát nhanh since 2026-11-10). The
// student, in their own page, is not asked.
import { useLayoutEffect, useRef, type SyntheticEvent } from "react";
import "./student-records.css";

export function ActingConfirmDialog({ title, text, confirm, onClose, onConfirm }: {
  title: string; text: string; confirm: string; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal?.();
    return () => { element?.close?.(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="sr-confirm-dialog" aria-labelledby="acting-confirm-title" aria-describedby="acting-confirm-text"
    onCancel={(event: SyntheticEvent) => { event.preventDefault(); onClose(); }}>
    <h2 id="acting-confirm-title">{title}</h2>
    <p id="acting-confirm-text">{text}</p>
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" onClick={onClose} autoFocus>Hủy</button>
      <button type="button" className="sw-primary" onClick={onConfirm}>{confirm}</button>
    </div>
  </dialog>;
}

/** The words of the confirmation for Đánh giá năng lực (replace: the student already has a result). */
export const assessmentConfirm = (replace: boolean) => replace
  ? { title: "Đánh giá lại thay sinh viên", confirm: "Đánh giá lại",
    text: "Kết quả Đánh giá năng lực hiện tại của sinh viên sẽ được thay bằng kết quả mới, tính từ bảng điểm và hồ sơ hiện tại; nhận xét AI sẽ được viết lại. Sinh viên sẽ nhận thông báo trong chuông." }
  : { title: "Đánh giá năng lực thay sinh viên", confirm: "Đánh giá năng lực",
    text: "EduPath AI sẽ tính kết quả Đánh giá năng lực cho sinh viên từ bảng điểm và hồ sơ hiện tại. Sinh viên sẽ nhận thông báo trong chuông." };

/**
 * The words of the confirmation for the specialty and the target vị trí nghề nghiệp chosen for the student (user
 * 2026-11-10, policy 2026-11-10): what each becomes (null: none any more), left out when it does not change. confirm is
 * the label of the button. A new target re-assesses a student who has a result (plan "Một bước để bắt đầu", 2026-11-14);
 * a new specialty counts at the next Đánh giá lại.
 */
export function goalsConfirm({ specialty, career }: { specialty?: string | null; career?: string | null }, confirm = "Lưu thay đổi") {
  const both = specialty !== undefined && career !== undefined;
  const changes = [
    specialty === undefined ? null : specialty ? `Chuyên ngành của sinh viên sẽ là ${specialty}.` : "Sinh viên sẽ chưa có chuyên ngành.",
    career === undefined ? null : career ? `Vị trí nghề nghiệp mục tiêu của sinh viên sẽ là ${career}.` : "Sinh viên sẽ không còn vị trí nghề nghiệp mục tiêu.",
  ].filter(Boolean);
  const results = career !== undefined
    ? "Nếu sinh viên đã có kết quả Đánh giá năng lực, EduPath AI sẽ đánh giá lại theo lựa chọn mới."
    : "Kết quả Đánh giá năng lực đã có chỉ cập nhật theo chuyên ngành mới khi đánh giá lại.";
  return {
    title: both ? "Đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên"
      : specialty !== undefined ? "Đổi chuyên ngành thay sinh viên" : "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên",
    confirm,
    text: `${changes.join(" ")} ${results} Sinh viên sẽ nhận thông báo trong chuông.`,
  };
}

/**
 * The words of the confirmation before editing Kế hoạch học kỳ for the student (user 2026-11-10, policy 2026-11-10): asked
 * once per visit, since the plan saves after every change.
 */
export const planConfirm = {
  title: "Sửa Kế hoạch học kỳ thay sinh viên", confirm: "Sửa kế hoạch",
  text: "Mỗi thay đổi sau đó (thêm, bỏ, chuyển học phần, áp dụng hay bỏ qua đề xuất) được lưu ngay vào Kế hoạch học kỳ của sinh viên, như khi sinh viên tự sửa. Sinh viên sẽ nhận thông báo trong chuông.",
};

/** The words of the confirmation for Khảo sát nhanh saved for the student (replace: the student already has answers). */
export const surveyConfirm = (replace: boolean) => ({
  title: "Lưu Khảo sát nhanh thay sinh viên", confirm: "Lưu khảo sát",
  text: `${replace ? "Câu trả lời khảo sát hiện tại của sinh viên sẽ được thay bằng các câu trả lời này." : "Các câu trả lời này sẽ được lưu làm Khảo sát nhanh của sinh viên."} `
    + "EduPath AI sẽ dùng chúng cho Định hướng nghề nghiệp, Lộ trình AI và Trợ lý AI của sinh viên như khảo sát sinh viên tự làm. Sinh viên sẽ nhận thông báo trong chuông và có thể sửa lại.",
});

/** The words of the confirmation for Lộ trình AI (replace: the student already has a roadmap). */
export const roadmapConfirm = (replace: boolean) => ({
  title: "Tạo Lộ trình AI thay sinh viên", confirm: "Tạo lộ trình",
  text: replace
    ? "Lộ trình AI hiện tại của sinh viên sẽ được thay bằng lộ trình mới cho học kỳ tới. Sinh viên sẽ nhận thông báo trong chuông."
    : "EduPath AI sẽ soạn Lộ trình AI cho học kỳ tới của sinh viên. Sinh viên sẽ nhận thông báo trong chuông.",
});
