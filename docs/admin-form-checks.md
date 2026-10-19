# Kiểm tra thông tin nhập trong các form — 20/10/2026

Theo hai yêu cầu: "Ở các phần ràng buộc phải nhập thông tin thủ công hãy thêm thông báo" và "Thêm ràng buộc nhập Mô tả: tối đa bao nhiêu từ… để dư giả một xíu không gò bó quá".

## Thông báo dưới ô nhập

- Mọi form quản trị có ô bắt buộc (dấu *) dùng `CheckedForm` (`apps/web/src/CheckedForm.tsx`) thay cho `<form>`:
  - Nhóm năng lực; Cấu hình năng lực (thêm, sửa, xóa); Xóa liên kết của cả chương trình;
  - Lĩnh vực, Kỹ năng, Nghề nghiệp, Yêu cầu nghề nghiệp;
  - các form của Chương trình, Tốt nghiệp, Kế hoạch và Tài khoản.
- Khi bấm lưu mà còn ô chưa hợp lệ, form không gửi đi. Khi đó:
  - mỗi ô cần sửa có viền đỏ và một câu tiếng Việt ngay dưới ô;
  - con trỏ được đặt vào ô đầu tiên;
  - trình đọc màn hình đọc câu tóm tắt, ví dụ "Còn 2 thông tin cần nhập hoặc sửa. …".
- Sửa xong ô nào thì thông báo của ô đó mất ngay. Trước đây trình duyệt tự hiện bong bóng theo ngôn ngữ của trình duyệt, thường là tiếng Anh ("Please fill out this field").
- Các câu thông báo nằm trong `apps/web/src/form-checks.ts` (có test). Tên ô lấy từ nhãn của ô. Ví dụ:
  - "Vui lòng nhập tên nhóm năng lực." cho ô chữ, kể cả khi ô chỉ có dấu cách;
  - "Vui lòng chọn nhóm năng lực." cho ô chọn;
  - "Email chưa đúng định dạng, ví dụ ten@vlu.edu.vn.";
  - "Tổng tín chỉ quy định phải từ 1 đến 400.";
  - "Số tín chỉ phải là số nguyên.";
  - "Tên nhóm năng lực tối đa 160 ký tự.".
- Quy tắc của từng ô vẫn khai báo bằng thuộc tính HTML (`required`, `maxLength`, `min`, `max`, `type="email"`, `pattern`) hoặc bằng `setCustomValidity`. Server vẫn kiểm tra lại như cũ.
- Hai nút trước đây bị khóa mà không nói lý do nay bấm được và báo lý do:
  - "Lưu cấu hình năng lực" khi chưa nhập tên kỹ năng hoặc chưa chọn nhóm năng lực;
  - "Xóa liên kết" của cả chương trình khi mã khóa xác nhận sai ("Mã khóa chưa đúng: hãy nhập K30.").
- Ô tick xác nhận xóa vẫn khóa nút xóa như cũ.

## Giới hạn số từ của mô tả

| Ô | Giới hạn |
| --- | --- |
| Mô tả của Nhóm năng lực, Lĩnh vực, Kỹ năng; Mô tả kỹ năng chung của Cấu hình năng lực | 200 từ (vẫn tối đa 2.000 ký tự) |
| Phạm vi đánh giá (Cấu hình năng lực), Mô tả công việc (Nghề nghiệp), Mô tả của yêu cầu nghề nghiệp, kể cả khi lưu từ đề xuất AI | 400 từ (vẫn tối đa 4.000 ký tự) |

- Từ được đếm theo khoảng trắng như Word, nên "Kỹ năng" là 2 từ. Mô tả dài nhất đang dùng có khoảng 60 từ, nên giới hạn để dư khoảng 3 lần.
- Dưới ô mô tả có bộ đếm, ví dụ "12/200 từ". Quá giới hạn thì bộ đếm chuyển đỏ, và bấm lưu sẽ báo "Mô tả tối đa 200 từ (hiện có 215 từ).".
- API kiểm tra cùng giới hạn (`apps/api/src/word-limits.ts`). Vượt giới hạn thì API trả 400 như các dữ liệu sai khác.
- Mô tả học phần trong Chương trình chưa giới hạn số từ, vì nội dung lấy từ văn bản CTĐT chính thức qua file nhập.

## Kiểm thử

- Đơn vị: `apps/web/src/form-checks.test.ts`, `CheckedForm.test.tsx`, `apps/api/src/word-limits.test.ts`.
- Chạy thật trong trình duyệt (Edge headless, 20/10/2026) với form Thêm nhóm năng lực:
  - để trống: hiện 2 thông báo, con trỏ ở ô tên, form không gửi;
  - mô tả 215 từ: báo vượt 200 từ, form không gửi;
  - sửa xong: thông báo mất, form gửi được.
