# Thông báo (STU-PROG-04…09) và thông báo của Khoa (AD-NOTI-01, 02)

Người dùng (30/10/2026): thông báo gồm "AI đã chạy xong ở mục này…, thông báo trễ so với kế hoạch… và nhiều thông báo khác nữa"; Khoa gửi được thông báo, "tương lai sẽ làm thêm chức năng gửi về mail thật của sinh viên luôn nữa cơ mà không phải hiện tại"; bỏ chức năng tìm kiếm thông báo, gộp vào lọc; thông báo chỉ ở chuông.

## Dữ liệu (migration 056)
- `stu_notifications`: một dòng mỗi thông báo của một sinh viên: `type` (ai, warn, khoa, sys), `kind`, tiêu đề, nội dung, trang liên quan (`#page`) và nhãn nút, `source_key` (duy nhất theo sinh viên: mỗi sự kiện chỉ báo một lần), `announcement_id`, `read_at`, `deleted_at`.
- `ad_announcements`: thông báo Khoa gửi: tiêu đề, nội dung, trang liên quan, đối tượng `{cohorts, majors}` (mã chương trình), số người nhận, người gửi, `withdrawn_at`.
- Migration chạy tự động khi Render khởi động (`DATABASE_AUTO_MIGRATE`).

## Ai tạo thông báo (`apps/api/src/notifications/notify.ts`)
| Kind | Khi nào | Mở trang |
| --- | --- | --- |
| transcript_ready / transcript_failed | Bảng điểm PDF đọc xong hoặc lỗi (worker OCR, quá hạn) | Hồ sơ và bảng điểm |
| assessment_comment | Nhận xét AI của Đánh giá năng lực xong | Đánh giá năng lực |
| roadmap_ready / roadmap_failed | Lộ trình AI soạn xong hoặc lỗi | Lộ trình học tập |
| graduation_advice | Lời khuyên xét tốt nghiệp xong | Điều kiện xét tốt nghiệp |
| warning | Một mục mới của "Cảnh báo chậm tiến độ" (`docs/student-overview.md`) | theo mục |
| catalog_updated | Khoa đổi bản hiện hành của CTĐT, KHĐT hoặc tiêu chuẩn xét tốt nghiệp của khóa và ngành sinh viên (nhắc Đánh giá lại) | Đánh giá năng lực |
| announcement | Khoa gửi (AD-NOTI-01) | trang Khoa chọn |

Thông báo được ghi trong cùng giao dịch với công việc khi có thể; lỗi ghi thông báo chỉ được ghi log, không làm hỏng công việc. Câu trả lời của Trợ lý AI không tạo thông báo.

## API sinh viên `/api/student/notifications`
Hợp đồng: `apps/web/src/notification-types.ts`. Danh sách (lọc: tất cả, chưa đọc, Kết quả AI, Cảnh báo, Từ Khoa, Hệ thống), số chưa đọc (chuông đọc lại mỗi 60 giây và khi quay lại tab), đánh dấu đã đọc, chưa đọc, tất cả đã đọc, xóa (xóa mềm) và hoàn tác trong 10 phút.

Mỗi chủ đề chỉ hiện một thông báo, bản mới nhất (`NOTIFICATION_TOPIC` trong `model.ts`, sửa 30/10 sau khi người dùng thấy chuông báo 5 chưa đọc mà danh sách có 2 cặp trùng): mỗi lần đọc bảng điểm, nhận xét năng lực, Lộ trình AI hay tư vấn tốt nghiệp mới thay bản trước; cập nhật danh mục thay bản trước của cùng danh mục và khóa; cảnh báo và thông báo của Khoa chỉ gộp khi trùng cả tiêu đề lẫn nội dung. Số chưa đọc đếm đúng các dòng đó, và khung chuông đưa thông báo chưa đọc lên đầu (`order=unread`), nên số trên chuông luôn bằng số mục chưa đọc. Cảnh báo mới mang tên môn hoặc nhóm trong tiêu đề ("Môn bắt buộc chưa đạt: …").

## Lưu trữ
- Thông báo tự xóa sau 90 ngày; thông báo đã xóa bị xóa hẳn sau 1 ngày, riêng cảnh báo đã xóa được giữ ẩn tới hết 90 ngày để không báo lại.
- Dọn dẹp chạy tối đa mỗi giờ một lần, khi chuông đọc số chưa đọc.
- Chính sách bảo mật chưa nhắc thông báo và thời gian lưu 90 ngày: cần người dùng duyệt nội dung bổ sung.

## Khoa gửi thông báo `/api/admin/announcements`
- Chọn đối tượng theo khóa và ngành (danh sách từ hồ sơ sinh viên), xem trước số người nhận, tiêu đề tối đa 120 ký tự, nội dung tối đa 1000 ký tự, trang liên quan.
- Gửi: một giao dịch ghi thông báo của Khoa và thông báo cho từng sinh viên nhận (tài khoản sinh viên đang hoạt động, trừ hộp thư cán bộ).
- Danh sách đã gửi có số đã đọc trên số nhận, sắp xếp theo cột; Thu hồi gỡ thông báo khỏi chuông của mọi sinh viên.
- Kênh email: để sau (ô "Email sinh viên" trên trang hiện là "Sắp có").

## Giao diện
- Sinh viên: chuông trên thanh đầu trang (`StudentNotifications.tsx`): số chưa đọc, 5 thông báo mới nhất, "Xem tất cả" mở danh sách đầy đủ có lọc, chi tiết, đánh dấu, xóa và hoàn tác.
- Quản trị: trang Gửi thông báo (`AnnouncementsManagement.tsx`) trong nhóm Thông báo của menu quản trị.
