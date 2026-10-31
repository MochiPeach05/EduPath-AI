# Báo cáo của cổng quản trị (AD-REPORT-01…12)

Người dùng (31/10/2026) duyệt bản xem trước 2 (https://claude.ai/code/artifact/99829f4b-d63a-4c73-805c-96b5d827f438) với hai quyết định:
- "hiện đầy đủ": báo cáo có tên và MSSV, kể cả kỹ năng còn thiếu, nghề mục tiêu và môn AI đề xuất;
- "mọi quản trị viên": mọi vai trò của cổng quản trị đều xem và xuất Excel được.

Sau đó người dùng yêu cầu: "mọi phần đều có xem trung bình toàn khóa với từng khóa". Vì vậy mọi số liệu tổng hợp trả về dạng `CohortSplit`, gồm `all` (toàn khóa) và `byCohort` (từng khóa, khóa cũ trước). Trang có công tắc "Toàn khóa | Từng khóa" ở mỗi phần.

## Chức năng
| Mã | Trang | Ghi chú |
| --- | --- | --- |
| 01 | Tổng quan (`/quantri/tong-quan`, trang mở đầu) | GPA trung bình, xếp loại học lực, bảng điểm trung bình theo khóa / ngành / chuyên ngành, độ thành thạo kỹ năng theo nhóm năng lực, độ phù hợp với nghề, tiến độ theo khóa; nút nhỏ "Thao tác gần đây" |
| 02, 03 | Tiến độ | Trạng thái giống trang Tổng quan của sinh viên; xuất Excel |
| 04, 05 | Nguy cơ | Đúng các mục "Cần chú ý" của sinh viên; xuất Excel |
| 06, 07 | Kỹ năng thiếu | Theo nghề mục tiêu; bấm một kỹ năng để xem sinh viên; xuất Excel |
| 08 | Nghề mục tiêu | Số sinh viên và phân bố mức phù hợp theo nghề |
| 09 | Môn đề xuất | Môn Lộ trình AI đề xuất: học mới, học lại, học cải thiện |
| 10 + 11 | Bộ lọc chung | Tìm MSSV / họ tên, khóa, ngành, chuyên ngành |
| 12 | Nhật ký | Thay đổi dữ liệu và cấu hình, xem bảng điểm, xuất báo cáo |

## API (`apps/api/src/admin/reports/`)
Hợp đồng: `apps/web/src/admin-report-types.ts` (bản sao `types.ts`).

**Một dòng mỗi sinh viên** (`rows.ts`):
- `readOverview` (cùng hàm của trang Tổng quan sinh viên, bỏ phần kiểm tra Kế hoạch học kỳ): GPA và các dòng tổng kết in trên bảng điểm, tiến độ so với KHĐT, "Cần chú ý", năng lực.
- Điểm nhóm năng lực, điểm từng kỹ năng và khoảng trống của nghề: từ lần Đánh giá năng lực mới nhất, chỉ khi Tổng quan đang hiện lần đó. Vì vậy sau khi sinh viên rút lại đồng ý thì không còn số liệu năng lực.
- Môn Lộ trình AI đề xuất: lấy từ lộ trình hoàn tất mới nhất.
- Trạng thái:
  - `no_transcript`: chưa có bảng điểm;
  - `unknown`: thiếu kế hoạch hoặc chuyên ngành để so;
  - `late`: có mục trễ môn, không kịp tín chỉ, hoặc tín chỉ trễ lớn hơn 0;
  - còn lại `on_track`.

**Lưu đệm** (`cache.ts`):
- Mỗi dòng được giữ trong bộ nhớ, theo "dấu vân tay" của sinh viên (hồ sơ, bảng điểm, kế hoạch đã lưu, lần đánh giá, lộ trình, đồng ý) cộng dấu của danh mục. Danh mục thay đổi thì tính lại mọi dòng.
- Mỗi lần tính lại chạy tối đa 3 sinh viên cùng lúc, mỗi sinh viên trong một giao dịch REPEATABLE READ READ ONLY.
- Máy chủ tự làm nóng bộ đệm 60 giây sau khi khởi động.

**Tổng hợp** (`aggregate.ts`): các hàm thuần, không dùng AI.

**Excel** (`excel.ts`, exceljs):
- Mỗi tệp có sheet Dữ liệu, Theo khóa và Ghi chú (bộ lọc, giờ xuất, phạm vi "Dựa trên N/M sinh viên đã tải bảng điểm; bảng điểm do sinh viên tự tải, chưa xác minh"). Tệp kỹ năng có thêm sheet Sinh viên.
- Mỗi lần xuất ghi một dòng nhật ký.

## Nhật ký thao tác (`apps/api/src/admin/audit/`, migration 057 `ad_audit_log`)
- `auditAdminMutations` gắn trên `/api/admin`, trước các router quản trị. Nó ghi mọi POST/PUT/PATCH/DELETE thành công theo bảng tuyến (`routes.ts`).
- Một test quét mã các router: thêm tuyến quản trị mới mà không khai báo trong bảng tuyến thì test hỏng.
- Không ghi: các tuyến preview chỉ đọc tệp, yêu cầu lỗi, các lần đọc.
- Xem bảng điểm của một sinh viên được ghi riêng (kind `access`).
- Không bao giờ ghi điểm hay nội dung tệp.
- `GET /api/admin/audit-log`: tìm không dấu, lọc theo loại và người thực hiện, mới nhất trước. Dòng quá 1 năm bị xóa khi đọc, tối đa mỗi giờ một lần.

## Chính sách
Bản 31/10/2026 (`policyVersion`, `TRANSCRIPT_POLICY_VERSION`):
- quản trị viên của Khoa xem được tiến độ học tập, điểm trung bình, kết quả đánh giá năng lực (điểm kỹ năng, kỹ năng còn thiếu, nghề mục tiêu và mức phù hợp) và các môn Lộ trình AI đề xuất, kèm họ tên và MSSV, xuất được ra Excel;
- câu trả lời khảo sát và thành tích không có trong báo cáo;
- mỗi lần xem bảng điểm hoặc xuất báo cáo có tên sinh viên đều được ghi nhật ký.

Không hỏi sinh viên đồng ý lại (như đợt 26/10; `CONSENT_VALID_SINCE` vẫn 2026-10-25). Lưu ý: mục "Thay đổi chính sách" vẫn hứa sẽ hỏi ý kiến khi cách dùng dữ liệu thay đổi. Người dùng cần quyết có giữ câu đó không.
