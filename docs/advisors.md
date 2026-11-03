# Cố vấn học tập (AD-ADV-01…05, AD-AST-01…09)

Người dùng (03/11/2026): "Giờ làm phần nhóm chức năng quản lý cố vấn học tập này đi và sửa lại các phần tác nhân của CVHT theo trong file function list" (`requirements/Nhom1_DanhSachChucNang_ver0.3 (1).xlsx`, không commit). Tác nhân trong file:
- "QTV & CVHT": cố vấn học tập (CVHT) được xem;
- "Quản trị viên": chỉ quản trị viên được thay đổi;
- "Cố vấn học tập": chức năng của CVHT với lớp mình phụ trách.

Ba quyết định của người dùng:
- CVHT được làm thay sinh viên: import bảng điểm; đánh giá năng lực (gồm đánh giá lại và nhận xét AI); Lộ trình AI và lời khuyên xét tốt nghiệp; hỏi Trợ lý AI. CVHT không chọn chuyên ngành, vị trí nghề nghiệp mục tiêu và không sửa Kế hoạch học kỳ thay sinh viên.
- Sinh viên chưa đồng ý thì CVHT vẫn làm thay được ("Cho làm, báo sinh viên"). Hệ thống không ghi là sinh viên đã đồng ý, mà ghi nhật ký và gửi thông báo vào chuông của sinh viên.
- Chính sách bảo mật cập nhật luôn, không hỏi lại sinh viên (bản 2026-11-03).

## Vai trò và quyền
- **Vai trò `advisor` (Cố vấn học tập), migration 058.** Vào được cổng quản trị và chỉ xem. `advisorReadOnly` (`apps/api/src/advisors/access.ts`) chặn mọi thao tác ghi, trừ `POST /api/admin/advisor-portal/students/:id/open`. CVHT không đọc được Báo cáo, Nhật ký, Tài khoản và Thông báo.
- **Ai quản lý danh sách CVHT** (thêm, sửa, xóa, import): quản trị viên và Ban chủ nhiệm khoa (`canManageAdvisors`). Mọi vai trò của cổng quản trị đều xem được danh sách.
- **Chức năng của CVHT** (Lớp phụ trách, Mở trang sinh viên, làm thay) dùng được với mọi tài khoản cổng quản trị có lớp trong `ad_advisor_classes`. Vì vậy quản trị viên, Ban chủ nhiệm khoa hay Trưởng bộ môn được gán lớp vẫn giữ vai trò của mình. Riêng tài khoản Giảng viên được thêm làm CVHT thì chuyển sang vai trò `advisor` và bị đăng xuất.
- **Trang Sinh viên** (AD-PROF): CVHT chỉ thấy sinh viên thuộc lớp mình.

## Dữ liệu (migration `058_academic_advisors.sql`)
- `ad_advisors`: họ tên, mã giảng viên, đơn vị. Tài khoản nằm ở `users`; tài khoản chưa đăng nhập được tạo sẵn như tài khoản quản trị (migration 017) và gắn vào lần đăng nhập Microsoft đầu tiên.
- `ad_advisor_classes`: mỗi lớp một CVHT, tên lớp viết hoa, không khoảng trắng (khớp `student_profiles.class_name`).
- `stu_chat_threads.created_by`: cuộc trò chuyện do CVHT tạo.
- Loại thông báo mới `advisor_action` (nhóm "Từ Khoa") và loại nhật ký mới `advisor`.

## API
Hợp đồng dữ liệu: `apps/web/src/advisor-types.ts`.
- **`/api/admin/advisors`** (`router.ts`, `repository.ts`, `import.ts`):
  - `GET /`, `GET /:id`;
  - `POST /` (AD-ADV-02), `PUT /:id`, `DELETE /:id` (xóa CVHT và lớp, giữ tài khoản);
  - `POST /import/preview` (AD-ADV-03) và `POST /import` (AD-ADV-01), nhận tệp .xlsx thô kèm header `x-filename`;
  - `GET /import/template`.
- **Import:**
  - Hàng tiêu đề nhận dạng không phân biệt dấu, hoa thường: Họ và tên, Email, Mã giảng viên, Đơn vị (Bộ môn, Khoa) và Lớp phụ trách.
  - Ô lớp tách theo `,`, `;`, `/` và xuống dòng. Cùng một email trên nhiều dòng thì gộp thành một CVHT.
  - Tệp là nguồn chuẩn cho những CVHT có trong tệp; lớp ghi cho người khác thì được chuyển sang (có dòng "Lớp … chuyển từ …"). CVHT không có trong tệp giữ nguyên.
  - Thêm hoặc sửa tay thì báo `class_taken` khi lớp đã có người phụ trách.
- **`/api/admin/advisor-portal`** (`portal-router.ts`):
  - `GET /me`, `/classes` (AD-AST-01);
  - `/students` (AD-AST-02…04): tìm, lọc theo lớp và tình trạng, sắp xếp, phân trang;
  - `POST /students/:id/open` (AD-AST-05, ghi nhật ký);
  - `/permissions` (AD-AST-09, nội dung ở `permissions.ts`).

## CVHT mở trang sinh viên (AD-AST-05…08)
- **Mở trang:** "Mở trang sinh viên" mở `/dashboard?sv=<id>#overview` ở một thẻ mới.
  - Thẻ đó giữ mã sinh viên trong `sessionStorage`, nên mỗi thẻ chỉ một sinh viên (`apps/web/src/advisor-view.ts`).
  - Mọi request `/api/student…` của thẻ mang header `X-Advisor-Student`.
- **Kiểm tra ở API:** `advisorActing` kiểm tra ở từng request rằng tài khoản vẫn phụ trách lớp của sinh viên. Các router sinh viên đọc sinh viên qua `studentUser(req)`.
- **Việc được làm thay** (`ACTING_ACTIONS`):
  - Import bảng điểm, hủy lần import đang chạy;
  - Đánh giá năng lực và tạo lại nhận xét AI;
  - Lộ trình AI;
  - Lời khuyên xét tốt nghiệp: `ensure` do trang tự gọi, không ghi nhật ký; `retry`;
  - Trợ lý AI: hỏi, hỏi lại, đánh giá câu trả lời.
- **Việc bị từ chối** (403 `advisor_action_not_allowed`): mọi thao tác ghi khác. CVHT cũng không đọc được thông báo của sinh viên.
- **Đồng ý:**
  - Import và đánh giá do CVHT làm không cần và không ghi đồng ý của sinh viên.
  - Nếu sinh viên đã tự xóa kết quả đánh giá (rút đồng ý), CVHT không chạy lại được (409 `assessment_withdrawn`).
  - Lộ trình AI vẫn cần Khảo sát định hướng do chính sinh viên làm và đồng ý.
- **Trợ lý AI:** CVHT chỉ thấy cuộc trò chuyện mình tạo. Sinh viên thấy tất cả, cuộc trò chuyện của CVHT có thẻ "Cố vấn học tập tạo".
- **Ghi lại và thông báo:** mỗi việc làm thay ghi một dòng nhật ký (loại `advisor`, tên sinh viên, không có dữ liệu) và gửi thông báo cho sinh viên, tối đa một thông báo cho mỗi CVHT, mỗi việc, mỗi ngày.
- **Giao diện của thẻ:** có dải "Bạn đang xem trang của … với tư cách cố vấn học tập" kèm nút "Đóng trang sinh viên". Chuông và nút đăng xuất bị ẩn, cùng các nút CVHT không được dùng: lưu hoặc xóa khảo sát, chọn mục tiêu, xóa dữ liệu, sửa Kế hoạch học kỳ, hỏi đồng ý.

## Kiểm thử (03/11/2026)
- **Tự động:** API 1620 test, web 604 test.
- **Trên schema local `e2e_k26k31`** (tài khoản giả "Cố vấn Thử nghiệm" phụ trách 71K29CNTT99 và 71K31CNTT99):
  - 32 bước API: quyền, phạm vi, làm thay, thông báo, nhật ký, import và chuyển lớp;
  - Trợ lý AI và import bảng điểm làm thay;
  - 15 bước giao diện trên Chrome headless.
- **Script:** thư mục scratchpad `advisors/` (prep, api-check, assistant-check, upload-check, ui-check).
