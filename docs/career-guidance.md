# Định hướng nghề nghiệp

Trang `#career` của cổng sinh viên. Người dùng (24/10/2026): "Giờ làm cho tôi phần Định hướng nghề nghiệp này đi hiện tại tôi chưa có functionlist nên bạn cứ làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài này". Thay trang "Sắp ra mắt" có ba bước (Khám phá vị trí nghề nghiệp, Lựa chọn nghề nghiệp mục tiêu, So sánh nhiều nghề nghiệp) bằng trang làm đủ ba việc đó.

Theo nguyên tắc chung của đề tài, **hệ thống tính**: mức phù hợp với từng nghề dùng đúng phép tính của trang Khoảng trống kỹ năng; không có phần AI (không gửi gì cho mô hình). Từ comp-calc-v14 trang và Khoảng trống kỹ năng hiện giống hệt nhau (mục "Đồng bộ với Khoảng trống kỹ năng").

## Trang (`apps/web/src/StudentCareerGuidance.tsx`, `career-guidance-data.ts`, `career-guidance.css`)

- **Định hướng nghề nghiệp của bạn**: giải thích ngắn, **Nghề mục tiêu hiện tại** (mức phù hợp, liên kết Khoảng trống kỹ năng). Khi chưa tính được (chưa có bảng điểm, chưa chọn chuyên ngành, Khoa chưa có CTĐT hay chưa cấu hình kỹ năng…) có thông báo và nút mở Hồ sơ; vẫn xem được danh mục nghề và yêu cầu.
- **Gợi ý**: hai cột, mỗi cột tối đa 3 nghề:
  - *Phù hợp nhất với năng lực hiện tại*: mức phù hợp cao nhất (bỏ nghề "Chưa đủ dữ liệu").
  - *Hợp với sở thích và thế mạnh của bạn*: nghề khớp **Lĩnh vực quan tâm nhất** và **Thế mạnh của bạn** (công nghệ thành thạo) trong Khảo sát định hướng (khớp lĩnh vực trước, rồi nhiều công nghệ hơn, rồi mức phù hợp). Chưa làm khảo sát thì mời làm khảo sát.
- **Tất cả nghề nghiệp**: tìm theo tên (không dấu), lọc lĩnh vực, sắp xếp "Phù hợp nhất trước" hoặc "Tên A–Z", "Chỉ nghề hợp sở thích". Mỗi dòng: tên Việt/Anh, lĩnh vực, điểm phù hợp /100, mức (thang 5 bậc như Khoảng trống kỹ năng), "Đạt x/y kỹ năng", thanh điểm, dòng "Lĩnh vực bạn quan tâm / Công nghệ bạn thích" khi khớp; nút **Xem chi tiết**, ô **So sánh**, **Chọn nghề mục tiêu** (hoặc nhãn "Nghề mục tiêu của bạn").
- **Xem chi tiết** (hộp thoại): mô tả nghề, từng yêu cầu (kỹ năng, Bắt buộc/Ưu tiên) với mức hiện tại của bạn (Đạt, Thiếu N điểm, Chưa học, Sắp học · học kỳ, Chưa đủ dữ liệu) và các kỹ năng nên nâng.
- **So sánh nghề nghiệp**: chọn 2–3 nghề (thanh dưới cùng cho biết đã chọn những nghề nào), bảng theo cột: lĩnh vực, mức phù hợp, kỹ năng đạt, phần khớp khảo sát, rồi mỗi kỹ năng mà ít nhất một nghề yêu cầu (kỹ năng chung nhiều nghề lên trước) với trạng thái của bạn hoặc "Không yêu cầu".
- **Chọn nghề mục tiêu**: lưu ngay bằng `PATCH /api/student/profile { careerPositionId }` (như hộp Khám phá nghề nghiệp của Hồ sơ), rồi nhắc bấm **Đánh giá lại** ở Đánh giá năng lực để Khoảng trống kỹ năng và Lộ trình học tập theo nghề mới. Hồ sơ trong khung trang được đọc lại.

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
- `blocked` = `assessment_withdrawn` (29/10/2026): sinh viên đã bấm **Xóa kết quả đánh giá** ở trang Đánh giá năng lực, tức là rút lại sự đồng ý `competency_assessment`, và chưa đồng ý lại.
  - API không đọc bảng điểm và không tính mức phù hợp nào. Trang báo lý do và có nút **Mở Đánh giá năng lực**; ghi chú dưới nghề mục tiêu được ẩn.
  - Người dùng nêu (29/10): "Khi người dùng đã xóa kết quả năng lực cũ thì nó nên ghi rõ đây là kết quả cũ hoặc là xóa luôn chứ". Trước bản sửa, trang vẫn tính lại từ bảng điểm nên trông như kết quả cũ chưa bị xóa.
  - Sinh viên chưa từng đánh giá vẫn thấy mức phù hợp, để chọn nghề mục tiêu trước lần đánh giá đầu tiên.
- **Khớp khảo sát** (`interests.ts`): tên nghề (Việt + Anh) và tên lĩnh vực đọc không dấu, so với quy tắc của từng câu trả lời Lĩnh vực quan tâm nhất (Web, Di động, AI và dữ liệu, An ninh mạng, Cloud/DevOps, Game, Nhúng/IoT) và từng công nghệ bạn thích. Danh mục do Khoa quản lý nên khớp theo tên; nghề không quy tắc nào nhận ra thì không có dòng khớp. Chỉ hiện cho chính sinh viên, không gửi cho AI. Chính sách bảo mật (mục "Thông tin của bạn được dùng để làm gì?": giúp bạn tìm hiểu các vị trí nghề nghiệp và lưu mục tiêu) bao gồm việc này.
- Thứ tự: mức phù hợp giảm dần (nghề "Chưa đủ dữ liệu" hay chưa tính xếp cuối), rồi tên.

## Đồng bộ với Khoảng trống kỹ năng (comp-calc-v14, 24/10/2026)

Người dùng: "Điểm không đồng bộ sai cách tính rất nhiều chỗ ở phần định hướng nghề nghiệp và cách tính hầu hết bảng nghề nghiệp ở đây có vấn đề hết". Ba agent rà trên dữ liệu giả lập K26–K31 (156 cặp sinh viên × nghề); sau khi sửa không còn chỗ lệch nào giữa hai trang (tiêu đề, dòng đếm, thứ tự, ký hiệu, chữ, màu, danh sách kỹ năng còn thiếu, ghi chú).

- **Điểm phù hợp** theo comp-calc-v15 (xem `docs/competency-assessment.md`): mọi kỹ năng chưa có điểm tính 0, kể cả Sắp học (v14 còn để Sắp học ngoài). Hộp chi tiết có cột **Điểm** từng kỹ năng và một dòng giải thích cách tính (`FIT_RULE_TEXT`). Điểm in như trang Khoảng trống kỹ năng (`formatScore`: điểm nguyên làm tròn xuống), không còn một chữ số thập phân.
- **Trạng thái từng yêu cầu** dùng đúng `gapStatusDisplay` của Khoảng trống kỹ năng: ✓ Đạt ngưỡng (· miễn/công nhận), ✗ Dưới ngưỡng · thiếu N điểm (từ comp-calc-v17: ngưỡng − điểm hiển thị, một chữ số thập phân khi ngưỡng là 62,5), ! Chưa học, ○ Sắp học · HK2 · 2026–2027, ! Cần tự học (chuyên ngành khác, kèm tên học phần; hoặc học phần tự chọn bạn không chọn), ? Chưa đủ dữ liệu; cùng màu (`cg-state-pass/fail/unknown/neutral`). API gửi thêm `noDataReason`, `exemptOnly`, `coefficient`, `otherSpecialtyCourses` ("Tên (MÃ)").
- **Dòng đếm** = `careerSummaryText` + `careerDataText`, cả hai dựng lại từ danh sách yêu cầu như Khoảng trống kỹ năng (từ comp-calc-v17: chỉ các số khác 0, "Đạt x/y kỹ năng · a dưới ngưỡng · b chưa học · c sắp học · d cần tự học · e chưa đủ dữ liệu · u/y kỹ năng có điểm"). Câu "Điểm sẽ tăng khi bạn học các học phần sắp học." chỉ có khi nghề có kỹ năng Sắp học (`fitRuleText`), ở cả hai trang; **thứ tự** yêu cầu = `sortRequirements`; **bạn nên bổ sung** = mọi kỹ năng làm giảm điểm (dưới ngưỡng, chưa học, cần tự học, chưa đủ dữ liệu), như "Kỹ năng còn thiếu".
- **Nghề mục tiêu**: API so yêu cầu của nghề mục tiêu với kết quả đánh giá gần nhất (`sameAsStored`); khác nhau thì thẻ nghề mục tiêu nhắc "Trang Khoảng trống kỹ năng đang hiển thị lần đánh giá lúc …" và bấm Đánh giá lại (`gapCurrent`, `gapAssessedAt`). Nghề mục tiêu đã bị xóa khỏi danh mục hiện "… nghề này không còn trong danh mục" (`deletedTargetName`). Từ 25/10/2026 API gửi thêm nghề của lần đánh giá đã lưu (`gapCareerId`, `gapCareerName`): sau khi chọn nghề, trang đọc lại API và ghi rõ "Khoảng trống kỹ năng vẫn đang hiển thị nghề X…"; chọn lại đúng nghề đó thì không nhắc.
- **Gợi ý theo khảo sát** chỉ dùng khảo sát đã hoàn thành và đồng ý theo chính sách hiện hành (cùng quy tắc với Lộ trình AI); chưa đủ thì hiện liên kết "Làm khảo sát". Khi không nghề nào đạt mức Trung bình, cột gợi ý theo năng lực đổi tiêu đề thành "Mức phù hợp cao nhất hiện nay" kèm một dòng lý do.

## Kiểm thử

- `apps/api/src/career-guidance/career-guidance.test.ts`: khớp khảo sát trên tên nghề thật của danh mục, `guidanceCareers` cho kết quả như trang Khoảng trống kỹ năng với nghề mục tiêu, API khi chưa có bảng điểm.
- `apps/api/src/competency-assessment/career-fit.test.ts`: `careerFitsFor` cho đúng phần nghề nghiệp của `calculateAssessment`, đủ nhanh.
- `apps/web/src/career-guidance-data.test.ts`: gợi ý, lọc, trạng thái từng yêu cầu, bảng so sánh, giới hạn 3 nghề.
