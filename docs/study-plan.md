# Lộ trình học tập (STU-PLAN-01–07)

Trang `#roadmap` của sinh viên (23/10/2026, theo yêu cầu người dùng). Sinh viên xếp các môn còn phải học vào từng học kỳ, theo kiểu bảng học kỳ của Stellic, rồi xếp buổi học của từng môn vào lịch tuần, theo kiểu lịch học trên cổng đào tạo. Trong lúc kéo thả, trang kiểm tra môn tiên quyết, giới hạn tín chỉ, trùng lịch và tiến độ xét tốt nghiệp. Phần AI gợi ý lộ trình (STU-AI-01, 02, 06) làm ở bước sau. Hiện nút "Xếp theo kế hoạch đào tạo" thay cho gợi ý AI.

## Trang

- **Môn còn phải học** (cột trái) gồm các môn chưa đạt, chưa đang học và chưa xếp.
  - Có tiêu chuẩn xét tốt nghiệp: chia theo nhóm của tiêu chuẩn. Nhóm "Bắt buộc" ghi "Còn n môn". Mỗi nhóm tự chọn ghi "Cần thêm n TC" hoặc "Đã đủ n TC"; nhóm đã đủ được thu gọn. Cuối cùng là "Môn khác trong CTĐT", tức các môn tiêu chuẩn không yêu cầu (thu gọn).
  - Không có tiêu chuẩn: chia theo môn bắt buộc và nhóm tự chọn của CTĐT.
  - Môn của chuyên ngành khác nằm cuối (thu gọn).
  - Môn học lại có nhãn "Học lại". Môn có trong tiêu chuẩn nhưng không có trong CTĐT có nhãn "Theo tiêu chuẩn TN" (ví dụ K26 DTA0620).
- **Học kỳ** (giữa): từ học kỳ đang diễn ra đến hết CTĐT, ít nhất 3 học kỳ; nút "Thêm học kỳ", tối đa 15.
  - Học kỳ đang diễn ra hiện các môn "Đang học" lấy từ bảng điểm (đã đăng ký, chưa có điểm). Các thẻ này bị khóa.
  - Mỗi cột hiện số tín chỉ trên mức tối đa và cảnh báo khi vượt mức tối đa, hoặc dưới mức tối thiểu ở HK1/HK2 (trừ học kỳ cuối có môn). GDTC/GDQP không tính vào số này.
  - Học kỳ đã qua mà vẫn còn môn thì có nhắc chuyển môn sang học kỳ sau.
  - Thẻ môn ghi rõ "Cần qua trước: …" (tiên quyết) và "Cần học trước: …" (học trước), lấy từ `curriculum_relations` của CTĐT.
  - Đổi học kỳ bằng cách kéo thả, hoặc bằng ô chọn trên thẻ (dùng được trên điện thoại và bằng bàn phím).
- **Tiến độ** (cột phải):
  - Tín chỉ đã đạt, đang học, đã xếp so với tổng CTĐT, kèm "Còn thiếu n TC" nếu chưa đủ.
  - Kết luận theo tiêu chuẩn xét tốt nghiệp nếu học đạt hết lộ trình (xem phần Dự đoán). Kết luận này chưa tính điểm trung bình và chứng chỉ.
  - Danh sách "Cần xem lại".
- **Lịch tuần**: tab theo học kỳ có môn; lưới Thứ 2 → Chủ nhật × 5 ca, mỗi ca 3 tiết.
  - Các ca: Ca 1 tiết 1–3 (07:00–09:25), Ca 2 tiết 4–6 (09:35–12:00), Ca 3 tiết 7–9 (13:00–15:25), Ca 4 tiết 10–12 (15:35–18:00), Ca 5 tiết 13–15 (18:05–20:20). Giờ lấy theo bảng giờ tiết học của trường; ca tối chỉ lấy 3 tiết để ô nào cũng bằng nhau.
  - Mỗi môn bắt đầu với buổi LT nếu có tiết lý thuyết và buổi TH nếu có tiết thực hành (`hours` của CTĐT). Phần lớn môn 3 TC có 30 LT + 30 TH, nên có 2 buổi, giống lịch của trường. Môn chỉ có đồ án hoặc thực tập thì không có buổi học trên lớp.
  - Sinh viên kéo buổi vào ô, hoặc chạm vào buổi rồi chạm vào ô. Có thể thêm hoặc bớt buổi (tối đa 6). Hai buổi cùng ô được đánh dấu "Trùng lịch".
  - Đổi học kỳ của một môn thì các buổi của môn đó trở về "chưa xếp".
- **Tự lưu**: 0,7 giây sau lần sửa cuối, kèm trạng thái "Đã lưu lúc …". Có nút "Xuất Excel" và nút "Xóa lộ trình".

## Giới hạn tín chỉ (STU-AI-04)

Theo Thông tư 08/2021/TT-BGDĐT, mỗi trường tự đặt khối lượng mỗi học kỳ, nhưng tối thiểu không dưới 2/3 và tối đa không quá 3/2 khối lượng trung bình một học kỳ của kế hoạch chuẩn. Hệ thống chưa có con số riêng của trường, nên dùng đúng khung này, tính từ CTĐT của khóa: trung bình = tổng tín chỉ CTĐT / số học kỳ chuẩn. Ví dụ 126 / 10 = 12,6 TC, nên mỗi học kỳ từ ⌈8,4⌉ = 9 đến ⌊18,9⌋ = 18 TC (`creditLimits` trong `apps/api/src/study-plan/model.ts`). Đây chỉ là cảnh báo, không chặn. Khi có quy định của trường thì sửa ở đúng hàm này.

## Xếp theo kế hoạch đào tạo (STU-PLAN-04 tạm thời)

`suggestStudyPlan` (`apps/api/src/study-plan/suggest.ts`, hàm thuần), chạy qua `POST /suggest`. Kết quả không được lưu: trang hiện lộ trình gợi ý rồi mới lưu.

- **Xếp những môn nào:**
  - Có tiêu chuẩn xét tốt nghiệp: mọi môn của nhóm bắt buộc trong tiêu chuẩn, cộng các lựa chọn của từng nhóm tự chọn (theo thứ tự CTĐT) cho đến khi đủ tín chỉ. Tiêu chuẩn là căn cứ xét tốt nghiệp, nên một môn tiêu chuẩn yêu cầu vẫn được xếp dù CTĐT ghi là môn của chuyên ngành khác (K27: 71ITDS40503).
  - Không có tiêu chuẩn: các môn bắt buộc của CTĐT, cộng các nhóm tự chọn CTĐT có ghi số tín chỉ.
  - Chưa chọn chuyên ngành: chỉ xếp môn chung.
- **Xếp vào học kỳ nào:** học kỳ chuẩn trong CTĐT của môn, tính theo năm nhập học. Nếu học kỳ đó đã qua thì xếp vào học kỳ sau học kỳ hiện tại. Môn luôn đứng sau học kỳ của môn tiên quyết hoặc học trước đã xếp trước đó, và không làm vượt giới hạn tín chỉ (học kỳ đầy thì dời sang học kỳ sau).
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
- Web: `apps/web/src/StudentRoadmap.tsx`, `student-roadmap.css`. Các phép kiểm tra thuần nằm ở `study-plan-checks.ts`: số tín chỉ của học kỳ, tiên quyết, trùng lịch, danh sách môn, thao tác sửa. Test ở `study-plan-checks.test.ts`.
- Đã chạy thử đầu-cuối trên server thử nghiệm local (schema `e2e_k26k31`, sinh viên giả K26–K31): xếp theo kế hoạch, xếp buổi bằng chạm (có trùng lịch), lưu, xuất Excel, cả ở bề rộng 1440 và 390 px.
  - K26, K27, K28, K29 sau khi xếp đều chuyển từ chưa đủ sang đủ các nhóm học phần.
  - K30, K31 chưa có tiêu chuẩn nên chỉ hiện tín chỉ.
