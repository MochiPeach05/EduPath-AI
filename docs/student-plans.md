# Xem kế hoạch đào tạo

Sinh viên mở **Kế hoạch đào tạo** ngay sau **Chương trình đào tạo** trong menu tài khoản hoặc menu bên trái (`/dashboard#plans`).

Trang hiển thị kế hoạch đang mở, gợi ý khi có đúng một kế hoạch cùng khóa hồ sơ. Sinh viên được chọn kế hoạch khác để tham khảo, tìm môn theo mã/tên và lọc năm học–học kỳ. Bảng trình bày tín chỉ, loại môn, nhóm học và điều kiện tiên quyết/học trước theo dữ liệu kế hoạch. Không dùng tổng tất cả lựa chọn để suy ra tín chỉ phải học.

API `/api/student/plans` và `/api/student/plans/:id` chỉ đọc, kiểm tra phiên đăng nhập và trạng thái tài khoản. Chỉ trả phiên bản hiện hành của kế hoạch đang mở; không trả lịch sử, token quản trị, file nguồn hoặc ô Excel. Không cần migration mới. Tải lại trang hoặc quay lại tab để nhận thay đổi từ quản trị viên. Đây là kế hoạch giảng dạy, không phải đăng ký học phần cá nhân.

**Khóa chưa có kế hoạch đào tạo (05/11/2026).** Khóa và ngành nào có CTĐT đang mở nhưng chưa có KHĐT (ví dụ K27) được thêm một mục "… (theo chương trình đào tạo)" (id `ctdt-<id CTĐT>`, `apps/api/src/plans/from-curriculum.ts`): học kỳ lấy từ năm học, học kỳ dự kiến của từng học phần trong CTĐT, môn chuyên ngành và môn tự chọn gom thành nhóm như KHĐT, môn không ghi học kỳ được đếm riêng. Khóa đã có KHĐT giữ nguyên KHĐT; sinh viên khóa chưa có KHĐT được gợi ý mục dựng từ CTĐT.
