# Thông tin sinh viên từ tên Microsoft

Mẫu `2374802010078 - Nguyễn Bảo Duy - 71K29CNTT08` được tách thành MSSV `2374802010078`, họ tên `Nguyễn Bảo Duy`, khóa `K29`, lớp `CNTT08`, năm nhập học `2023`.

Migration 005 thêm `full_name`, `cohort_code`, `class_name` vào `student_profiles`; dùng lại `student_code` và `cohort_year`. Năm nhập học = số khóa + 1994, áp dụng từ K27. Tiền tố `71` không thuộc tên lớp. Không suy ra học kỳ hiện tại.

Migration bổ sung hồ sơ từ tên của tài khoản hiện có và tạo trigger cho những lần tạo/cập nhật tên Microsoft tiếp theo. Chỉ các tên khớp đầy đủ mẫu được xử lý; dữ liệu hồ sơ đã có không bị ghi đè. Tên gốc trong `users.display_name` được giữ lại. Hồ sơ mới vẫn chưa hoàn tất onboarding.

Nếu MSSV đã thuộc danh tính khác, không gộp tài khoản và không gán lại MSSV đó; các thông tin còn lại vẫn được bổ sung. Migration 006 thu hồi quyền gọi các hàm đồng bộ từ các vai trò Data API của Supabase nếu tồn tại.

API hồ sơ trả tên đã tách, khóa và lớp. Danh sách và hộp thoại chi tiết cùng hiển thị các trường này; tìm kiếm hỗ trợ khóa/lớp và bộ lọc năm nhập học dùng dữ liệu đã lưu.

Đã áp dụng migration trên PostgreSQL local. Không chạy build hoặc test theo yêu cầu. Supabase cần áp dụng migration khi Render triển khai với `DATABASE_AUTO_MIGRATE=true`.

## Tên tài khoản K26 (từ 23/10/2026, migration 044)

Theo yêu cầu "Sửa lại cái cách tách tên từ tên sinh viên lấy khóa với lớp của riêng k26 nó đang dùng cách khác", hàm `edupath_fill_student_identity` đọc thêm dạng tên của K26: `207CT12345 - Họ Tên - K26T-IT11`. Mã sinh viên có chữ (`207CT…`, `207LH…`). Lớp bắt đầu bằng khóa và có gạch nối, ví dụ `K26T-IT11`, `K26D-LH07`, `K26DB-IT1`.

- Tên dạng này cho MSSV `207CT12345`, khóa `K26`, lớp là phần **sau dấu gạch** (`IT11`, `LH07`, `IT1`), năm nhập học 2020 (khóa + 1994 như trước). Chữ trước dấu gạch (T, D, DB trong `K26T`, `K26D`, `K26DB`) thuộc phần khóa, không thuộc lớp. Khóa vẫn lưu `K26` vì CTĐT, kế hoạch và tiêu chuẩn tốt nghiệp đều tra theo `K26`, giống như `71K29CNTT08` cho khóa `K29`. Migration 044 lúc đầu ghi lớp cả phần chữ khóa (`T-IT11`). Migration 045 (yêu cầu "trước dấu - là chữ T như K26T thì nó vẫn là khóa học chỉ sau dấu - mới là lớp học") sửa hàm và đổi các lớp đã lỡ ghi như vậy.
- Dạng của K27 trở đi giữ nguyên. Mức khóa nhỏ nhất hạ từ K27 xuống K20.
- Quy tắc điền giữ như migration 005: chỉ điền ô còn trống, không gán MSSV đang thuộc tài khoản khác. Migration chạy lại cho mọi tài khoản đã có, nên sinh viên K26 đã đăng nhập trước đó được điền khóa và lớp ngay khi triển khai.
- Kiểm tra: `node scripts/verify-student-identity.mjs` chạy toàn bộ migration trong schema tạm của PostgreSQL local. Script dùng tên và mã giả, kiểm tra dạng K29, ba dạng K26, tên sai dạng, việc giữ ô đã có và MSSV trùng.

## Ngành của sinh viên (từ 27/10/2026, migration 052)

Khoa có ba ngành riêng, không phải chuyên ngành của CNTT (người dùng 26/10/2026: "CNTT, HTTT và MMT & TTDT là 3 ngành khác nhau"). Ngành lấy từ mã ngành nằm trong MSSV (người dùng 27/10/2026: "Điền ngành đúng nè").

- `student_profiles.major_code` là mã ngành 7 chữ số: chữ số thứ 3–9 của MSSV 12–14 chữ số. Ví dụ `2374802010145` → `7480201`. Các mã đã biết: `7480201` Công nghệ thông tin, `7480104` Hệ thống thông tin, `7480102` Mạng máy tính và truyền thông dữ liệu (`apps/api/src/curricula/majors.ts`, web `majors.ts`).
- MSSV K26 dạng `207CT…` là Công nghệ thông tin. Dạng khác (`207LH…`) chưa biết ngành nên để trống.
- Migration điền ngành cho hồ sơ đã có. Trigger `student_profiles_fill_major` điền khi hồ sơ chưa có ngành hoặc khi MSSV đổi. Ngành đã có không bị ghi đè trong trường hợp khác.
- Hồ sơ sinh viên (Thông tin học tập, dải thông tin ở Tổng quan) và chi tiết sinh viên của quản trị viên hiển thị **Ngành**.
- CTĐT, KHĐT và tiêu chuẩn xét tốt nghiệp của sinh viên được chọn theo khóa và ngành (xem `docs/curriculum-guide.md`).
- Kiểm tra: `node scripts/verify-student-identity.mjs` có thêm các ca: ba ngành, `207CT…`, `207LH…`, hồ sơ có trước migration và đổi MSSV.
