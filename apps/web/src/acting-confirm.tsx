// A cố vấn học tập or a Khoa admin working in a student's page confirms an action that replaces the student's results
// and tells the student in the bell (QA 2026-11-07: "Đánh giá lại chạy ngay khi bấm … bấm nhầm là có hậu quả").
// The student, in their own page, is not asked.
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

/** The words of the confirmation for Lộ trình AI (replace: the student already has a roadmap). */
export const roadmapConfirm = (replace: boolean) => ({
  title: "Tạo Lộ trình AI thay sinh viên", confirm: "Tạo lộ trình",
  text: replace
    ? "Lộ trình AI hiện tại của sinh viên sẽ được thay bằng lộ trình mới cho học kỳ tới. Sinh viên sẽ nhận thông báo trong chuông."
    : "EduPath AI sẽ soạn Lộ trình AI cho học kỳ tới của sinh viên. Sinh viên sẽ nhận thông báo trong chuông.",
});
