# Quản lý khung chương trình đào tạo

Truy cập **Quản trị → Chương trình** tại `/quantri/chuong-trinh`.

## Sáu chức năng

Đầu trang chi tiết và màn hình xem trước import hiển thị **Tổng tín chỉ**, **TC bắt buộc**, **TC tự chọn**. TC bắt buộc tính một chuyên ngành, không cộng các phương án chuyên ngành thay thế; các khối giáo dục thể chất/quốc phòng và môn `BBKTL` được thể hiện riêng, không cộng vào tín chỉ tích lũy. TC tự chọn là phần còn lại của tổng CTĐT sau khi trừ TC bắt buộc, đồng thời đối chiếu các yêu cầu tự chọn đã biết; dữ liệu mâu thuẫn hoặc loại môn/chuyên ngành chưa xác định được sẽ hiển thị **Chưa xác định**.

Thông tin từng khối kiến thức trong bảng học phần hiển thị **TC bắt buộc** và **TC tự chọn**, tính theo toàn khối dù đang lọc học phần. Khi mã nhóm không có yêu cầu riêng, có thể xác định yêu cầu chung từ tổng tín chỉ khối trừ các môn bắt buộc; không tự chia số này cho từng mã nhóm, không cộng tất cả học phần tự chọn được cung cấp. Khối nguồn thiếu hoặc mâu thuẫn số tín chỉ hiển thị **Chưa xác định**.

- **Import:** chọn `.xlsx` không quá 5 MB, xem trước, đọc và xác nhận cảnh báo rồi lưu. Định dạng xác định bằng nội dung; tên tệp bất kỳ. Khung cùng ngành và khóa không được tạo trùng.
- **Danh sách và tìm kiếm:** tìm theo tên, ngành/chuyên ngành hoặc khóa. Gõ tìm kiếm cập nhật sau 300 ms; chọn khóa/trạng thái lọc ngay. Danh sách phân trang 10 khung.
- **Chi tiết:** xem các khối, học phần, nhóm tự chọn, học kỳ/năm học, tiên quyết/học trước và các điểm cần rà soát. Nút **Xem chi tiết** của từng học phần có toàn bộ trường và các ô Excel gốc.
- **Chỉnh sửa thông tin khung:** dùng biểu tượng bút ở đầu khung để sửa thông tin chương trình. Các mục cha như A, B chỉ là tiêu đề chứa mục con, không có menu thao tác và không được chọn khi thêm/chuyển môn. Menu **…** cuối mỗi dòng khối con **Khối kiến thức** cho phép thêm, sửa hoặc xóa môn trong khối. Khi thêm môn, chỉ bắt buộc mã học phần, tên học phần và tín chỉ; loại môn và các thông tin còn lại được để trống để bổ sung sau. Form thêm/sửa có combobox khối kiến thức; khi thêm sẽ chọn sẵn khối vừa mở menu. Có thể chuyển môn sang khối khác, sửa mã và các trường học phần. Muốn thay toàn bộ cấu trúc khối, dùng **Cập nhật từ Excel** với tệp cùng ngành và khóa. Mỗi lần lưu tạo phiên bản mới; lịch sử và Excel nguồn được giữ lại.
- **Mở/khóa:** khóa khung không còn áp dụng, giữ lại dữ liệu để tra cứu. Có thể mở lại; trạng thái không bị thay đổi khi chạy đồng bộ các nguồn ban đầu.

Quản trị viên, Ban chủ nhiệm khoa, trưởng/phó bộ môn và giảng viên đều được thêm, sửa, xóa, import và mở/khóa dữ liệu. Mọi thao tác ghi kiểm tra lại quyền trong database và phiên bản hiện hành; nếu khung đã được người khác sửa, tải lại trước khi lưu tiếp. Chỉ Quản trị viên được phân quyền tài khoản.

Xóa môn cần xác nhận và chỉ xóa khỏi phiên bản mới của khung đang mở, không xóa danh mục môn toàn hệ thống, khung khác hoặc lịch sử. Nếu môn bị xóa/đổi mã còn nằm trong điều kiện tiên quyết/học trước của môn khác, hệ thống giữ nguyên điều kiện đó và đánh dấu trong tab **Cảnh báo** để quản trị viên sửa. Tổng tín chỉ quy định không tự cộng/trừ khi thêm hoặc xóa môn vì có các nhóm tự chọn và chuyên ngành. Khối trống vẫn hiển thị để thêm môn lại.

**Tải xuống Excel CTĐT** (14/11/2026, trước là "Tải xuống Excel nguồn"; KHĐT: **Tải xuống Excel KHĐT**, tiêu chuẩn xét tốt nghiệp: **Tải xuống Excel tiêu chuẩn**) tải tệp Excel đã import để đối chiếu; tệp này không bao gồm chỉnh sửa trực tiếp sau import. Những chỉnh sửa được lưu trong JSON và bảng học phần của phiên bản mới. Kế hoạch đào tạo đã liên kết với phiên bản CTĐT cũ vẫn giữ nguyên liên kết; trang sinh viên đọc phiên bản hiện hành của khung đang mở.

**Mã học phần:** thêm/sửa và nhập Excel cùng nhận mã theo chương trình, không bắt buộc số đầu, số chữ hay độ dài theo mẫu mã VLU cũ. Mã phải có nội dung, tối đa 100 ký tự và không chứa ký tự điều khiển; khoảng trắng đầu/cuối được bỏ và mã được chuẩn hóa thành chữ hoa để tra cứu nhất quán. Mã có dấu gạch, chấm, gạch chéo hoặc khoảng trắng vẫn được chấp nhận. Không cho tạo trùng mã trong một khung. Trong tiên quyết/học trước, dùng `[mã học phần]` để tham chiếu rõ ràng, kể cả mã có khoảng trắng; mã thiếu trong khung vẫn được giữ và đánh dấu cần rà soát.

## Đồng bộ local và Render/Supabase

Migration `011_curricula.sql` tạo các bảng `curricula`, `curriculum_revisions`, `course_catalog`, `curriculum_courses`, `curriculum_relations`, `curriculum_events`. Mỗi khung có phiên bản JSON đầy đủ, bản Excel gốc và các bảng học phần/quan hệ để phục vụ truy vấn về sau.

Ba nguồn nằm trong `apps/api/data/curricula`: K29 có 88 học phần, K30 có 89, K31 có 89. Đây là **266 lượt học phần theo khung**, không phải 266 mã môn khác nhau. Giữ đúng file Mẫu Khoa người dùng cung cấp từ OneDrive; chưa nhập K32.

Khi backend khởi động với `DATABASE_AUTO_MIGRATE=true`, hệ thống chỉ chạy migration vào database được cấu hình bởi `DATABASE_URL`; backend **không tự nhập khung CTĐT**. Quản trị viên import khung trên trang quản trị. Local và Render có thể dùng hai database riêng; các sửa đổi ở hai database **không tự sao chép qua lại**.

Trên Render, giữ `DATABASE_URL` trỏ đến Supabase và `DATABASE_AUTO_MIGRATE=true`, deploy code mới như bình thường. Không cần sửa schema bằng tay hoặc dùng Supabase API key ở frontend. Để nạp nhanh ba khung K29–K31 vào một database trống, chạy tại thư mục gốc dự án:

```powershell
npm run db:seed-curricula --workspace @edupath/api
```

Lệnh đọc `apps/api/.env` theo cơ chế workspace hiện có; kiểm tra môi trường mục tiêu trước khi chạy. Lệnh chỉ thêm khung còn thiếu, không ghi đè phiên bản đã sửa, không tạo trùng và không mở lại khung đã khóa.

## Mẫu khung CTĐT cũ (K26–K28, từ 23/10/2026)

Theo yêu cầu "những khóa cũ thì code hiện tại nó chưa có định dạng đó", importer nhận thêm mẫu "PHÂN BỐ KIẾN THỨC TRONG CTĐT KHÓA … - NGÀNH …" của các khóa cũ (`apps/api/src/curricula/legacy.ts`). Các tệp gốc nằm trong `apps/api/data/curricula/` với tên gốc: `Khung CTĐT K26 CNTT (Gởi SV).xlsx` (85 học phần, 130 TC), `Khung CTĐT K27 CNTT (Gởi SV-CVHT).xlsx` (84 học phần, 127 TC), `Khung CTĐT K28 CNTT (Gởi SV-CVHT).xlsx` (71 học phần, 126 TC).

- Mẫu 2025 (K29–K31) vẫn đọc như trước. Chỉ khi tệp không có trang tính đúng mẫu 2025 thì mới đọc theo mẫu cũ.
- Chỉ đọc **trang tính đang hiện**. Tệp K28 còn giấu khung K27 và một mẫu khung ngành Ngôn ngữ Anh; trước đây importer chọn nhầm trang ẩn này nên báo "Thiếu ngành, khóa hoặc tổng tín chỉ".
- Cột được tìm theo tên tiêu đề vì mỗi khóa đặt cột khác nhau: "Mã học phần" hoặc "Mã học phần mới", "Tên học phần (Tiếng Việt)", "Số tín chỉ"/"TC", LT/TH/ĐA/TT ở dòng tiêu đề thứ hai, "Bắt buộc/Tự chọn", "ĐK tiên quyết", "ĐK học trước", "Ghi chú", "HK tổ chức". Mã cũ như `DCT0080` (K26) được giữ nguyên.
- Khóa lấy từ "KHÓA 28" hoặc "K26" trong tiêu đề hay tên trang tính. Ngành lấy từ "NGÀNH …", nếu không có thì tên trang tính hoặc tiêu đề ghi "CNTT" là ngành Công nghệ thông tin. Tổng tín chỉ là số của cả chương trình ghi phía trên tiêu đề cột (60–400). Tên lưu thống nhất là "KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH … KHÓA …"; tiêu đề gốc ghi vào ghi chú.
- "HK tổ chức" dạng YYS: 221 là năm học 2022–2023, học kỳ 1, tức năm 1 HK1 của K28.
- Khối kiến thức và chuyên ngành lấy từ dòng tiêu đề nhóm, dùng đúng giá trị của mẫu 2025: "GDQP-GDTC" là "Giáo dục thể chất và giáo dục quốc phòng" (môn điều kiện), "Kiến thức cơ sở nhóm ngành" là "Kiến thức cơ sở khối ngành", "2.3.1 Chuyên ngành Công nghệ Phần mềm: …" cho chuyên ngành "Công nghệ Phần mềm", "Các môn tự chọn chuyên ngành" là "Tự chọn Chuyên ngành". Chuyên ngành cũ "An ninh Mạng và IoT", "Tin học Quản trị" được giữ tên. Từ 23/10/2026, trang năng lực coi "An ninh Mạng và IoT" của K27 là chuyên ngành ANM, vì sinh viên K27 chọn được chuyên ngành này. Các giá trị còn lại (ANM của K26, Tin học Quản trị) vẫn là học phần chung kèm cảnh báo.
- "BB/KTL" ghi thành `BBKTL` như mẫu 2025.
- Khóa nhỏ nhất được nhận là K20 (trước là K27).

## Khung CTĐT các ngành HTTT và MMT&TTDL (từ 26/10/2026)

Giáo viên gửi thêm CTĐT, KHĐT của hai ngành **Hệ thống thông tin** và **Mạng máy tính và truyền thông dữ liệu**. Người dùng nhắc: "CNTT, HTTT và MMT & TTDT là 3 ngành khác nhau nha không phải chuyên ngành của CNTT". Các tệp nằm trong `apps/api/data/CTĐT_KHDT/` (không commit): CTĐT K29 (CNTT, HTTT, MMT&TTDL, "Mẫu gởi ĐT" 08.03.2024), CTĐT K31 (CNTT, HTTT, MMT&TTDL, 22/01/2025), CTĐT K32 HTTT, KHĐT K31 (CNTT, HTTT, MMT&TTDL), KHĐT K32 HTTT.

- Mỗi ngành của một khóa là một khung riêng (khóa nhận diện `ngành:khóa`). Tên viết tắt "CNTT", "HTTT", "MMT & TTDL" được đổi thành tên đầy đủ (`apps/api/src/curricula/majors.ts`) để CTĐT và KHĐT cùng ngành, cùng khóa liên kết được với nhau.
- CTĐT K29 "Mẫu gởi ĐT" đọc theo mẫu cũ. Cột "Học kỳ triển khai" (HTTT), "HK triển khai" (CNTT), "HK GD" (MMT&TTDL) ghi **số thứ tự học kỳ** của khóa, kể cả học kỳ hè: 1–3 là HK1, HK2, HK3 năm thứ nhất, 4–6 là năm thứ hai… Trang KHĐT ẩn trong tệp HTTT xác nhận cách đếm này (231 → 1, 233 → 3, 241 → 4, 261 → 10). Tệp không có dòng tiêu đề khối nên khối kiến thức của môn chung để trống.
- Mẫu K29 ghi chuyên ngành theo **2 kiểu** (người dùng 27/10/2026: "có 2 phong cách ghi môn này thuộc chuyên ngành nào"):
  - MMT&TTDL có dòng tiêu đề "Các môn Bắt buộc - Chuyên ngành IoT (Khối kiến thức chuyên ngành)". Môn tự chọn của cả khối nằm dưới "Các môn Tự chọn (Khối kiến thức Chuyên ngành)" và được tô màu của chuyên ngành.
  - HTTT và CNTT chỉ tô màu từng nhóm chuyên ngành. Tên của màu lấy từ danh sách môn từng chuyên ngành ghi ở điều kiện của Đồ án TN ("Chuyên ngành HTTT Chuyển đổi số: Hoạch định nguồn lực doanh nghiệp …", "CN IoT: - Nhập môn hệ thống nhúng …").
  - Một màu chỉ được đặt tên khi ít nhất 2 môn của nó thuộc cùng một chuyên ngành (theo tiêu đề hoặc danh sách) và không môn nào thuộc chuyên ngành khác. Màu đó chỉ gán cho dải dòng liền nhau có chứa các môn ấy, cùng môn tự chọn chuyên ngành cùng màu. Lý do: HTTT tô cùng một màu cho cả khối đại cương và nhóm Chuyển đổi số.
  - Kết quả: HTTT có 6 môn Chuyển đổi số và 6 môn Địa lý, MMT&TTDL có IoT, An ninh Mạng (kể cả môn tự chọn). Môn bắt buộc đứng sau phần tự chọn mà không có tiêu đề riêng (Đồ án thực tập, Đồ án tốt nghiệp) thuộc khối đồ án.
  - Khung CNTT K29 tô màu CNPM, CNDL, TTNT nhưng không ghi danh sách môn, nên không đặt tên được. Hệ thống đã có khung CNTT K29 đầy đủ.
  - Việc đọc theo màu chỉ áp dụng cho mẫu này (có cột học kỳ triển khai); các khung CNTT K26–K31 đọc như trước.
- CTĐT K31 MMT&TTDL lặp dòng số cột (1, 2, 3 …) dưới phần chữ ký; dòng này không còn bị đọc thành môn mã "1".
- CTĐT K32 HTTT không ghi "Tổng tín chỉ của CTĐT". Tổng tín chỉ để trống ("Chưa xác định") kèm cảnh báo; quản trị viên nhập ở **Sửa thông tin**. Khung K32 cũng chưa ghi học kỳ/năm của môn; học kỳ lấy từ KHĐT K32.
- Import thử trên máy (schema `e2e_k26k31`, 27/10/2026, qua đúng API quản trị): tạo được 5 khung mới (K29 HTTT 62 môn, K29 MMT&TTDL 64, K31 HTTT 78, K31 MMT&TTDL 79, K32 HTTT 66). CTĐT K29 CNTT và K31 CNTT của giáo viên báo `curriculum_exists` vì hệ thống đã có khung CNTT của hai khóa này (không ghi đè). Sau khi thử, schema được trả về như cũ.
- Khi import thử, hồ sơ sinh viên chưa có ngành, nên một khóa có nhiều khung đang mở làm đánh giá năng lực báo `curriculum_ambiguous`, kể cả với sinh viên CNTT. Vì vậy hồ sơ có thêm ngành (từ 27/10/2026, migration 052, `docs/STUDENT_IDENTITY_FIELDS.md`), và mọi nơi chọn khung theo **khóa và ngành** (người dùng: "Chọn khung ok như vậy đi"):
  - Đánh giá năng lực (`competency-assessment/inputs.ts`) chọn CTĐT và KHĐT của khóa và ngành. Kế hoạch học kỳ (`study-plan/context.ts`) chọn CTĐT, mốc học kỳ và nhóm lựa chọn của KHĐT cùng ngành. Trang Điều kiện xét tốt nghiệp chọn CTĐT cùng ngành. Trang CTĐT/KHĐT của sinh viên chỉ hiện khung và kế hoạch của khóa và ngành của sinh viên, không có ô chọn (10/11/2026, `curricula/own-program.ts`); khung của khóa hoặc ngành khác trả 404 cho sinh viên.
  - Khung khớp ngành theo khóa nhận diện `ngành:khóa` (`majorCondition`, `majorIdentity` trong `curricula/majors.ts`). Hồ sơ chưa có ngành (không có MSSV) dùng khung của khóa như trước. Mã ngành Khoa không đào tạo thì không khớp khung nào.
  - Tiêu chuẩn xét tốt nghiệp chỉ lấy chuẩn của ngành (`standardMajor` trong `graduation/resolve.ts`): theo mã chương trình (`7480201-03` → 7480201), không có thì theo mã ngành ở "Ngành đào tạo" (`Mạng máy tính và truyền thông dữ liệu (7480102)`, tiêu chuẩn chung), không có nữa thì theo chữ HTTT, MMT hay TTDL trong tên (Khoa ghi lớp MMT&TTDL là `71K29TTDL`), còn lại là CNTT. Khoa đã nhập tiêu chuẩn K29 của HTTT Chuyển đổi số (7480104-01) và MMT&TTDL An ninh mạng (7480102-02) ngày 27/10/2026, nhưng đến 10/11/2026 hai chuyên ngành này mới có mã chương trình trong `specialty.ts`; trước đó sinh viên của chúng vẫn thấy "chưa có tiêu chuẩn" (người dùng: "Đã có xét tốt nghiệp chuyên ngành Hệ thống thông tin – Chuyển đổi số mà sao đây lại báo là không có vậy?"). HTTT Địa lý và IoT chưa có tiêu chuẩn; tiêu chuẩn đầu tiên của chúng được nhận theo tên chuyên ngành (`docs/graduation-standards.md`).
- **Cấu hình môn học:** import tạo thêm 57 môn năng lực; 8 môn trùng mã với môn đã có nhưng khác tên ("Đồ án TN" và "Đồ án Tốt nghiệp", "Ảo hoá" và "Ảo hóa"…). Cần gộp các môn này (gộp môn cùng mã) và cấu hình kỹ năng cho các môn mới.

## Các điểm cần rà soát trong nguồn

- K29: ô tổng khối `#REF!`, các dòng chuyên đề tốt nghiệp bị lệch cột và một số lịch học chưa xác định.
- K30: giữ nguyên ký hiệu `BBKTL`; một số nhóm tự chọn chỉ có mã nhóm, không ghi rõ tín chỉ cần chọn trong cột loại học phần.
- K31: mã Toán rời rạc mới là `71ITMA10404`, có điều kiện học trước còn dùng `71ITMA10403`. Không tự gộp hai mã.
- Tham chiếu ngoài khung và điều kiện bằng văn bản được giữ nguyên, đánh dấu rà soát. Các ghi chú về lỗi nguồn vẫn được giữ như thông tin truy vết sau khi chỉnh sửa dữ liệu.
- Tổng 126 tín chỉ đọc từ tiêu đề CTĐT. Không cộng toàn bộ các phương án tự chọn/chuyên ngành để kết luận số tín chỉ tốt nghiệp.

## Cổng sinh viên — STU-CURR-01

Vào **Chương trình đào tạo** trong menu bên trái hoặc menu tài khoản, đường dẫn `/dashboard#curriculum`.

- Chỉ liệt kê các khung đang mở và bản hiện hành. Khung bị khóa không thể xem kể cả gọi trực tiếp bằng ID; sinh viên không được ghi dữ liệu hoặc xem lịch sử/Excel nguồn của quản trị viên.
- Nếu chỉ có một khung đang mở cùng khóa với hồ sơ, trang tự gợi ý khung đó. Đây là gợi ý theo khóa, không phải xác nhận chương trình chính thức được phân công. Nếu chưa có khung đúng khóa (ví dụ K32), hoặc chưa có khóa trong hồ sơ, trang báo rõ và cho chọn khung khác để tham khảo.
- Tìm tên hoặc mã học phần có/không dấu; lọc theo khối, bắt buộc/tự chọn, chuyên ngành, năm học, học kỳ 1–3. Bộ lọc cập nhật ngay khi chọn, tìm kiếm chờ 300 ms.
- Chọn tên môn để xem tín chỉ, mô tả, loại môn, tiên quyết và học trước riêng biệt, cùng lịch học dự kiến/bộ môn/giờ học. Có thể mở môn được tham chiếu trong điều kiện để tra cứu tiếp.
- Các mã hoặc điều kiện còn chưa rõ được ghi nhận là cần xác nhận với cố vấn học tập. Chức năng này chưa kết luận sinh viên đủ điều kiện đăng ký hay tốt nghiệp.
- Trang tự tải lại khi quay về tab để nhận phiên bản/trạng thái mới nhất; nếu tải lỗi, bấm **Thử lại**.

**Mô tả môn học:** ba file Excel ban đầu không có mô tả chi tiết. Quản trị viên bổ sung qua **Xem chi tiết** của khung → **Xem chi tiết** của học phần → **Chỉnh sửa học phần** → **Mô tả học phần**. Nội dung lưu trong phiên bản JSON của học phần và hiển thị ở cổng sinh viên. Không suy diễn mô tả từ tên môn hoặc lấy ghi chú thay mô tả; khi chưa có dữ liệu, trang thông báo chưa được cung cấp. Không cần migration mới cho trường tùy chọn này.

## Các chức năng tiếp theo

Theo [kế hoạch](curriculum-plan.md), phần đối chiếu bảng điểm sẽ liên kết mã môn và phiên bản CTĐT. Sau đó bổ sung bảng tương đương được duyệt, quy tắc chọn chuyên ngành/nhóm tự chọn và điều kiện tốt nghiệp trước khi xây dựng thuật toán lộ trình. Các chức năng đó chưa được triển khai trong sáu mục quản trị này. K32 có thể thêm qua cùng luồng import khi có file chính thức; nếu trường đổi mẫu cột thì mở rộng bộ đọc trước.

## Kiểm tra

```powershell
npm run build
npm test
node scripts/verify-curricula.mjs
node scripts/verify-student-curricula.mjs
```

Hai script chỉ nhận database local và dùng schema tạm riêng. Script quản trị kiểm tra quyền, import, seed, tìm kiếm, phiên bản, cập nhật học phần, thay Excel và mở/khóa. Script sinh viên kiểm tra sinh viên chỉ nhận khung của khóa và ngành của mình (khung khóa khác trả 404), dữ liệu K29–K31, cập nhật từ quản trị, ẩn khung khóa và quyền chỉ đọc. Schema được dọn khi lệnh kết thúc. Có thể thêm `--ui` để xem bản build trên máy với tài khoản giả lập, dữ liệu schema tạm; nhấn Ctrl+C để đóng và dọn schema. Chế độ này chỉ lắng nghe trên `127.0.0.1`, không dùng cho triển khai.
