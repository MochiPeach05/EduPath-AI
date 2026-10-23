# Lộ trình học tập (STU-PLAN-01–07)

Trang `#roadmap` của sinh viên (23/10/2026, theo yêu cầu người dùng). Từ 24/10/2026, **lịch học theo tuần là màn hình chính**, bố cục như trang "Lịch học" của cổng đào tạo: sinh viên chọn môn cho một học kỳ và xếp buổi học ngay trên lưới đó. Trong lúc làm, trang kiểm tra môn tiên quyết, giới hạn tín chỉ, trùng lịch, kế hoạch mở lớp và tiến độ xét tốt nghiệp. Phần AI gợi ý lộ trình (STU-AI-01, 02, 06) làm ở bước sau. Hiện nút "Xếp theo kế hoạch đào tạo" thay cho gợi ý AI.

## Trang

- **Thẻ học kỳ** (trên cùng): từ học kỳ đang diễn ra đến hết CTĐT, ít nhất 3 học kỳ. Mỗi thẻ ghi số tín chỉ trên mức tối đa và nhãn "Hiện tại" hoặc "Đã qua". Có nút "Thêm học kỳ" (tối đa 15). Kéo một môn thả lên thẻ thì môn chuyển sang học kỳ đó.
- **Lịch học** (giữa, màn hình chính): cột Tiết 1–15 ghi giờ bắt đầu, kèm các cột Thứ 2 → Chủ nhật. Cột Tiết bên phải chỉ hiện trên màn hình rộng từ 1500 px.
  - Mỗi buổi chiếm một ca 3 tiết: Ca 1 tiết 1–3 (07:00–09:25), Ca 2 tiết 4–6 (09:35–12:00), Ca 3 tiết 7–9 (13:00–15:25), Ca 4 tiết 10–12 (15:35–18:00), Ca 5 tiết 13–15 (18:05–20:20). Giờ lấy theo bảng giờ tiết học của trường; ca tối chỉ lấy 3 tiết để ô nào cũng bằng nhau.
  - Mỗi buổi hiện thành khung viền vàng nét đứt "-Môn / -Loại / -Tiết", giống trang của trường. Hai buổi cùng ô được đánh dấu "Trùng lịch".
  - Phía trên lưới có thanh tiến độ tín chỉ và kết luận xét tốt nghiệp.
- **Thả môn từ "Chọn môn" vào một ô**: môn được thêm vào học kỳ đang xem, và buổi đầu tiên của môn được đặt vào ô đó (`addToSlot`).
  - Thả lần nữa thì đặt buổi kế tiếp. Khi mọi buổi đã có chỗ, thả thêm sẽ tạo một buổi mới.
  - Môn chỉ có đồ án hoặc thực tập (không có buổi học trên lớp) chỉ được thêm vào học kỳ.
  - Trên điện thoại hoặc dùng bàn phím: bấm "Chọn rồi chạm ô" trên môn (hoặc chạm vào một buổi), rồi chạm vào ô.
- **Cột trái**:
  - **"Môn đã chọn"** của học kỳ đang xem:
    - Số tín chỉ và giới hạn.
    - Từng môn kèm các buổi: buổi đã xếp ghi "LT · Thứ 3, tiết 4–6"; buổi chưa xếp kéo vào lịch được.
    - Có thể thêm hoặc bớt buổi, và bỏ môn.
    - Cảnh báo "Cần qua trước / Cần học trước", và "Ngoài kế hoạch: ít lớp".
    - Ở học kỳ hiện tại, các môn "Đang học" theo bảng điểm có nút "Xếp lịch cho môn này".
  - **"Chọn môn"**: các môn còn phải học, chia nhóm như trước.
    - Có tiêu chuẩn xét tốt nghiệp: theo nhóm của tiêu chuẩn. Nhóm đã đủ tín chỉ, "Môn khác trong CTĐT" và môn của chuyên ngành khác được thu gọn.
    - Mỗi môn có nhãn "Có lớp theo kế hoạch" hoặc "Ngoài kế hoạch: ít lớp" cho học kỳ đang xem, và môn có lớp được xếp lên đầu.
    - Có ô lọc "Chỉ môn có lớp theo kế hoạch".
    - Mỗi môn còn có gợi ý tiên quyết nếu thêm vào học kỳ này, nút "Thêm vào HKx" và nút "Chọn rồi chạm ô".
- **Tổng quan lộ trình** (dưới lịch):
  - Mỗi học kỳ một thẻ gồm các môn, số buổi đã xếp, ô chọn hoặc kéo thả để đổi học kỳ, và số môn ngoài kế hoạch.
  - Bấm tên học kỳ để mở lịch của học kỳ đó.
  - Phần **Tiến độ**: tín chỉ đã đạt, đang học, đã xếp so với tổng chương trình, kèm "Còn thiếu n TC" nếu chưa đủ. Bên dưới là kết luận theo tiêu chuẩn xét tốt nghiệp (chưa tính điểm trung bình và chứng chỉ) và danh sách "Cần xem lại".
- **Tự lưu**: 0,7 giây sau lần sửa cuối, kèm trạng thái "Đã lưu lúc …". Có nút "Xuất Excel" và nút "Xóa lộ trình".

## Kế hoạch mở lớp (24/10/2026)

Người dùng cho biết: trường mở lớp chủ yếu theo **kế hoạch đào tạo** của từng khóa và từng học kỳ; môn ngoài kế hoạch vẫn có mở nhưng ít lớp. Vì vậy:

- Phần nạp dữ liệu (`context.ts`) đọc mọi kế hoạch đào tạo đang dùng (`training_plans`, `training_plan_items`). Với mỗi môn có hai thông tin:
  - `planTerm`: học kỳ của môn trong kế hoạch của chính khóa sinh viên.
  - `offeredTerms`: mọi học kỳ mà kế hoạch của bất kỳ khóa nào có mở môn. So theo mã, hoặc theo tên khi các khóa dùng mã khác nhau (mã cũ của K26).
  - `offeringUntil` là học kỳ cuối cùng mà các kế hoạch còn bao phủ.
- Hàm `offering` (web) xếp mỗi cặp môn × học kỳ vào một loại:
  - "plan": có trong kế hoạch.
  - "likely": học kỳ nằm sau phạm vi các kế hoạch nhưng cùng học kỳ trong năm với lúc các kế hoạch mở môn, vì kế hoạch lặp lại hằng năm.
  - "outside": kế hoạch có bao phủ học kỳ đó nhưng không mở môn.
  - "unknown": không có kế hoạch nào.

## Giới hạn tín chỉ (STU-AI-04)

Theo Thông tư 08/2021/TT-BGDĐT, mỗi trường tự đặt khối lượng mỗi học kỳ, nhưng tối thiểu không dưới 2/3 và tối đa không quá 3/2 khối lượng trung bình một học kỳ của kế hoạch chuẩn. Hệ thống chưa có con số riêng của trường, nên dùng đúng khung này, tính từ CTĐT của khóa: trung bình = tổng tín chỉ CTĐT / số học kỳ chuẩn. Ví dụ 126 / 10 = 12,6 TC, nên mỗi học kỳ từ ⌈8,4⌉ = 9 đến ⌊18,9⌋ = 18 TC (`creditLimits` trong `apps/api/src/study-plan/model.ts`). Đây chỉ là cảnh báo, không chặn. Khi có quy định của trường thì sửa ở đúng hàm này.

## Xếp theo kế hoạch đào tạo (STU-PLAN-04 tạm thời)

`suggestStudyPlan` (`apps/api/src/study-plan/suggest.ts`, hàm thuần), chạy qua `POST /suggest`. Kết quả không được lưu: trang hiện lộ trình gợi ý rồi mới lưu.

- **Xếp những môn nào:**
  - Có tiêu chuẩn xét tốt nghiệp: mọi môn của nhóm bắt buộc trong tiêu chuẩn, cộng các lựa chọn của từng nhóm tự chọn (theo thứ tự CTĐT) cho đến khi đủ tín chỉ. Tiêu chuẩn là căn cứ xét tốt nghiệp, nên một môn tiêu chuẩn yêu cầu vẫn được xếp dù CTĐT ghi là môn của chuyên ngành khác (K27: 71ITDS40503). Môn có trong tiêu chuẩn mà CTĐT không có cũng được thêm (K26: DTA0620).
  - Không có tiêu chuẩn: các môn bắt buộc của CTĐT, cộng các nhóm tự chọn CTĐT có ghi số tín chỉ.
  - Chưa chọn chuyên ngành: chỉ xếp môn chung.
- **Xếp vào học kỳ nào** (`targetTerm`, từ 24/10/2026 theo kế hoạch đào tạo):
  1. Học kỳ của môn trong kế hoạch của chính khóa sinh viên, nếu học kỳ đó chưa qua.
  2. Nếu không, học kỳ sớm nhất sắp tới mà kế hoạch của một khóa bất kỳ có mở môn. Đây là trường hợp môn học lại, môn trễ, hoặc khóa không có kế hoạch như K27.
  3. Nếu không, học kỳ sau phạm vi các kế hoạch có cùng học kỳ trong năm với lúc các kế hoạch mở môn.
  4. Khi không có kế hoạch nào, dùng học kỳ chuẩn trong CTĐT nếu học kỳ đó chưa qua; ngoài ra xếp vào học kỳ sau học kỳ hiện tại.
- **Ràng buộc:** môn luôn đứng sau học kỳ của môn tiên quyết hoặc học trước đã xếp trước đó, và không làm vượt giới hạn tín chỉ. Học kỳ đầy thì chuyển sang học kỳ ứng viên kế tiếp theo cùng thứ tự ưu tiên ở trên.
- **Xếp lại:** môn đang ở đúng học kỳ vẫn giữ nguyên chỗ trên lịch tuần (`mergeSuggestion`).

## Dự đoán xét tốt nghiệp (STU-AI-05)

`projectGraduation` (`projection.ts`) dùng lại lõi xét tốt nghiệp (`assessGraduationStandard`, `graduationInputs`):

- Bảng điểm được thêm một học kỳ giả định cho mỗi học kỳ của lộ trình, trong đó mọi môn đã xếp và mọi môn đang học đều "Đạt".
- Kết quả gồm trạng thái các nhóm hiện tại (`now`), nếu học hết lộ trình (`withPlan`), và các nhóm còn thiếu.
- Không có dự đoán (`null`) khi chưa có tiêu chuẩn cho khóa và chuyên ngành (K30, K31) hoặc chưa có bảng điểm.

## API: `/api/student/study-plan`

| Lệnh | Việc |
| --- | --- |
| `GET /` | `context` (CTĐT, trạng thái môn theo bảng điểm, học kỳ chuẩn, giới hạn, nhóm của tiêu chuẩn; không gửi bảng điểm hay dữ liệu gốc của tiêu chuẩn), `plan` đã lưu hoặc `null`, `projection` |
| `PUT /` | Lưu toàn bộ `{ version, data }`. `version` là bản trang đã tải (`null` cho lần đầu); khác bản hiện có thì trả 409 `plan_changed` |
| `DELETE /` | Xóa theo `version` |
| `POST /suggest` | Lộ trình theo kế hoạch đào tạo, kèm dự đoán; không lưu |
| `GET /export` | Tệp Excel (sheet "Lộ trình" và "Lịch tuần"); 404 khi chưa lưu |

Yêu cầu đăng nhập, tài khoản còn hoạt động, và `Origin` của web cho các lệnh ghi. Đọc dữ liệu trong một snapshot `REPEATABLE READ READ ONLY`; lưu thì khóa dòng người dùng.

## Dữ liệu

Migration `046_student_study_plans.sql` tạo bảng `stu_study_plans(user_id PK → users ON DELETE CASCADE, version, data JSONB, created_at, updated_at)`, bật RLS và thu quyền như các bảng sinh viên khác. `data` có dạng `{ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code, sessions: [{ kind: "LT"|"TH", day: 2–8|null, block: 1–5|null }] }] }] }` (`studyPlanSchema`): mỗi môn chỉ ở một học kỳ, mỗi học kỳ có một cột, `day` và `block` phải cùng có hoặc cùng trống. Nếu dữ liệu đã lưu không còn đúng dạng này, lộ trình đọc ra là rỗng thay vì làm lỗi trang. Xóa bảng điểm không xóa lộ trình.

## Mã nguồn và kiểm thử

- API: `apps/api/src/study-plan/` gồm `model.ts`, `context.ts`, `suggest.ts`, `projection.ts`, `export.ts`, `router.ts`. Test ở `study-plan.test.ts`, dùng dữ liệu giả K29.
- Web: `apps/web/src/StudentRoadmap.tsx`, `student-roadmap.css`. Các phép kiểm tra thuần nằm ở `study-plan-checks.ts`: số tín chỉ của học kỳ, tiên quyết, trùng lịch, kế hoạch mở lớp (`offering`), danh sách môn, thao tác sửa (`addToSlot`, `moveCourse`, `placeSession`). Test ở `study-plan-checks.test.ts`.
- Đã chạy thử đầu-cuối trên server thử nghiệm local (schema `e2e_k26k31`, sinh viên giả K26–K31): xếp theo kế hoạch, xếp buổi bằng chạm (có trùng lịch), lưu, xuất Excel, cả ở bề rộng 1440 và 390 px.
  - K26, K27, K28, K29 sau khi xếp đều chuyển từ chưa đủ sang đủ các nhóm học phần.
  - K30, K31 chưa có tiêu chuẩn nên chỉ hiện tín chỉ.
