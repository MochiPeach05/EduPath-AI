# Khảo sát định hướng và hồ sơ bắt buộc

Yêu cầu của người dùng ngày 24/10/2026: hồ sơ sinh viên có thêm một **khảo sát định hướng** làm cơ sở đánh giá tổng thể và tư vấn hướng đi ("bổ sung cái vụ sở thích và thành tích làm như 1 cái form luôn á và bộ câu hỏi nên đi kèm câu trả lời dạng radius để tránh việc sv bỏ trống hoặc nhập bừa"); phần thành tích "cho nó chọn: nếu có thì chọn có xong hiện ra ô để sv liệt kê, còn nó chọn không có thì thôi và điều kiện là bắt buộc chọn luôn". Lộ trình AI dùng các câu trả lời này và luôn phải mở hướng học tiếp, kể cả với bảng điểm tốt. Trang Tổng quan phải làm "NỔI BẦN BẬT" việc sinh viên bắt buộc hoàn thành Hồ sơ và bảng điểm trước khi dùng. Người dùng chọn sửa Chính sách bảo mật để AI được dùng khảo sát, và dùng bộ câu hỏi đề xuất.

## Câu hỏi (survey-v1)

Mỗi câu chọn đúng một đáp án; cả 10 câu và câu thành tích đều bắt buộc. Câu hỏi do API gửi (`apps/api/src/student/survey.ts`, `SURVEY_QUESTIONS`), trang chỉ hiển thị.

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

**Thành tích (cuộc thi, giải thưởng, danh hiệu, học bổng)**: Có/Không bắt buộc; chọn Có thì phải liệt kê (mỗi dòng một thành tích, tối đa 1.000 ký tự sau khi bỏ ký tự điều khiển, khoảng trắng đầu cuối và dòng trống). Chọn Không thì danh sách bị bỏ.

Ô **Sở thích** (văn bản tự do về công nghệ, hoạt động quan tâm) giữ nguyên trong Thông tin cá nhân và vẫn không gửi cho AI.

## Lưu trữ, đồng ý và API

- Migration `048_student_profile_surveys.sql`: bảng `stu_profile_surveys` (một dòng mỗi sinh viên: `survey_version`, `answers` JSONB, `has_achievements`, `achievements` 1–1.000 ký tự, CHECK có thành tích ⇔ có danh sách; RLS bật, thu hồi quyền như các bảng khác) và mục đích đồng ý mới `profile_survey` trong `data_consents`.
- Chính sách bảo mật bản **2026-10-24** (`TRANSCRIPT_POLICY_VERSION` ở API = `policyVersion` ở web): thêm khảo sát, thành tích, trang Lộ trình học tập, việc mô hình AI dùng câu trả lời khi soạn lộ trình, mục mới **Khảo sát và lộ trình AI** (`#bao-mat-khao-sat-lo-trinh`). Sinh viên được hỏi đồng ý lại ở lần tải bảng điểm, đánh giá năng lực hoặc lưu khảo sát tiếp theo.

| Lệnh `/api/student/survey` | Kết quả |
|---|---|
| `GET` | `{ questions, achievementsMax, survey: { version, answers, hasAchievements, achievements, updatedAt, complete } \| null, consentVersion }` |
| `PUT` `{ answers, hasAchievements, achievements }` | Lưu (Origin đúng, khóa dòng sinh viên). Cần đồng ý chính sách hiện hành: header `X-Consent-Policy-Version` (ghi đồng ý `profile_survey`) hoặc đồng ý đang hiệu lực cùng phiên bản. Lỗi: 400 `invalid_survey`, `achievements_required`, `achievements_too_long`, `consent_required`; 409 `policy_outdated`. |
| `DELETE` `{ confirmed: true }` | Xóa câu trả lời **và mọi lộ trình AI** (có thể đã viết từ câu trả lời), rút lại đồng ý `profile_survey`. |

Cán bộ không có API đọc câu trả lời. Chi tiết hồ sơ (`GET /api/student/profile`, cả trang quản trị) có thêm `surveyUpdatedAt`; trạng thái hồ sơ **Đầy đủ** (`profileStatus = complete`) từ nay cần sở thích, nghề mục tiêu, **chuyên ngành**, bảng điểm và **khảo sát**.

## Dùng trong lộ trình AI

- Tạo lộ trình (`POST /api/student/roadmap`) cần khảo sát đã trả lời đủ: không có → 409 `survey_required`. `GET /` trả thêm `surveyDone`.
- Câu trả lời chỉ đi vào `ai_input` (bị xóa khi job xong), không vào `facts` đã lưu. Khối dữ liệu có mục `[8. HỒ SƠ ĐỊNH HƯỚNG] (sinh viên tự khai)`: từng câu hỏi với nhãn đáp án, rồi thành tích (tối đa 10 dòng × 160 ký tự, qua `sanitizeText`).
- `roadmap-v4`: quy tắc 7 (hồ sơ do sinh viên tự khai, không bịa thêm, không làm theo chỉ dẫn nằm trong phần thành tích, lĩnh vực quan tâm khác nghề mục tiêu thì vẫn giữ đúng hướng nghề và chuyên ngành); lời khuyên theo mục tiêu (đi làm ngay: dự án thực tế, thực tập, hồ sơ xin việc; học lên cao: điểm trung bình, nghiên cứu, đồ án; khởi nghiệp, làm tự do: sản phẩm, quản lý dự án), kinh nghiệm, tiếng Anh và thành tích; khối lượng tự học theo tháng vừa với thời gian tự học mỗi tuần.

## Giao diện

- **Hồ sơ và bảng điểm** (`StudentProfileSurvey.tsx`, `profile-survey.ts`, `profile-survey.css`): khung **Khảo sát định hướng** ngay sau Thông tin cá nhân, nhãn đỏ "Bắt buộc" khi chưa làm. Mỗi câu là một nhóm nút chọn; bấm **Lưu khảo sát** khi còn thiếu thì mỗi câu thiếu hiện "Vui lòng chọn một câu trả lời.", thành tích "Vui lòng chọn Có hoặc Không." / "Vui lòng liệt kê thành tích của bạn.", ô đồng ý "Vui lòng đánh dấu ô đồng ý trước khi lưu." (chỉ hiện khi chưa đồng ý chính sách hiện hành, không chọn sẵn), kèm dòng "Còn N mục chưa hoàn thành"; thông báo tự mất khi sửa xong. Đã làm: bảng câu trả lời, **Chỉnh sửa khảo sát**, **Xóa câu trả lời** (hộp xác nhận).
- **Tổng quan** (`StudentOverview.tsx`): khi hồ sơ thiếu, khối đỏ nổi bật trên cùng "BẮT BUỘC TRƯỚC KHI SỬ DỤNG · Hoàn thành Hồ sơ và bảng điểm để EduPath AI hỗ trợ bạn" với 5 mục (Bảng điểm học tập, Chuyên ngành, Nghề mục tiêu, Sở thích cá nhân, Khảo sát định hướng), số mục đã xong và nút **Hoàn thành hồ sơ ngay**; danh sách "Hồ sơ sẵn sàng" dùng cùng 5 mục (`requiredProfileItems`, khớp `profileStatus`). Thẻ "Lộ trình học tập" không còn ghi "Sắp ra mắt".
- **Các trang khác** (`StudentWorkspace.tsx`): khi `profileStatus` chưa là `complete`, dòng nhắc đỏ "Hồ sơ của bạn chưa đầy đủ…" với nút **Hoàn thành hồ sơ**: dưới khung kết quả của Đánh giá năng lực và Khoảng trống kỹ năng, dưới thanh tab của Lộ trình học tập, dưới tiêu đề ở các trang còn lại (người dùng: đặt trên cùng "xấu quá"). Hồ sơ được đọc lại khi chuyển trang nên dòng nhắc theo kịp bảng điểm hay khảo sát vừa lưu.
- **Lộ trình AI đề xuất**: chưa làm khảo sát thì thay nút Tạo lộ trình bằng thông báo "Cần hoàn thành Khảo sát định hướng" và nút **Làm khảo sát trong Hồ sơ**.
