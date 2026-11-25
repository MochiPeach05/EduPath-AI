# Sắp xếp bảng ở cổng quản trị

Yêu cầu của người dùng (28/10/2026): "thêm một nút mũi tên nhỏ lên, xuống ở bên cạnh STT Sinh viên Mã sinh viên Khóa học Lớp học Năm nhập học Hồ sơ Tài khoản Thao tác và nhiều nút khác ở các trang khác để người dùng có thể ấn vào để xếp bộ lọc từ trên xuống hoặc dưới lên hoặc các bộ lọc khác phù hợp với cột đó".

## Cách dùng

- Mỗi tiêu đề cột có hai mũi tên nhỏ. Bấm vào tiêu đề:
  - lần 1: xếp tăng dần (mũi tên lên đậm, chữ tiêu đề đổi màu đỏ);
  - lần 2: xếp giảm dần;
  - lần 3: trở về thứ tự mặc định của bảng.
- Bấm sang cột khác thì bắt đầu lại từ tăng dần ở cột đó. Mỗi lần đổi cách xếp, bảng quay về trang 1.
- Cột Thao tác không có mũi tên.
- **STT** là số thứ tự của dòng theo thứ tự mặc định. Số này đi theo dòng khi xếp theo cột khác, giống số dòng trong Excel. Bấm STT để đảo ngược danh sách.
  - Riêng bảng Lĩnh vực, cột STT hiển thị số thứ tự đã lưu của lĩnh vực, nên STT xếp theo số đó (1, 2, 10).
- Trình đọc màn hình nhận cột đang xếp qua `aria-sort`. Chú thích khi rê chuột cho biết lần bấm tiếp theo sẽ làm gì.

## Quy tắc theo loại cột

| Loại cột | Cách xếp tăng dần |
| --- | --- |
| Chữ (tên, mã, lớp, mô tả) | Theo bảng chữ cái tiếng Việt (a, ă, â, …, d, đ, …). Số trong chữ so theo giá trị: K9 trước K29, CNTT2 trước CNTT10. |
| Họ tên người | Theo tên (từ cuối), rồi cả họ tên, như danh sách lớp. |
| Số, ngày | Theo giá trị, nhỏ trước, cũ trước. |
| Trạng thái | Theo thứ tự cố định của trạng thái (bảng dưới). |

- Ô trống ("Chưa cập nhật", "—", "Chưa đăng nhập", "Không liên kết kỹ năng") luôn nằm cuối, dù xếp tăng hay giảm.
- Các dòng bằng nhau giữ thứ tự mặc định.

## Bảng và cột

| Trang | Bảng | Cột xếp được và cách xếp |
| --- | --- | --- |
| Tài khoản | Danh sách tài khoản | STT; Người dùng (theo tên); Vai trò (Quản trị viên → Ban chủ nhiệm khoa → Trưởng/phó bộ môn → Giảng viên → Sinh viên); Trạng thái (Đang hoạt động trước); Đăng nhập gần nhất (ngày, chưa đăng nhập ở cuối) |
| Tài khoản | Lịch sử đăng nhập | Thời gian; Người dùng (theo tên); Cổng (Quản trị, Sinh viên); Kết quả (Thành công trước); Thông tin (theo chữ hiển thị) |
| Sinh viên | Danh sách sinh viên | STT; Sinh viên (theo tên); Mã sinh viên; Khóa học (K9 trước K29); Lớp học; Năm nhập học; Hồ sơ (Đã hoàn tất → Chưa hoàn tất → Chưa có hồ sơ); Tài khoản (Đang hoạt động trước) |
| Lĩnh vực | Lĩnh vực nghề nghiệp | STT (số lĩnh vực); Tên lĩnh vực; Mô tả |
| Kỹ năng | Kỹ năng | STT; Tên kỹ năng; Mô tả |
| Nghề nghiệp | Vị trí nghề nghiệp | STT; Mã vị trí (NN9 trước NN10); Vị trí nghề nghiệp; Lĩnh vực; Kỹ năng liên kết (theo số kỹ năng) |
| Nghề nghiệp | Yêu cầu nghề nghiệp | STT; Yêu cầu; Kỹ năng; Trọng số học phần (theo số học phần); Tính chất (Bắt buộc trước) |
| Nghề nghiệp | Trọng số học phần của một kỹ năng | STT; Mã học phần; Tên học phần; Trọng số |
| Nhóm năng lực | Nhóm năng lực | STT; Nhóm năng lực; Mô tả; Số kỹ năng; Trạng thái (Đang sử dụng trước) |
| Nhóm năng lực | Kỹ năng thuộc nhóm (chi tiết) | STT; Kỹ năng; Phạm vi đánh giá; Trạng thái |
| Cấu hình năng lực | Cấu hình năng lực | STT; Kỹ năng; Nhóm năng lực; Phạm vi; Trạng thái; Liên kết (theo số môn học, rồi số nghề nghiệp) |
| Cấu hình năng lực | Môn học liên kết và đóng góp (chi tiết) | STT; Môn học (theo mã); Khóa áp dụng; Trọng số; Cấu hình kỹ năng môn học (Chưa cấu hình → Bản nháp → Đang áp dụng → Đã lưu trữ) |
| Cấu hình kỹ năng môn học | Cấu hình kỹ năng môn học | STT; Môn học (theo mã); Khóa áp dụng; Trạng thái (Chưa cấu hình → Bản nháp → Đang áp dụng → Đã lưu trữ); Kỹ năng / tổng trọng số (theo số kỹ năng) |
| Chương trình | Danh sách chương trình đào tạo | STT; Chương trình đào tạo; Khóa (K9 trước K29); Học phần (số học phần); Phiên bản (số phiên bản, rồi ngày cập nhật); Trạng thái (Đang mở trước) |
| Chương trình | Xem trước khi import Excel | STT; Mã; Học phần; Tín chỉ; Loại; Năm · HK (năm rồi học kỳ, môn chưa có năm ở cuối) |
| Chương trình | Cấu trúc học phần (theo khối) | Như bảng xem trước. Học phần chỉ đổi chỗ trong khối của nó; dòng tên khối giữ nguyên vị trí. |
| Chương trình | Điều kiện học phần | STT; Học phần; Loại điều kiện (Tiên quyết trước Học trước); Nội dung; Đối chiếu (Cần rà soát trước) |
| Kế hoạch | Danh sách kế hoạch đào tạo | STT; Kế hoạch đào tạo; Khóa; Lượt môn (số môn); Phiên bản; Trạng thái (Đang mở trước) |
| Kế hoạch | Kế hoạch theo học kỳ | STT; Mã học phần; Tên học phần; TC; Loại môn; Tiên quyết / Học trước. Môn chỉ đổi chỗ trong cùng một phần của một học kỳ; tiêu đề học kỳ và tiêu đề phần giữ nguyên vị trí. |
| Tốt nghiệp | Tiêu chuẩn xét tốt nghiệp | STT; Tiêu chuẩn; Khóa; Chuyên ngành; TC tối thiểu; Trạng thái (Đang mở trước) |
| Tốt nghiệp | Nhóm điều kiện (mỗi nhóm một bảng) | STT; Mã học phần (mã chính); Tên học phần; TC; Môn điều kiện (Có trước). Một lần bấm xếp mọi nhóm, mỗi nhóm xếp trong bảng của nó. |

- Loại môn và BB / TC xếp theo chữ (BB, BBKTL, TC, TC1, TC2), vì các giá trị không cố định.
- Danh sách Chương trình và Kế hoạch trước đây đánh STT lại từ 1 ở trang 2. Nay STT lấy từ server nên chạy liên tục qua các trang.
- Không đổi: bảng trọng số tại từng lần lưu trong Lịch sử cấu hình (mỗi lần lưu là một bảng nhỏ trong mục thu gọn), và các trang của sinh viên.

## Kỹ thuật

- Web: `apps/web/src/table-sort.tsx` và `table-sort.css`.
  - `useTableSort` giữ cách xếp của một bảng; `sortHeader(nhãn, cột)` vẽ ô tiêu đề có nút và hai mũi tên.
  - `sortRows(dòng, quy tắc, cách xếp)` trả các dòng đã xếp kèm STT. Bảng phân trang trên trình duyệt xếp cả danh sách trước khi cắt trang.
  - So sánh chữ bằng `Intl.Collator("vi", { numeric: true })`.
- Năm danh sách phân trang trên server, nên web gửi `sort` và `dir`:
  - sinh viên (`GET /api/admin/students`);
  - tài khoản (`GET /api/admin/accounts`);
  - lịch sử đăng nhập (`GET /api/admin/accounts/history`);
  - chương trình đào tạo (`GET /api/admin/curricula`, `sort=stt|name|cohortCode|courseCount|version|isActive`);
  - kế hoạch đào tạo (`GET /api/admin/plans`, `sort=stt|name|cohortCode|itemCount|version|isActive`).

  Server (`apps/api/src/admin/table-sort.ts`) làm như sau:
  - Khóa cột chỉ chọn một biểu thức SQL có sẵn trong code; chữ từ request không bao giờ vào câu SQL. Khóa lạ bị trả 400.
  - Chữ dùng `COLLATE "vi-x-icu"`; số trong chữ được đệm số 0 để so theo giá trị; tên người xếp theo từ cuối.
  - Mỗi biểu thức có `NULLS LAST`, rồi thứ tự mặc định làm khóa phụ.
  - `row_number()` theo thứ tự mặc định cho `stt`, tính trước khi phân trang.
- Kiểm thử:
  - Unit: `apps/web/src/table-sort.test.tsx`, `apps/api/src/admin/table-sort.test.ts`, `student-profiles.test.ts`, `accounts.test.ts`, `curricula/repository.test.ts`, `plans/repository.test.ts`.
  - Chạy thật trên PostgreSQL local (28/10/2026):
    - 48 sinh viên, 53 tài khoản, 78 lần đăng nhập: với mọi cột, cả hai chiều, thứ tự của server trùng thứ tự của trình duyệt, và ô trống luôn ở cuối;
    - 4 chương trình, 3 kế hoạch: mọi cột, cả hai chiều, đúng thứ tự qua các trang, STT không trùng.
  - Ảnh chụp Chrome headless (dữ liệu giả) của bảng Sinh viên và Lĩnh vực: mũi tên hiển thị đúng, cột đang xếp đổi màu.
