# Định hướng nghề nghiệp

Trang `#career` của cổng sinh viên. Người dùng (24/10/2026): "Giờ làm cho tôi phần Định hướng nghề nghiệp này đi hiện tại tôi chưa có functionlist nên bạn cứ làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài này". Thay trang "Sắp ra mắt" có ba bước (Khám phá vị trí nghề nghiệp, Lựa chọn nghề nghiệp mục tiêu, So sánh nhiều nghề nghiệp) bằng trang làm đủ ba việc đó.

Theo nguyên tắc chung của đề tài, **hệ thống tính**: mức phù hợp với từng nghề dùng đúng phép tính của trang Khoảng trống kỹ năng; không có phần AI (không gửi gì cho mô hình).

## Trang (`apps/web/src/StudentCareerGuidance.tsx`, `career-guidance-data.ts`, `career-guidance.css`)

- **Định hướng nghề nghiệp của bạn**: giải thích ngắn, **Nghề mục tiêu hiện tại** (mức phù hợp, liên kết Khoảng trống kỹ năng). Khi chưa tính được (chưa có bảng điểm, chưa chọn chuyên ngành, Khoa chưa có CTĐT hay chưa cấu hình kỹ năng…) có thông báo và nút mở Hồ sơ; vẫn xem được danh mục nghề và yêu cầu.
- **Gợi ý**: hai cột, mỗi cột tối đa 3 nghề:
  - *Phù hợp nhất với năng lực hiện tại*: mức phù hợp cao nhất (bỏ nghề "Chưa đủ dữ liệu").
  - *Hợp với sở thích và thế mạnh của bạn*: nghề khớp **Lĩnh vực quan tâm nhất** và **Thế mạnh của bạn** (công nghệ thành thạo) trong Khảo sát định hướng (khớp lĩnh vực trước, rồi nhiều công nghệ hơn, rồi mức phù hợp). Chưa làm khảo sát thì mời làm khảo sát.
- **Tất cả nghề nghiệp**: tìm theo tên (không dấu), lọc lĩnh vực, sắp xếp "Phù hợp nhất trước" hoặc "Tên A–Z", "Chỉ nghề hợp sở thích". Mỗi dòng: tên Việt/Anh, lĩnh vực, điểm phù hợp /100, mức (thang 5 bậc như Khoảng trống kỹ năng), "Đạt x/y kỹ năng", thanh điểm, dòng "Lĩnh vực bạn quan tâm / Công nghệ bạn thích" khi khớp; nút **Xem chi tiết**, ô **So sánh**, **Chọn làm mục tiêu** (hoặc nhãn "Nghề mục tiêu của bạn").
- **Xem chi tiết** (hộp thoại): mô tả nghề, từng yêu cầu (kỹ năng, Bắt buộc/Ưu tiên) với mức hiện tại của bạn (Đạt, Thiếu N điểm, Chưa học, Sắp học · học kỳ, Chưa đủ dữ liệu) và các kỹ năng nên nâng.
- **So sánh nghề nghiệp**: chọn 2–3 nghề (thanh dưới cùng cho biết đã chọn những nghề nào), bảng theo cột: lĩnh vực, mức phù hợp, kỹ năng đạt, phần khớp khảo sát, rồi mỗi kỹ năng mà ít nhất một nghề yêu cầu (kỹ năng chung nhiều nghề lên trước) với trạng thái của bạn hoặc "Không yêu cầu".
- **Chọn làm mục tiêu**: lưu ngay bằng `PATCH /api/student/profile { careerPositionId }` (như hộp Khám phá nghề nghiệp của Hồ sơ), rồi nhắc bấm **Đánh giá lại** ở Đánh giá năng lực để Khoảng trống kỹ năng và Lộ trình học tập theo nghề mới. Hồ sơ trong khung trang được đọc lại.

Thẻ "Định hướng của bạn" ở Tổng quan nay dẫn tới trang này.

## API (`apps/api/src/career-guidance/`)

`GET /api/student/career-guidance` (đăng nhập, tài khoản còn hoạt động, `Cache-Control: no-store`, chỉ đọc, giao dịch `REPEATABLE READ READ ONLY`) trả:

```
{ blocked: string | null, targetCareerId, surveyDone, fields: [{ code, name }],
  careers: [{ id, code, nameVi, nameEn, category, categoryName, description, isTarget,
    fit: { score, code, label, dataShare, met, below, notStudied, upcoming, noData, total } | null,
    requirements: [{ title, skillName, isRequired, status, statusLabel, score, threshold, deficit, upcomingTerm }],
    interests: { field: string | null, tech: string[] } }] }
```

- **Mức phù hợp**: `readAssessmentInputs(…, { careerOptional: true })` đọc bảng điểm, CTĐT, trọng số, tiêu chuẩn và kế hoạch như khi đánh giá năng lực (không cần đã chọn nghề), rồi `careerFitsFor(inputs, catalog)` (`competency-assessment/calculate.ts`) chạy phần nghề nghiệp của phép đánh giá (§7.5, §7.6) cho từng nghề, không tính lịch sử. Tính từ bảng điểm hiện tại, nên có thể khác kết quả đánh giá đã lưu nếu bảng điểm hay cấu hình đổi sau lần đánh giá. Khoảng 35 ms cho 30 nghề với sinh viên giả lập; khoảng 0,2–0,4 giây một lần gọi trên máy thử.
- `blocked`: mã lỗi của `readAssessmentInputs` (`transcript_required`, `specialty_required`, `cohort_unknown`, `curriculum_unavailable`, `curriculum_ambiguous`, `competency_weights_unavailable`); khi đó `fit` = null, yêu cầu không có trạng thái.
- **Khớp khảo sát** (`interests.ts`): tên nghề (Việt + Anh) và tên lĩnh vực đọc không dấu, so với quy tắc của từng câu trả lời Lĩnh vực quan tâm nhất (Web, Di động, AI và dữ liệu, An ninh mạng, Cloud/DevOps, Game, Nhúng/IoT) và từng công nghệ bạn thích. Danh mục do Khoa quản lý nên khớp theo tên; nghề không quy tắc nào nhận ra thì không có dòng khớp. Chỉ hiện cho chính sinh viên, không gửi cho AI. Chính sách bảo mật (mục "Thông tin của bạn được dùng để làm gì?": giúp bạn tìm hiểu các vị trí nghề nghiệp và lưu mục tiêu) bao gồm việc này.
- Thứ tự: mức phù hợp giảm dần (nghề "Chưa đủ dữ liệu" hay chưa tính xếp cuối), rồi tên.

## Kiểm thử

- `apps/api/src/career-guidance/career-guidance.test.ts`: khớp khảo sát trên tên nghề thật của danh mục, `guidanceCareers` cho kết quả như trang Khoảng trống kỹ năng với nghề mục tiêu, API khi chưa có bảng điểm.
- `apps/api/src/competency-assessment/career-fit.test.ts`: `careerFitsFor` cho đúng phần nghề nghiệp của `calculateAssessment`, đủ nhanh.
- `apps/web/src/career-guidance-data.test.ts`: gợi ý, lọc, trạng thái từng yêu cầu, bảng so sánh, giới hạn 3 nghề.
