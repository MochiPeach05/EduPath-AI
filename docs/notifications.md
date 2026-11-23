# Thông báo (STU-PROG-04…09) và thông báo của Khoa (AD-NOTI-01…06)

Người dùng (30/10/2026): thông báo gồm "AI đã chạy xong ở mục này…, thông báo trễ so với kế hoạch… và nhiều thông báo khác nữa"; Khoa gửi được thông báo, "tương lai sẽ làm thêm chức năng gửi về mail thật của sinh viên luôn nữa cơ mà không phải hiện tại"; bỏ chức năng tìm kiếm thông báo, gộp vào lọc; thông báo chỉ ở chuông.

## Dữ liệu (migration 056)
- `stu_notifications`: một dòng mỗi thông báo của một sinh viên: `type` (ai, warn, khoa, sys), `kind`, tiêu đề, nội dung, trang liên quan (`#page`) và nhãn nút, `source_key` (duy nhất theo sinh viên: mỗi sự kiện chỉ báo một lần), `announcement_id`, `read_at`, `deleted_at`.
- `ad_announcements`: thông báo Khoa gửi: tiêu đề, nội dung, trang liên quan, đối tượng `{cohorts, majors}` (mã chương trình), số người nhận, người gửi, `withdrawn_at`.
- Migration 066 (23/11/2026, email và cài đặt): `ad_announcements` thêm `email_requested`, `email_sender_id`, `email_from`; `ad_mail_senders` (quyền gửi thư của từng cán bộ, token cache của MSAL đã mã hóa AES-256-GCM bằng khóa suy ra từ `SESSION_SECRET`, `last_error`); `ad_announcement_emails` (mỗi sinh viên nhận một dòng: địa chỉ, trạng thái `pending`/`sending`/`sent`/`failed`/`cancelled`/`no_address`, số lần thử, mã lỗi); `ad_notification_settings` (loại thông báo tự động bị tắt).
- Migration 067 (23/11/2026, email của thông báo tự động): `ad_notification_settings.email_enabled` và khóa `advisor_action` (chuông luôn bật, chỉ đổi email); `ad_notification_mail` (một dòng: hộp thư của ai gửi email tự động); `stu_notification_emails` (mỗi thông báo tự động được gửi email một dòng: loại, người gửi, địa chỉ, trạng thái, số lần thử, mã lỗi).
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
| advisor_action | Cố vấn học tập hoặc cán bộ Khoa làm thay sinh viên | trang liên quan |

Cài đặt thông báo (AD-NOTI-06, 23/11/2026, `apps/api/src/notifications/settings.ts`; email theo từng loại thêm cùng tối, xem mục "Email của thông báo tự động"): quản trị viên tắt được 6 loại thông báo tự động (Đọc bảng điểm, Nhận xét năng lực của AI, Lộ trình AI, Nhận xét xét tốt nghiệp của AI, Cảnh báo chậm tiến độ, Khoa cập nhật dữ liệu học tập). `notify()` và `notifyMany()` bỏ qua loại đang tắt ngay trong câu INSERT; tắt chỉ dừng thông báo mới, thông báo đã có vẫn giữ. Thông báo của Khoa và thông báo việc làm thay luôn được ghi (chính sách hứa báo cho sinh viên mỗi khi có người làm thay).

Thông báo được ghi trong cùng giao dịch với công việc khi có thể; lỗi ghi thông báo chỉ được ghi log, không làm hỏng công việc. Câu trả lời của Trợ lý AI không tạo thông báo.

## API sinh viên `/api/student/notifications`
Hợp đồng: `apps/web/src/notification-types.ts`. Danh sách (lọc: tất cả, chưa đọc, Kết quả AI, Cảnh báo, Từ Khoa, Hệ thống), số chưa đọc (chuông đọc lại mỗi 60 giây và khi quay lại tab), đánh dấu đã đọc, chưa đọc, tất cả đã đọc, xóa (xóa mềm) và hoàn tác trong 10 phút.

Mỗi chủ đề chỉ hiện một thông báo, bản mới nhất (`NOTIFICATION_TOPIC` trong `model.ts`, sửa 30/10 sau khi người dùng thấy chuông báo 5 chưa đọc mà danh sách có 2 cặp trùng): mỗi lần đọc bảng điểm, nhận xét năng lực, Lộ trình AI hay tư vấn tốt nghiệp mới thay bản trước; cập nhật danh mục thay bản trước của cùng danh mục và khóa; cảnh báo và thông báo của Khoa chỉ gộp khi trùng cả tiêu đề lẫn nội dung. Số chưa đọc đếm đúng các dòng đó, và khung chuông đưa thông báo chưa đọc lên đầu (`order=unread`), nên số trên chuông luôn bằng số mục chưa đọc. Cảnh báo mới mang tên môn hoặc nhóm trong tiêu đề ("Môn bắt buộc chưa đạt: …").

## Lưu trữ
- Thông báo tự xóa sau 90 ngày; thông báo đã xóa bị xóa hẳn sau 1 ngày, riêng cảnh báo đã xóa được giữ ẩn tới hết 90 ngày để không báo lại.
- Dọn dẹp chạy tối đa mỗi giờ một lần, khi chuông đọc số chưa đọc.
- Chính sách bảo mật chưa nhắc thông báo và thời gian lưu 90 ngày: cần người dùng duyệt nội dung bổ sung.
- Dòng email của thông báo (địa chỉ nhận và kết quả gửi) bị xóa sau 90 ngày, cùng lúc dọn thông báo; chính sách 2026-11-23 có ghi thời gian này.

## Khoa gửi thông báo `/api/admin/announcements`
- Chọn đối tượng theo khóa và ngành (danh sách từ hồ sơ sinh viên), xem trước số người nhận, tiêu đề tối đa 120 ký tự, nội dung tối đa 1000 ký tự, trang liên quan.
- Gửi: một giao dịch ghi thông báo của Khoa và thông báo cho từng sinh viên nhận (tài khoản sinh viên đang hoạt động, trừ hộp thư cán bộ).
- Danh sách đã gửi có số đã đọc trên số nhận, sắp xếp theo cột; Thu hồi gỡ thông báo khỏi chuông của mọi sinh viên.
- Kênh email (AD-NOTI-04/05, 23/11/2026): xem mục "Email của thông báo" bên dưới.

## Email qua Microsoft Graph: bước thử (23/11/2026)
Người dùng chọn cách A (gửi từ hộp thư trường của người bấm Gửi, qua Microsoft Graph) và yêu cầu "Trước tiên làm bước thử đã đi". Nhóm chưa vào được trang đăng ký app trên Microsoft Entra, nên quyền `Mail.Send` (dạng Delegated) được xin lúc chạy (incremental consent), không cần sửa app.
- Render gói free chặn cổng SMTP (25, 465, 587) từ 26/9/2025, nên thư đi qua HTTPS: `POST https://graph.microsoft.com/v1.0/me/sendMail`, `saveToSentItems: false` (`apps/api/src/mail/graph-mail.ts`).
- Nút "Gửi email thử cho chính tôi" ở mục Kênh gửi của trang Gửi thông báo, chỉ cho tài khoản gửi được thông báo (không cho cố vấn học tập và sinh viên). `POST /api/auth/microsoft/mail-consent` tạo state, nonce và PKCE, lưu vào `session.mailConsent`, trả địa chỉ trang xin quyền của Microsoft trên tenant của chính tài khoản đó, có gợi ý tài khoản (UPN).
- Microsoft trả về địa chỉ callback đăng nhập sẵn có `/api/auth/microsoft/callback`; state trùng `session.mailConsent` thì đi nhánh email, không đụng phiên đăng nhập. Máy chủ đổi mã lấy token bằng một MSAL client mới (`apps/api/src/auth/mail-consent-client.ts`), kiểm tra nonce và đúng tài khoản đang đăng nhập, gửi một thư vào hộp thư của chính người đó rồi bỏ token: không lưu quyền, không gửi gì cho sinh viên.
- Kết quả về trang `/quantri/gui-thong-bao?emailTest=…`: `sent`, `denied` (Hủy, hoặc trường bắt quản trị viên phê duyệt; kèm mã AADSTS), `other_account`, `send_failed` (kèm mã lỗi của Graph), `expired` (quá 10 phút), `signed_out`, `failed`. Trang hiện kết quả một lần rồi xóa tham số khỏi địa chỉ.
- Giới hạn của Exchange Online cho mỗi hộp thư: 10.000 người nhận một ngày, 30 thư một phút.
- Thử thật trên production ngày 23/11/2026: trang Microsoft có nút Chấp nhận (trường cho người dùng tự đồng ý quyền này) và thư đến hộp thư Focused.

## Email của thông báo (AD-NOTI-04, 05; 23/11/2026)
Người dùng duyệt: "Làm cả 04, 05, 06", "Chỉ sinh viên đã có tài khoản", "Cập nhật, không hỏi lại" (chính sách 2026-11-23 thêm dòng email, không hỏi lại sự đồng ý), "Dùng mặc định".
- Cho phép một lần: nút "Cho phép gửi từ hộp thư của tôi" (mục Kênh gửi) chạy luồng xin quyền ở trên; sau khi Microsoft cấp, máy chủ lưu token cache của MSAL đã mã hóa vào `ad_mail_senders` (`apps/api/src/mail/grants.ts`, `grant-crypto.ts`) rồi gửi một thư thử cho chính người đó. Sau đó trang có ô "Email trường của sinh viên", nút "Gửi email thử cho chính tôi" (gửi bản đang soạn nếu đã có tiêu đề và nội dung, `POST /mail-sender/test`) và "Thu hồi quyền" (`DELETE /mail-sender`, xóa quyền đã lưu; quyền ở Microsoft vẫn còn trong mục ứng dụng của tài khoản).
- Gửi: `POST /api/admin/announcements` với `email: true` (chỉ khi người gửi có quyền dùng được, nếu không trả 409 `mail_grant_required`); cùng giao dịch ghi thông báo, đánh dấu `email_requested` và xếp một dòng `ad_announcement_emails` cho mỗi sinh viên nhận (`apps/api/src/mail/outbox.ts`). Địa chỉ là email của tài khoản, không có thì UPN nếu là địa chỉ; tài khoản không có địa chỉ ghi `no_address`.
- Worker (`apps/api/src/mail/worker.ts`) chạy trong tiến trình API mỗi 15 giây: lấy token mới bằng `acquireTokenSilent` (lưu lại cache khi đổi), mỗi người gửi tối đa 6 thư một lượt (khoảng 24 thư mỗi phút, dưới giới hạn 30 của Exchange), mỗi sinh viên một thư riêng (`apps/api/src/mail/messages.ts`: tiêu đề "[EduPath AI] …", lời chào theo tên, nội dung, nút mở trang liên quan), không lưu vào Sent Items, trả lời đi về người gửi.
- Lỗi tạm (mạng, 401, 408, 429, 5xx) thử lại sau 1, 5 rồi 15 phút, tối đa 4 lần; lỗi khác ghi `failed` kèm mã của Microsoft. Microsoft đòi cho phép lại (`grant_required`) thì mọi thư đến hạn của người gửi chuyển `failed` và trang Gửi thông báo hiện nút "Cho phép lại". Thư kẹt ở `sending` quá 10 phút (máy chủ tắt giữa chừng) quay lại hàng đợi; thông báo mà tài khoản người gửi không còn thì thư chuyển `failed` (`sender_missing`).
- Hàng đợi nằm trong cơ sở dữ liệu: Render gói free ngủ sau 15 phút không có truy cập, thư còn lại được gửi tiếp khi máy chủ thức (trang Đã gửi tự đọc lại mỗi 30 giây nên giữ máy chủ thức khi đang mở).
- Đã gửi (AD-NOTI-05): cột Email (đã gửi trên số có địa chỉ, đang gửi, lỗi, chưa có email, đã hủy), chi tiết liệt kê thư không đi được và lý do (`GET /:id/emails`), "Gửi lại thư lỗi" xếp lại thư lỗi từ hộp thư của người bấm (`POST /:id/emails/retry`). Thu hồi thông báo hủy các thư chưa gửi; thư đã gửi không thu hồi được.
- Nhật ký thao tác ghi: gửi thông báo "(kèm email)", gửi email thử, thu hồi quyền gửi email, gửi lại email lỗi, cập nhật cài đặt thông báo.
- Không thử với sinh viên thật: kiểm tra bằng "Gửi email thử cho chính tôi".

## Email của thông báo tự động (Cài đặt thông báo, tối 23/11/2026)
Người dùng: "Phần cài đặt thông báo thêm 1 chức năng nữa ngoài có thể cập nhật thông báo cho thông báo ở trang sinh viên thì có thể gửi tới email những thông báo này nữa".
- Trang Cài đặt thông báo có hai cột công tắc: Trong EduPath AI (chuông) và Email, cho 6 loại thông báo tự động và "Việc làm thay sinh viên" (chuông luôn bật, chỉ bật/tắt email). "Thông báo của Khoa" ghi "Chọn khi gửi" vì email chọn ở trang Gửi thông báo. Email mặc định tắt; bật email có hộp xác nhận; tắt chuông thì email cũng tắt; tắt email hủy các thư chưa gửi của loại đó.
- Hộp thư gửi: một hộp thư cho mọi email tự động (`ad_notification_mail`), là hộp thư của quản trị viên bật email đầu tiên khi chưa có hộp thư dùng được, hoặc của người bấm "Dùng hộp thư của tôi" (thư đang chờ chuyển sang hộp thư mới). Cần quyền Mail.Send đã lưu của người đó; nút "Cho phép gửi từ hộp thư của tôi" ở trang này xin quyền rồi quay về đúng trang (`POST /api/auth/microsoft/mail-consent` với `{ page: "settings" }`). Microsoft đòi cho phép lại thì khung "Email thông báo tự động" báo vàng và có nút "Cho phép lại" / "Dùng hộp thư của tôi".
- Xếp thư: `notify()` và `notifyMany()` sau khi ghi thông báo mới chạy thêm một câu INSERT vào `stu_notification_emails` cho những dòng vừa ghi, chỉ khi loại đó bật email và đã có hộp thư gửi (`apps/api/src/mail/notification-outbox.ts`); thông báo trùng source_key không ghi lại nên không gửi email lần hai; thông báo của Khoa không đi đường này.
- Worker dùng chung với email thông báo của Khoa: mỗi hộp thư tối đa 6 thư một lượt 15 giây cho cả hai hàng đợi (thông báo của Khoa trước), thử lại và báo lỗi như trên; dọn hàng đợi mỗi phút: thông báo sinh viên đã xóa thì hủy thư, không còn người gửi thì `sender_missing`.
- Thư tự động (`notificationMailMessage`): tiêu đề "[EduPath AI] <tiêu đề thông báo>", lời chào, nội dung, nút như trong chuông ("Mở Lộ trình học tập trên EduPath AI"), dòng cuối ghi thư do EduPath AI gửi tự động.
- Kết quả (AD-NOTI-05): mỗi loại ghi số email 30 ngày qua (đã gửi, đang gửi, lỗi, chưa có email); khung trên có tổng và nút "Gửi lại email lỗi (N)" (`POST /settings/retry-emails`, từ hộp thư đang gửi). Dòng email bị xóa sau 90 ngày cùng lúc dọn thông báo.
- Chính sách 2026-11-23 sửa cùng bản (không hỏi lại): mục đích gửi thông báo của Khoa và các loại thông báo tự động Khoa bật gửi email; thư không lưu trong Thư đã gửi của cán bộ, thư trả lời về hộp thư đó.

## Giao diện
- Sinh viên: chuông trên thanh đầu trang (`StudentNotifications.tsx`): số chưa đọc, 5 thông báo mới nhất, "Xem tất cả" mở danh sách đầy đủ có lọc, chi tiết, đánh dấu, xóa và hoàn tác.
- Quản trị: nhóm Quản lý thông báo của menu quản trị (`AnnouncementsManagement.tsx`): Gửi thông báo, Đã gửi, Cài đặt thông báo (`/quantri/cai-dat-thong-bao`: khung Email thông báo tự động, công tắc Trong EduPath AI và Email cho từng loại; chuông của Việc làm thay sinh viên và Thông báo của Khoa hiện "Luôn bật").
