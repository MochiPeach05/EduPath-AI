# Cố vấn học tập (AD-ADV-01…05, AD-AST-01…09)

## Cập nhật 14/11/2026

Cố vấn và cán bộ Khoa làm thay như cũ: đổi chuyên ngành trong khung import (hộp xác nhận), chọn vị trí và làm Khảo sát nhanh ở Định hướng nghề nghiệp. Danh sách sinh viên: bộ lọc "Đã đủ các bước" = có bảng điểm, đã đánh giá năng lực và có Lộ trình AI (không còn cần khảo sát); cột và bộ lọc khảo sát ghi "Khảo sát nhanh". Chọn vị trí thay sinh viên có thể tự đánh giá lại; khi đó nhật ký và thông báo ghi như một lần Đánh giá năng lực làm thay.

Người dùng (03/11/2026): "Giờ làm phần nhóm chức năng quản lý cố vấn học tập này đi và sửa lại các phần tác nhân của CVHT theo trong file function list" (`requirements/Nhom1_DanhSachChucNang_ver0.3 (1).xlsx`, không commit). Tác nhân trong file:
- "QTV & CVHT": cố vấn học tập (CVHT) được xem;
- "Quản trị viên": chỉ quản trị viên được thay đổi;
- "Cố vấn học tập": chức năng của CVHT với lớp mình phụ trách.

Ba quyết định của người dùng:
- CVHT được làm thay sinh viên: import bảng điểm; đánh giá năng lực (gồm đánh giá lại và nhận xét AI); Lộ trình AI và lời khuyên xét tốt nghiệp; hỏi Trợ lý AI. CVHT không chọn chuyên ngành, vị trí nghề nghiệp mục tiêu và không sửa Kế hoạch học kỳ thay sinh viên (cả hai đổi ngày 10/11/2026, xem bên dưới).
- Sinh viên chưa đồng ý thì CVHT vẫn làm thay được ("Cho làm, báo sinh viên"). Hệ thống không ghi là sinh viên đã đồng ý, mà ghi nhật ký và gửi thông báo vào chuông của sinh viên.
- Chính sách bảo mật cập nhật luôn, không hỏi lại sinh viên (bản 2026-11-03).

Cùng ngày, người dùng gộp hai trang của CVHT thành "Quản lý sinh viên" và mở cho quản trị viên: "Cái mục quyền cố vấn sửa lại thành quản lý sinh viên … ấn xem chi tiết từng sinh viên … là quản trị viên có giao diện của sinh viên bên trang sinh viên luôn, quản trị viên có thể import bảng điểm và chạy suy luận AI, hỏi đáp ở phần trợ lý AI". Tác nhân của AD-AST-01…09 nay là "QTV & CVHT". Chính sách vẫn là bản 2026-11-03, không hỏi lại sinh viên.

Ngày 10/11/2026, người dùng đổi phần chuyên ngành và vị trí nghề nghiệp của quyết định đầu: "Sửa lại quyền của cố vấn học tập và quản trị viên có thể sửa chuyên ngành và nghề nghiệp của sinh viên luôn là giống như toàn quyền bên trang sinh viên luôn á." Từ đó CVHT, quản trị viên và Ban chủ nhiệm khoa (cùng mọi tài khoản cổng quản trị được gán lớp, với sinh viên lớp đó) chọn được chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên, như sinh viên tự làm. Chính sách bản 2026-11-10, không hỏi lại sinh viên (`CONSENT_VALID_SINCE` giữ 2026-10-25).

Cùng ngày, người dùng mở thêm: "Kế hoạch học kỳ, Khảo sát định hướng … cái này cố vấn học tập và quản trị viên làm luôn nhé". Những người trên sửa được Kế hoạch học kỳ và làm hoặc sửa Khảo sát định hướng thay sinh viên, như sinh viên tự làm. Đồng ý, xóa dữ liệu và thông báo vẫn là của sinh viên. Không ghi đồng ý thay sinh viên: khảo sát do họ làm thay được dùng cho các chức năng AI như khảo sát sinh viên tự làm và đồng ý ("cho làm, báo sinh viên"), trừ khi sinh viên đã rút đồng ý; khi sinh viên tự lưu lại, sinh viên đồng ý như thường. Chính sách vẫn là bản 2026-11-10, sửa trong ngày, không đổi phiên bản.

## Trang Quản lý sinh viên (AD-AST-01…09)
- **Đường dẫn:** `/quantri/quan-ly-sinh-vien`, trong nhóm "Cố vấn học tập" của thanh bên, sau trang Cố vấn. Hai đường dẫn cũ `/quantri/lop-phu-trach` và `/quantri/quyen-co-van` mở trang này (`adminPathAliases`).
- **Ai thấy trang:** quản trị viên và Ban chủ nhiệm khoa (`canManageAdvisors`) luôn thấy, với mọi lớp và mọi sinh viên (`GET /me` trả `scope: "all"`). Vai trò `advisor` luôn thấy, với lớp mình phụ trách, và trang này là trang mở đầu của CVHT. Vai trò khác chỉ thấy khi `GET /me` báo có lớp phụ trách (`scope: "own"`).
- **Nội dung, theo thứ tự** (`apps/web/src/AdvisorPortal.tsx`):
  1. Một câu nói trang liệt kê sinh viên nào: mọi sinh viên của Khoa, hoặc sinh viên các lớp mình phụ trách.
  2. Bảng lớp (AD-AST-01). Khi xem mọi lớp, bảng có thêm cột "Cố vấn học tập" (tên CVHT, "Chưa phân công" khi lớp chưa có CVHT). Nút "Xem sinh viên" lọc bảng sinh viên theo lớp.
  3. Bảng sinh viên (AD-AST-02…04): tìm theo MSSV hoặc họ tên, lọc theo lớp và tình trạng, sắp xếp, phân trang. Nút "Xem chi tiết" (AD-AST-05, 06) mở trang của sinh viên ở thẻ mới.
  4. Mục "Quyền khi làm việc với trang sinh viên" (AD-AST-09), gập sẵn: ba danh sách và phần ghi chú từ `GET /permissions`.

## Vai trò và quyền
- **Vai trò `advisor` (Cố vấn học tập), migration 058.** Vào được cổng quản trị và chỉ xem. `advisorReadOnly` (`apps/api/src/advisors/access.ts`) chặn mọi thao tác ghi, trừ `POST /api/admin/advisor-portal/students/:id/open`. CVHT không đọc được Tài khoản và Thông báo. Từ 7/11/2026, CVHT xem được Thống kê, chỉ tính sinh viên các lớp mình phụ trách, và Nhật ký gồm thao tác của chính mình cùng các thao tác liên quan đến sinh viên lớp mình (xem `docs/admin-reports.md`).
- **Ai quản lý danh sách CVHT** (thêm, sửa, xóa, import): quản trị viên và Ban chủ nhiệm khoa (`canManageAdvisors`). Mọi vai trò của cổng quản trị đều xem được danh sách.
- **Chức năng của CVHT** (Quản lý sinh viên, Xem chi tiết, làm thay) dùng được với mọi tài khoản cổng quản trị có lớp trong `ad_advisor_classes`. Quản trị viên và Ban chủ nhiệm khoa dùng được với mọi sinh viên, dù không phụ trách lớp nào. Vì vậy quản trị viên, Ban chủ nhiệm khoa hay Trưởng bộ môn được gán lớp vẫn giữ vai trò của mình. Riêng tài khoản Giảng viên được thêm làm CVHT thì chuyển sang vai trò `advisor` và bị đăng xuất.
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
- **Import** (đọc thẳng file phân công của Khoa "CVHT _Phan cong 2026_2027", commit 89c2e35):
  - Hàng tiêu đề nằm dưới các dòng tên trường, khoa, năm học; nhận dạng không phân biệt dấu, hoa thường: MGV hoặc Mã giảng viên, CVHT hoặc Họ và tên, EMAIL, MÃ LỚP hoặc Lớp phụ trách, Đơn vị (Bộ môn, Khoa). Các cột STT, KHÓA, SLSV, GHI CHÚ, CVHT NỘP KẾ HOẠCH… được bỏ qua.
  - MGV dạng số được đọc thành chữ. Ô lớp tách theo `,`, `;`, `/`, khoảng trắng và xuống dòng; số đứng một mình nối tiếp lớp đứng trước ("71K27CNTT01, 02, 03" là ba lớp). Cùng một email trên nhiều dòng thì gộp thành một CVHT.
  - Mọi trang tính đang hiện có dòng tiêu đề đều được đọc và gộp theo email; trang ẩn không bao giờ được đọc. Một lớp có hai CVHT, hoặc một email ghi hai họ tên hay hai MGV, là lỗi ở các dòng đó. Phần xem trước nói rõ đã đọc những trang nào và các trang có khớp nhau không.
  - Email phải là email của trường: miền cán bộ (`STAFF_EMAIL_DOMAINS`, mặc định vlu.edu.vn) hoặc miền sinh viên vanlanguni.vn
    (từ 2026-11-07). Tài khoản đang là sinh viên phải được đổi vai trò ở trang Tài khoản trước. `STAFF_EMAIL_DOMAINS` không đổi:
    nó còn quyết định tài khoản nào không bao giờ vào cổng sinh viên. Lớp chưa có sinh viên chỉ là cảnh báo.
  - File năm học 2026–2027: hai trang đang hiện (GUI PDT 30 dòng, theo lớp 120 dòng) ghi cùng một phân công, 30 CVHT và 120 lớp. "Tải file mẫu" theo đúng bố cục này.
  - Tệp là nguồn chuẩn cho những CVHT có trong tệp; lớp ghi cho người khác thì được chuyển sang (có dòng "Lớp … chuyển từ …"). CVHT không có trong tệp giữ nguyên.
  - Thêm hoặc sửa tay thì báo `class_taken` khi lớp đã có người phụ trách.
- **`/api/admin/advisor-portal`** (`portal-router.ts`):
  - `GET /me`, `/classes` (AD-AST-01);
  - `/students` (AD-AST-02…04): tìm, lọc theo lớp và tình trạng, sắp xếp, phân trang;
  - `POST /students/:id/open` (AD-AST-05, ghi nhật ký);
  - `/permissions` (AD-AST-09, nội dung ở `permissions.ts`).

## Mở trang sinh viên (AD-AST-05…08)
- **Mở trang:** "Xem chi tiết" mở `/dashboard?sv=<id>#overview` ở một thẻ mới.
  - Thẻ đó giữ mã sinh viên trong `sessionStorage`, nên mỗi thẻ chỉ một sinh viên (`apps/web/src/advisor-view.ts`).
  - Mọi request `/api/student…` của thẻ mang header `X-Advisor-Student`.
- **Kiểm tra ở API:** `advisorActing` kiểm tra ở từng request rằng tài khoản vẫn phụ trách lớp của sinh viên, hoặc là quản trị viên, Ban chủ nhiệm khoa (khi đó mọi sinh viên đều được). Các router sinh viên đọc sinh viên qua `studentUser(req)`.
- **Việc được làm thay** (`ACTING_ACTIONS`):
  - Import bảng điểm, hủy lần import đang chạy;
  - Chuyên ngành và vị trí nghề nghiệp mục tiêu (từ 10/11/2026): `PATCH /profile` với đúng trường `specialty`, `careerPositionId` hoặc cả hai (`fields` của quy tắc); thân yêu cầu có trường khác hay không có trường nào đều bị từ chối. Router kiểm tra như khi sinh viên tự đổi (chuyên ngành thuộc ngành và khóa, vị trí còn trong danh mục). Nhật ký ghi "Đổi chuyên ngành thay sinh viên", "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên" hoặc "Đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên"; thông báo "… đã đổi chuyên ngành thay bạn" (khóa `specialty`, `career`, `goals`) kết thúc bằng câu sinh viên vẫn tự đổi lại được. Kết quả đánh giá đã có giữ nguyên; trang Đánh giá năng lực nhắc Đánh giá lại như khi sinh viên tự đổi;
  - Kế hoạch học kỳ (từ 10/11/2026): `PUT /study-plan`, như khi sinh viên tự sửa (thêm, bỏ, chuyển học phần, thêm học kỳ, Áp dụng hay Bỏ qua đề xuất, Ẩn thông báo). Trang tự lưu sau mỗi thay đổi, nên nhật ký ghi "Cập nhật Kế hoạch học kỳ thay sinh viên" tối đa một dòng cho mỗi tài khoản, sinh viên và nửa giờ (`logWindow`); thông báo "… đã cập nhật Kế hoạch học kỳ thay bạn" (khóa `plan`, mở Lộ trình học tập). `DELETE /study-plan` vẫn bị từ chối;
  - Khảo sát định hướng (từ 10/11/2026): `PUT /survey`, cùng kiểm tra câu trả lời như khi sinh viên tự lưu. Không ghi đồng ý thay sinh viên (header `X-Consent-Policy-Version` bị bỏ qua); khảo sát ghi người lưu (`saved_by`, `saved_by_role` là `advisor` hoặc `admin`, migration 062). Sinh viên đã bấm Xóa câu trả lời (rút đồng ý) thì không làm thay được (409 `survey_withdrawn`; `GET /survey` trả `withdrawn`). Nhật ký ghi "Làm Khảo sát định hướng thay sinh viên"; thông báo "… đã làm Khảo sát định hướng thay bạn" (khóa `survey`). `DELETE /survey` vẫn bị từ chối;
  - Đánh giá năng lực và tạo lại nhận xét AI;
  - Lộ trình AI;
  - Lời khuyên xét tốt nghiệp: `ensure` do trang tự gọi, không ghi nhật ký; `retry`;
  - Trợ lý AI: hỏi, hỏi lại, đánh giá câu trả lời.
- **Việc bị từ chối** (403 `advisor_action_not_allowed`): mọi thao tác ghi khác. CVHT cũng không đọc được thông báo của sinh viên.
- **Đồng ý:**
  - Import và đánh giá do CVHT làm không cần và không ghi đồng ý của sinh viên.
  - Nếu sinh viên đã tự xóa kết quả đánh giá (rút đồng ý), CVHT không chạy lại được (409 `assessment_withdrawn`).
  - Khảo sát định hướng do cán bộ làm thay được các chức năng AI dùng (Lộ trình AI, Trợ lý AI, Định hướng nghề nghiệp, thanh Hồ sơ và cổng đỏ ở Tổng quan) như khảo sát sinh viên tự làm và đồng ý, trừ khi sinh viên đã rút đồng ý (`surveyUsable` ở `student/survey.ts`, `SURVEY_COMPLETE_SQL` ở `admin/student-profiles.ts`). Khi sinh viên tự lưu lại, sinh viên đánh dấu ô đồng ý như thường và khảo sát thành của sinh viên (`saved_by` về NULL).
- **Trợ lý AI:** người mở trang chỉ thấy cuộc trò chuyện mình tạo. Sinh viên thấy tất cả: cuộc trò chuyện của CVHT có thẻ "Cố vấn học tập tạo", của quản trị viên hay Ban chủ nhiệm khoa có thẻ "Cán bộ Khoa tạo" (`createdByRole`).
- **Ghi lại và thông báo:** mỗi việc làm thay ghi một dòng nhật ký (loại `advisor`, hiện là "Làm thay sinh viên" ở trang Nhật ký; tên sinh viên, không có dữ liệu) và gửi thông báo cho sinh viên, tối đa một thông báo cho mỗi người, mỗi việc, mỗi ngày.
- **Mở trang sinh viên (QA 7/11/2026):** mọi lần đọc dữ liệu sinh viên qua `X-Advisor-Student` đều ghi một dòng "Mở trang sinh viên" vào nhật ký. Mỗi tài khoản với mỗi sinh viên chỉ ghi một lần trong 30 phút (`studentViews` trong `advisors/access.ts`), nên mở thẳng `/dashboard?sv=…` hay gọi API cũng đều được ghi. Khi làm thay sinh viên, nút Đánh giá năng lực, Đánh giá lại và Tạo lộ trình hỏi xác nhận trước (`acting-confirm.tsx`); từ 10/11/2026 cả Lưu thay đổi ở Mục tiêu học tập và Chọn làm vị trí nghề nghiệp mục tiêu ở Định hướng nghề nghiệp (`goalsConfirm`), Sửa kế hoạch ở Kế hoạch học kỳ (một lần cho mỗi lần mở trang, `planConfirm`) và Lưu khảo sát ở Khảo sát định hướng (`surveyConfirm`). Thanh thông báo hiện mã lớp chuẩn (`classCode`).
- **Giao diện của thẻ:** có dải "Bạn đang xem trang của … với tư cách cố vấn học tập" (hoặc "quản trị viên", "Ban chủ nhiệm khoa", theo vai trò của tài khoản) kèm nút "Đóng trang sinh viên", nút này quay về Quản lý sinh viên. Chuông và nút đăng xuất bị ẩn, cùng các nút không được dùng khi làm thay: xóa khảo sát, xóa dữ liệu, hỏi đồng ý. Từ 10/11/2026, Chỉnh sửa thông tin ở Mục tiêu học tập (cả Khám phá vị trí nghề nghiệp trong đó) và Chọn làm vị trí nghề nghiệp mục tiêu dùng được như ở trang của sinh viên. Kế hoạch học kỳ hiện như cũ, chỉ xem, cho đến khi bấm Sửa kế hoạch và xác nhận; sau đó sửa được như sinh viên. Khảo sát định hướng có Chỉnh sửa khảo sát (Làm khảo sát thay sinh viên khi chưa có); biểu mẫu không có ô đồng ý mà có dòng "Bạn làm khảo sát thay sinh viên; sinh viên sẽ nhận thông báo và có thể sửa lại.", không có Xóa câu trả lời. Dòng "Cập nhật lúc" của khảo sát do cán bộ làm thay ghi thêm "do cố vấn học tập làm thay" (hoặc "do cán bộ Khoa làm thay"), ở trang của sinh viên lẫn khi làm thay. Thanh Hồ sơ của sinh viên lấy mục còn thiếu đầu tiên làm bước tiếp theo, cả khảo sát. Các dòng ghi chú của thẻ nói với người đang xem ("bạn chỉ xem").

## Kiểm thử (03/11/2026)
- **Tự động:** API 1620 test, web 604 test.
- **Trên schema local `e2e_k26k31`** (tài khoản giả "Cố vấn Thử nghiệm" phụ trách 71K29CNTT99 và 71K31CNTT99):
  - 32 bước API: quyền, phạm vi, làm thay, thông báo, nhật ký, import và chuyển lớp;
  - Trợ lý AI và import bảng điểm làm thay;
  - 15 bước giao diện trên Chrome headless.
- **Script:** thư mục scratchpad `advisors/` (prep, api-check, assistant-check, upload-check, ui-check).
