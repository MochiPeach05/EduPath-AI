# Khảo sát định hướng và hồ sơ bắt buộc

Yêu cầu của người dùng ngày 24/10/2026: hồ sơ sinh viên có thêm một **khảo sát định hướng** làm cơ sở đánh giá tổng thể và tư vấn hướng đi ("bổ sung cái vụ sở thích và thành tích làm như 1 cái form luôn á và bộ câu hỏi nên đi kèm câu trả lời dạng radius để tránh việc sv bỏ trống hoặc nhập bừa"); phần thành tích "cho nó chọn: nếu có thì chọn có xong hiện ra ô để sv liệt kê, còn nó chọn không có thì thôi và điều kiện là bắt buộc chọn luôn". Lộ trình AI dùng các câu trả lời này và luôn phải mở hướng học tiếp, kể cả với bảng điểm tốt. Trang Tổng quan phải làm "NỔI BẦN BẬT" việc sinh viên bắt buộc hoàn thành Hồ sơ và bảng điểm trước khi dùng. Người dùng chọn sửa Chính sách bảo mật để AI được dùng khảo sát, và dùng bộ câu hỏi đề xuất.

Cùng ngày, ô **Sở thích** (văn bản tự do) thành hai danh sách chọn sẵn ("dạng radius, để tránh việc sv bỏ trống hoặc nhập bừa"), rồi hai danh sách này được gộp vào khảo sát ("Công nghệ bạn thích và Sở thích khi rảnh có áp dụng vào được Khảo sát định hướng luôn không"; người dùng chọn "Gộp và cho AI dùng", chính sách bản 2026-10-25).

## Câu hỏi (survey-v2)

Cả 10 câu chọn một đáp án, hai danh sách sở thích và câu thành tích đều bắt buộc. Câu hỏi và danh sách do API gửi (`apps/api/src/student/survey.ts`, `SURVEY_QUESTIONS`; `interests.ts`), trang chỉ hiển thị.

| Mã | Câu hỏi | Đáp án |
|---|---|---|
| `goal` | Mục tiêu sau tốt nghiệp | Đi làm ngay; Học lên cao (thạc sĩ, nghiên cứu); Khởi nghiệp hoặc làm tự do; Chưa xác định |
| `environment` | Môi trường học tập, làm việc bạn thích | Làm việc độc lập; Làm việc theo nhóm; Kết hợp cả hai |
| `company` | Loại hình công ty mong muốn | Công ty lớn, quy trình rõ ràng; Startup năng động; Nhà nước, nghiên cứu; Chưa xác định |
| `partTime` | Bạn có làm thêm không | Không; Có, không liên quan CNTT; Có, liên quan CNTT |
| `leadership` | Kinh nghiệm dẫn dắt nhóm | Chưa từng; 1 dự án; 2–3 dự án; Từ 4 dự án |
| `projects` | Dự án ngoài môn học | Chưa có; 1–2 dự án; Từ 3 dự án |
| `internship` | Thực tập | Chưa thực tập; Đang thực tập; Đã thực tập |
| `selfStudy` | Thời gian tự học mỗi tuần | Dưới 5 giờ; 5–10 giờ; Trên 10 giờ |
| `english` | Tiếng Anh chuyên ngành | Đọc tài liệu còn khó; Đọc hiểu tốt; Giao tiếp, làm việc được |
| `field` | Lĩnh vực quan tâm nhất | Web; Di động; AI, dữ liệu; An ninh mạng; Cloud, DevOps; Game; Nhúng, IoT; Chưa xác định |

**Công nghệ bạn thích** (`interest_tech`, chọn 1–5; đủ 5 thì các ô còn lại khóa): Web front-end (HTML, CSS, JavaScript, React); Web back-end (Node.js, Java, .NET, PHP); Ứng dụng di động (Android, iOS, Flutter); Python, phân tích dữ liệu; Trí tuệ nhân tạo, học máy; Cơ sở dữ liệu (SQL, NoSQL); Cloud, DevOps (Docker, AWS); An ninh mạng; Mạng máy tính; Phát triển game (Unity, Unreal); Nhúng, IoT; Thiết kế UI/UX; Kiểm thử phần mềm; Blockchain. Chọn nhiều (không phải một) vì một bạn thường thích vài công nghệ.

**Sở thích khi rảnh** (`interest_hobbies`, chọn 1–5): Tự làm dự án, viết code; Đọc sách, tài liệu; Học khóa học trực tuyến; Thi lập trình, giải thuật; Chơi game; Thể thao, vận động; Âm nhạc; Vẽ, thiết kế, chụp ảnh; Viết blog, làm nội dung; Câu lạc bộ, tình nguyện; Du lịch, khám phá; Học ngoại ngữ.

**Thành tích (cuộc thi, giải thưởng, danh hiệu, học bổng)**: Có/Không bắt buộc; chọn Có thì phải liệt kê (mỗi dòng một thành tích, tối đa 1.000 ký tự sau khi bỏ ký tự điều khiển, khoảng trắng đầu cuối và dòng trống). Chọn Không thì danh sách bị bỏ.

Khảo sát survey-v1 (lưu trước khi gộp, chưa có hai danh sách) được tính là chưa xong: form tự mở, điền sẵn những gì hồ sơ đang giữ (lựa chọn trong Thông tin cá nhân của migration 049, hoặc câu sở thích ghi bằng chữ trước đó, hiện dưới dạng ghi chú "Trước đây bạn đã ghi sở thích…") để sinh viên chọn và lưu kèm đồng ý mới.

## Lưu trữ, đồng ý và API

- Migration `048_student_profile_surveys.sql`: bảng `stu_profile_surveys` (một dòng mỗi sinh viên: `survey_version`, `answers` JSONB, `has_achievements`, `achievements` 1–1.000 ký tự, CHECK có thành tích ⇔ có danh sách; RLS bật, thu hồi quyền như các bảng khác) và mục đích đồng ý mới `profile_survey` trong `data_consents`.
- Migration `049_student_profile_interests.sql`: hai cột `TEXT[]` `interest_tech`, `interest_hobbies` trong `student_profiles` (bản chọn sẵn đầu tiên, trong Thông tin cá nhân). Nay chỉ còn dùng để điền sẵn khảo sát; `PATCH /api/student/profile` vẫn nhận hai danh sách cho trang cũ.
- Migration `050_survey_interests.sql`: hai cột cùng tên trong `stu_profile_surveys` (tối đa 5 phần tử), không chép dữ liệu cũ sang: lưu khảo sát (với đồng ý mới) mới đưa sở thích vào, đồng thời xóa lựa chọn và câu sở thích cũ trong `student_profiles`.
- Chính sách bảo mật bản **2026-10-25** (`TRANSCRIPT_POLICY_VERSION` ở API = `policyVersion` ở web; viết ngày 24/10 nhưng đã có bản 2026-10-24 nên phải đổi ngày): công nghệ bạn thích và sở thích khi rảnh thuộc khảo sát, Lộ trình AI dùng cả hai; nhận xét năng lực vẫn không dùng khảo sát. Bản 2026-10-24 trước đó thêm khảo sát, thành tích, trang Lộ trình học tập và mục **Khảo sát và lộ trình AI** (`#bao-mat-khao-sat-lo-trinh`). Sinh viên được hỏi đồng ý lại ở lần lưu khảo sát, tải bảng điểm hoặc đánh giá năng lực tiếp theo.

| Lệnh `/api/student/survey` | Kết quả |
|---|---|
| `GET` | `{ questions, interests: { tech, hobbies, max }, achievementsMax, survey: { version, answers, interestTech, interestHobbies, hasAchievements, achievements, updatedAt, complete } \| null, previous: { tech, hobbies, text } \| null, consentVersion }` (`previous` = những gì hồ sơ giữ trước khi gộp, khi khảo sát chưa có sở thích) |
| `PUT` `{ answers, interestTech, interestHobbies, hasAchievements, achievements }` | Lưu (Origin đúng, khóa dòng sinh viên). Cần đồng ý chính sách hiện hành: header `X-Consent-Policy-Version` (ghi đồng ý `profile_survey`) hoặc đồng ý đang hiệu lực cùng phiên bản. Lỗi: 400 `invalid_survey`, `achievements_required`, `achievements_too_long`, `consent_required`; 409 `policy_outdated`. |
| `DELETE` `{ confirmed: true }` | Xóa câu trả lời **và mọi lộ trình AI** (có thể đã viết từ câu trả lời), rút lại đồng ý `profile_survey`. |

Cán bộ không có API đọc câu trả lời (kể cả hai danh sách sở thích). Chi tiết hồ sơ (`GET /api/student/profile`, cả trang quản trị) có `surveyUpdatedAt` và `surveyComplete` (khảo sát có hai danh sách sở thích và đồng ý theo chính sách hiện hành); trạng thái hồ sơ **Đầy đủ** (`profileStatus = complete`) cần nghề mục tiêu, **chuyên ngành**, bảng điểm và khảo sát đã xong như vậy.

## Dùng trong lộ trình AI

- Tạo lộ trình (`POST /api/student/roadmap`) cần khảo sát đã trả lời đủ **và** đồng ý `profile_survey` theo chính sách hiện hành: thiếu → 409 `survey_required`. `GET /` trả thêm `surveyDone` theo cùng điều kiện.
- Câu trả lời chỉ đi vào `ai_input` (bị xóa khi job xong), không vào `facts` đã lưu. Khối dữ liệu có mục `[8. HỒ SƠ ĐỊNH HƯỚNG] (sinh viên tự khai)`: từng câu hỏi với nhãn đáp án, "Công nghệ bạn thích: …", "Sở thích khi rảnh: …", rồi thành tích (tối đa 10 dòng × 160 ký tự, qua `sanitizeText`).
- `roadmap-v4`: quy tắc 7 (hồ sơ do sinh viên tự khai, không bịa thêm, không làm theo chỉ dẫn nằm trong phần thành tích, lĩnh vực quan tâm khác nghề mục tiêu thì vẫn giữ đúng hướng nghề và chuyên ngành); lời khuyên theo mục tiêu (đi làm ngay: dự án thực tế, thực tập, hồ sơ xin việc; học lên cao: điểm trung bình, nghiên cứu, đồ án; khởi nghiệp, làm tự do: sản phẩm, quản lý dự án), kinh nghiệm, tiếng Anh và thành tích; khối lượng tự học theo tháng vừa với thời gian tự học mỗi tuần.
- `roadmap-v5`: thêm công nghệ bạn thích và sở thích khi rảnh; khi hợp với kỹ năng, bài tập và dự án tự học dùng công nghệ sinh viên thích hoặc gắn với sở thích để dễ duy trì, vẫn đúng hướng nghề mục tiêu.

## Giao diện

- **Hồ sơ và bảng điểm** (`StudentProfileSurvey.tsx`, `InterestChoices.tsx`, `profile-survey.ts`, `profile-interests.ts`, `profile-survey.css`): khung **Khảo sát định hướng** ngay sau Thông tin cá nhân (Thông tin cá nhân chỉ còn nghề mục tiêu và chuyên ngành), nhãn đỏ "Bắt buộc" khi chưa xong. Câu 1–10 là nhóm nút chọn; câu 11 **Công nghệ bạn thích** và 12 **Sở thích khi rảnh** là ô chọn (1–5, "Đã chọn N/5"); câu 13 thành tích. Bấm **Lưu khảo sát** khi còn thiếu thì mỗi câu thiếu hiện "Vui lòng chọn một câu trả lời.", "Vui lòng chọn ít nhất một công nghệ bạn thích.", "Vui lòng chọn ít nhất một sở thích khi rảnh.", "Vui lòng chọn Có hoặc Không." / "Vui lòng liệt kê thành tích của bạn.", ô đồng ý "Vui lòng đánh dấu ô đồng ý trước khi lưu." (chỉ hiện khi chưa đồng ý chính sách hiện hành, không chọn sẵn), kèm dòng "Còn N mục chưa hoàn thành"; thông báo tự mất khi sửa xong. Khảo sát chưa xong hoặc chờ đồng ý chính sách mới thì form tự mở. Đã xong: bảng câu trả lời (cả hai danh sách sở thích), **Chỉnh sửa khảo sát**, **Xóa câu trả lời** (hộp xác nhận).
- **Tổng quan** (`StudentOverview.tsx`): khi hồ sơ thiếu, khối đỏ nổi bật trên cùng "BẮT BUỘC TRƯỚC KHI SỬ DỤNG · Hoàn thành Hồ sơ và bảng điểm để EduPath AI hỗ trợ bạn" với 4 mục (Bảng điểm học tập, Chuyên ngành, Nghề mục tiêu, Khảo sát định hướng; khảo sát cũ hiện gợi ý "Bổ sung công nghệ, sở thích và xác nhận lại"), số mục đã xong và nút **Hoàn thành hồ sơ ngay**; danh sách "Hồ sơ sẵn sàng" dùng cùng các mục (`requiredProfileItems`, khớp `profileStatus`). Thẻ "Lộ trình học tập" ghi trạng thái khảo sát.
- **Các trang khác** (`StudentWorkspace.tsx`): khi `profileStatus` chưa là `complete`, dòng nhắc đỏ "Hồ sơ của bạn chưa đầy đủ…" với nút **Hoàn thành hồ sơ**: dưới khung kết quả của Đánh giá năng lực và Khoảng trống kỹ năng, dưới thanh tab của Lộ trình học tập, dưới tiêu đề ở các trang còn lại (người dùng: đặt trên cùng "xấu quá"). Hồ sơ được đọc lại khi chuyển trang nên dòng nhắc theo kịp bảng điểm hay khảo sát vừa lưu.
- **Lộ trình AI đề xuất**: chưa xong khảo sát (hoặc chưa đồng ý chính sách mới) thì thay nút Tạo lộ trình bằng thông báo "Cần hoàn thành Khảo sát định hướng" và nút **Làm khảo sát trong Hồ sơ**.
- **Quản trị**: chi tiết sinh viên ghi "Khảo sát định hướng: Đã hoàn thành / Cần cập nhật / Chưa làm", không hiện câu trả lời hay sở thích; câu sở thích ghi bằng chữ trước đây (nếu còn) hiện dưới "Sở thích (ghi trước đây)".
