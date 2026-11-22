# Báo cáo của cổng quản trị (nhóm Tổng quan, AD-REPORT-01…12)

Người dùng (31/10/2026) duyệt bản xem trước 2 (https://claude.ai/code/artifact/99829f4b-d63a-4c73-805c-96b5d827f438) với hai quyết định:
- "hiện đầy đủ": báo cáo có tên và MSSV, kể cả kỹ năng còn thiếu, nghề mục tiêu và môn AI đề xuất;
- "mọi quản trị viên": mọi vai trò của cổng quản trị đều xem và xuất Excel được.

Ngày 7/11/2026 nhóm menu đổi tên thành "Thống kê", và người dùng yêu cầu "cho CVHT xem nữa". Cố vấn học tập (vai trò `advisor`) xem và xuất Excel mọi trang Thống kê, nhưng chỉ tính sinh viên các lớp mình phụ trách (`advisedStudentIds`, `scopeOf` trong `apps/api/src/admin/reports/router.ts`). Giới hạn này theo chính sách 03/11/2026: cố vấn chỉ xem sinh viên lớp mình. `/options` trả thêm `scope: { classes }` để trang ghi rõ phạm vi. Nhật ký thao tác của cố vấn gồm thao tác của chính họ và mọi thao tác liên quan đến sinh viên các lớp họ phụ trách (`VISIBLE` trong `admin/audit/router.ts`; người dùng chọn "Của mình + lớp mình", 7/11). Các trang không còn hiện mã AD-REPORT-xx. Các vai trò khác vẫn xem toàn bộ, `scope: null`.

Ngày 17/11/2026 người dùng yêu cầu "Thống kê đổi thành tổng quan và tổng quan đổi thành thống kê": nhóm menu nay tên là **Tổng quan** (dòng chữ nhỏ trên tiêu đề các trang báo cáo là "TỔNG QUAN"), trang đầu tiên của nhóm tên là **Thống kê**; địa chỉ vẫn là `/quantri/tong-quan`.

Sau đó người dùng yêu cầu: "mọi phần đều có xem trung bình toàn khóa với từng khóa". Vì vậy mọi số liệu tổng hợp trả về dạng `CohortSplit`, gồm `all` (toàn khóa) và `byCohort` (từng khóa, khóa cũ trước). Đến 21/11 trang có công tắc "Toàn khóa | Từng khóa" ở mỗi phần.

## Giao diện từ 22/11/2026
Ngày 21/11/2026 người dùng thấy nhóm trang này "hơi xấu và quá nhiều chức năng", xem ba bản coi thử rồi duyệt bản thứ ba ("Triển khai đi"; bản coi thử: https://claude.ai/code/artifact/e3ecdc97-77b9-4700-baa0-2105cd17d5db). Hai điều người dùng yêu cầu khi xem các bản trước:
- giữ nhiều dạng biểu đồ và bảng thống kê ("Sao không có mấy cái bảng thống kê, biểu đồ tròn và nhiều dạng để biểu hiện dữ liệu khác vậy"), không rút hết về thanh ngang;
- mỗi trang một bố cục riêng ("mỗi trang nó có một cái giao diện khác nhau"), không dùng chung một khuôn.

Đủ 12 chức năng của danh sách chức năng (`requirements/Nhom1_DanhSachChucNang_ver0.3 (1).xlsx`, không commit). Những thứ đã bỏ so với giao diện trước:
- 11 công tắc "Toàn khóa | Từng khóa": thay bằng bộ lọc Khóa và các biểu đồ, bảng theo khóa;
- ngăn "Thao tác gần đây": thay bằng ô "Hoạt động gần đây" trên trang Thống kê (5 thao tác mới nhất, không hiện nội dung vì nội dung có thể có tên sinh viên);
- tiêu đề thứ hai, dòng mô tả, các nhãn tròn, dòng "Dựa trên N/M…" và chữ xám dưới từng ô: thay bằng một nút "Cách tính" ở đầu trang, mở ra nguồn số liệu và số sinh viên làm cơ sở;
- ô "Tìm sinh viên" trên các trang tổng hợp: chỉ còn trong ô danh sách của Tiến độ và Nguy cơ, và chỉ thu hẹp danh sách (các biểu đồ phía trên giữ nguyên phạm vi lọc).

Đầu mỗi trang: tiêu đề của cổng quản trị, dòng "Học kỳ đang học … · Cập nhật …", bên phải là Khóa, Ngành, Chuyên ngành, "Xóa bộ lọc" (khi đang lọc) và "Cách tính". `AdminWorkspace` giao tiêu đề cho `AdminReports` vẽ (prop `heading`) để bộ lọc nằm cùng hàng; tiêu đề vẫn là phần tử được focus khi đổi trang.

Số liệu thêm cho bố cục mới:
- `AverageRow`: `students`, `late`, `risk`, `warn` (Bảng thống kê cộng dồn được về dòng cuối; mọi nhóm có sinh viên đều có dòng);
- `ProgressReport.credits`: tín chỉ đã đạt, tín chỉ kế hoạch và tổng tín chỉ chương trình, trung bình trên các sinh viên so được với kế hoạch;
- `/risk?kind=`: lọc danh sách (và tệp Excel) theo một lý do;
- `q` của `/progress` và `/risk` chỉ thu hẹp danh sách; `counts`, `credits`, `reasons` và `scope` không đổi theo ô tìm;
- khi chọn một khóa, `byCohort` của các biểu đồ so sánh khóa (`dashboard.progress`, `progress.counts`, `progress.credits`, `risk.counts`) vẫn gồm mọi khóa của ngành và chuyên ngành đang lọc; trang tô đậm khóa đang chọn, `all` vẫn chỉ tính khóa đó;
- `/audit-log`: `days` (7 ngày gần nhất theo giờ Việt Nam, kèm số lần xem dữ liệu sinh viên và xuất báo cáo), `kinds`, `actorCounts` (mỗi nhóm đếm bỏ qua lựa chọn của chính nó).

## Chức năng
| Mã | Trang | Ghi chú |
| --- | --- | --- |
| 01 | Thống kê (`/quantri/tong-quan`, trang mở đầu; tên Tổng quan đến 16/11) | 5 ô số liệu có biểu đồ nhỏ; đường GPA theo học kỳ; biểu đồ tròn xếp loại học lực; cột 100% tiến độ theo khóa; 3 đồng hồ năng lực theo nhóm và kỹ năng thấp nhất; biểu đồ tròn độ phù hợp và vị trí được chọn nhiều nhất; Bảng thống kê theo khóa / ngành / chuyên ngành; Hoạt động gần đây |
| 02, 03 | Tiến độ | Thanh tỉ lệ và 4 ô tình trạng (bấm để lọc danh sách); cột số sinh viên theo khóa; "Tín chỉ so với kế hoạch" (vòng tỉ lệ, thanh từng khóa có vạch kế hoạch); danh sách sinh viên, sắp xếp được; xuất Excel |
| 04, 05 | Nguy cơ | Trái: số sinh viên có cảnh báo, hai ô mức, danh sách lý do, thanh theo khóa (mức và lý do bấm để lọc). Phải: thẻ từng sinh viên với mọi lý do; xuất Excel |
| 06, 07 | Kỹ năng thiếu | Biểu đồ mạng nhện 8 kỹ năng đứng đầu; bảng xếp hạng (tối đa 12) theo vị trí nghề nghiệp mục tiêu; bảng nhiệt kỹ năng × khóa; ô kỹ năng đang chọn với danh sách sinh viên; xuất Excel |
| 08 | Vị trí mục tiêu | Dải 4 số liệu; biểu đồ tròn cơ cấu (5 vị trí đầu + "Vị trí khác"); mỗi vị trí một thẻ: đồng hồ điểm phù hợp, phân bố mức phù hợp, kỹ năng thiếu nhiều nhất |
| 09 | Môn đề xuất | Cột chồng theo cách học (12 môn đầu, số dưới cột là thứ hạng); bảng xếp hạng (10 môn, "Xem thêm"); ô môn đang chọn: theo khóa và danh sách sinh viên |
| 10 | Tìm sinh viên | Ô "Tìm sinh viên" (MSSV hoặc họ tên) trong danh sách của Tiến độ và Nguy cơ |
| 11 | Lọc dữ liệu | Khóa, Ngành, Chuyên ngành ở đầu mỗi trang (trừ Nhật ký) |
| 12 | Nhật ký | Cột thao tác 7 ngày qua; đếm theo loại thao tác và người thực hiện (bấm để lọc); dòng thời gian theo ngày, 10 thao tác mỗi trang; tìm không dấu |

Function list (`requirements/Nhom1_DanhSachChucNang_ver0.5.xlsx`, sửa từ bản (9) của người dùng ngày 31/10, không commit): gộp dòng tìm kiếm cũ vào dòng lọc, đánh lại mã, nhóm mới "Quản lý thông báo" (AD-NOTI-01, 02).

## API (`apps/api/src/admin/reports/`)
Hợp đồng: `apps/web/src/admin-report-types.ts` (bản sao `types.ts`).

**Một dòng mỗi sinh viên** (`rows.ts`):
- `readOverview` (cùng hàm của trang Tổng quan sinh viên, bỏ phần kiểm tra Kế hoạch học kỳ): GPA và các dòng tổng kết in trên bảng điểm, tiến độ so với KHĐT, "Cảnh báo chậm tiến độ", năng lực.
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
- `GET /api/admin/audit-log`: tìm không dấu, lọc theo loại và người thực hiện, mới nhất trước; kèm số thao tác 7 ngày gần nhất, theo loại và theo người (từ 22/11). Dòng quá 1 năm bị xóa khi đọc, tối đa mỗi giờ một lần.

## Chính sách
Bản 31/10/2026 (`policyVersion`, `TRANSCRIPT_POLICY_VERSION`):
- quản trị viên của Khoa xem được tiến độ học tập, điểm trung bình, kết quả đánh giá năng lực (điểm kỹ năng, kỹ năng còn thiếu, nghề mục tiêu và mức phù hợp) và các môn Lộ trình AI đề xuất, kèm họ tên và MSSV, xuất được ra Excel;
- câu trả lời khảo sát và thành tích không có trong báo cáo;
- mỗi lần xem bảng điểm hoặc xuất báo cáo có tên sinh viên đều được ghi nhật ký.

Không hỏi sinh viên đồng ý lại (như đợt 26/10; `CONSENT_VALID_SINCE` vẫn 2026-10-25). Mục "Thay đổi chính sách" vẫn hứa sẽ hỏi ý kiến khi cách dùng dữ liệu thay đổi; người dùng quyết giữ nguyên câu đó (31/10: "giữ nguyên đi").
