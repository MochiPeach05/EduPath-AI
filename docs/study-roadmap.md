# Lộ trình học tập 3 tháng từ EduPath AI

Trang **Lộ trình học tập** của cổng sinh viên (`/dashboard#roadmap`) là kế hoạch 3 tháng do LLM cục bộ (`gemma4:e4b` qua Ollama, cùng worker AI với nhận xét năng lực và lời khuyên tốt nghiệp) soạn **như một cố vấn học tập**: các môn bạn cần học, các môn bạn cần cải thiện, và gợi ý kỹ năng, kiến thức nên tự học thêm để nâng cao trình độ và tăng khả năng làm việc ở nghề mục tiêu (phần cố vấn học tập thường không làm). Yêu cầu của người dùng ngày 24/10/2026 thay bảng xếp môn theo học kỳ và lịch tuần trước đó (87f61ff, xem "Lịch sử").

Nguyên tắc chung của dự án vẫn giữ: **hệ thống tính, AI diễn giải**. Danh sách môn, môn cần cải thiện và kỹ năng còn thiếu do code tính từ kết quả Đánh giá năng lực mới nhất; mô hình chỉ chọn ưu tiên và viết lời khuyên, bước học và kế hoạch theo tháng. Lộ trình chỉ để tham khảo: trang luôn nhắc trao đổi với cố vấn học tập và xem lịch đăng ký học phần của trường.

## Thành phần

| Lớp | Vai trò | Vị trí |
|---|---|---|
| Thời gian | Khoảng 3 tháng của lộ trình: hiện tính từ ngày tạo (giờ Việt Nam), 3 tháng lịch | `apps/api/src/roadmap/window.ts` |
| Dữ kiện | Đọc từ một kết quả đánh giá năng lực: môn cần học, nhóm tự chọn còn thiếu, môn cần cải thiện, kỹ năng nghề cần bổ sung | `apps/api/src/roadmap/facts.ts` |
| Prompt | System prompt cố vấn học tập, khối dữ liệu [1]–[7], JSON schema riêng từng job (`ROADMAP_PROMPT_VERSION = "roadmap-v1"`, thinking bật) | `apps/api/src/roadmap/prompt.ts`, `schema.ts` |
| Kiểm tra đầu ra | Chặt về cấu trúc, lọc từng mục, thay khóa kỹ năng bằng tên trước khi lưu | `apps/api/src/roadmap/validate.ts` |
| Hàng đợi | Tạo, cắt bớt dòng cũ; nhận/gia hạn/hoàn tất/hết hạn job cho worker | `apps/api/src/roadmap/jobs.ts` |
| Hiển thị | Ghép dữ kiện với phần AI viết cho trang | `apps/api/src/roadmap/present.ts` |
| API sinh viên | `/api/student/roadmap` | `apps/api/src/roadmap/router.ts`, gắn trong `apps/api/src/app.ts` |
| Worker | Giao thức chung `/api/worker/competency-assessments`, loại job `study_roadmap` | `apps/api/src/competency-assessment/ai/worker-router.ts`, `worker-protocol.ts`, `apps/api/src/ai-worker/ollama.ts` |
| Lưu trữ | Bảng `stu_roadmaps`: mỗi dòng vừa là job vừa là lộ trình đã lưu | `apps/api/migrations/047_student_roadmaps.sql` |
| Giao diện | Trang `#roadmap` | `apps/web/src/StudentRoadmap.tsx`, `student-roadmap-data.ts`, `student-roadmap.css` |

## Thời gian của lộ trình

`roadmapWindow(now)` lấy ngày hiện tại theo giờ Việt Nam làm ngày bắt đầu và cộng 3 tháng lịch; tháng *i* kéo dài đến ngày trước ngày bắt đầu tháng *i+1* (24/10/2026 → tháng 1: 24/10–23/11/2026, tháng 2: 24/11–23/12/2026, tháng 3: 24/12/2026–23/01/2027; ngày 31 rơi vào tháng ngắn hơn thì lấy ngày cuối tháng). Người dùng sẽ cung cấp mốc thời gian chính thức sau; khi có, chỉ cần sửa hàm này, mọi phần khác đọc kết quả của nó. Lộ trình lưu ngày bắt đầu và kết thúc (`window_start`, `window_end`); qua ngày kết thúc, trang ghi "đã hết thời gian" và mời **Tạo lại**.

## Dữ kiện (hệ thống tính)

`buildRoadmapFacts` chỉ đọc kết quả đánh giá năng lực đã lưu (`stu_comp_assessments.computed`), không đọc thêm bảng nào; các danh sách đều được đọc phòng thủ để kết quả của phiên bản tính cũ không làm hỏng trang.

- **Môn cần học** (`study`): học phần đang học (`running`); học phần trễ so với kế hoạch đào tạo (`late`, theo `progress.late`); học phần theo kế hoạch của học kỳ tiếp theo (`next`, `progress.next`). Khi sinh viên đang có môn đang học thì học kỳ tiếp theo chính là học kỳ đang học, nên thêm học phần **bắt buộc** mà kế hoạch đào tạo xếp ở học kỳ sau đó (`following`, học kỳ có `plannedTerm` nhỏ nhất lớn hơn học kỳ tiếp theo; chỉ học phần thuộc chương trình của sinh viên, chưa học, không phải môn điều kiện, không thuộc nhóm tự chọn): đây là đợt đăng ký rơi vào 3 tháng tới. Môn nằm trong danh sách cải thiện không lặp lại ở đây.
- **Nhóm tự chọn còn thiếu** (`choices`): nhóm lựa chọn và GDTC trễ hoặc của học kỳ tiếp theo, kèm phần còn thiếu và các học phần chưa đạt có thể chọn (tối đa 8 học phần mỗi nhóm được đưa cho mô hình).
- **Môn cần cải thiện** (`improve`): học phần thuộc chương trình, không phải môn điều kiện (GDTC/GDQP), **chưa đạt với F hoặc VT → học lại**, hoặc **đạt với D, D+ → học cải thiện** (người dùng, 24/10/2026). Thứ tự: học lại trước, rồi học phần giúp kỹ năng của nghề mục tiêu, rồi điểm thấp hơn.
- **Kỹ năng nghề cần bổ sung** (`skills`, tối đa 10, khóa `S01`, `S02`…): yêu cầu kỹ năng của nghề mục tiêu chưa đạt (dưới ngưỡng, chưa học, chưa có dữ liệu, sắp học), gộp với danh sách "Cần tự học" của kết quả đánh giá (lý do lấy từ `reasonLabel`); kỹ năng còn khoảng trống kèm tối đa 4 học phần trong chương trình giúp bổ sung (từ `courseSuggestions`). Sau đó là kỹ năng nghề đã đạt nhưng nên nâng cao (`skillPlans`). Sắp xếp: kỹ năng nâng cao xếp cuối; bắt buộc trước ưu tiên; dưới ngưỡng, chưa học, chưa có dữ liệu, sắp học; khoảng thiếu lớn trước. Không bịa liên kết khóa học hay tài liệu.
- Hồ sơ: khóa, tên chuyên ngành, tên nghề mục tiêu, học kỳ có điểm gần nhất, học kỳ tiếp theo, học kỳ sau đó, kết quả xét tốt nghiệp tham khảo.

**Sở thích không được dùng.** Chính sách bảo mật bản 2026-10-11 (không đổi) ghi rõ mô hình không nhận sở thích của sinh viên. Người dùng đang làm lại phần sở thích thành danh sách chọn sẵn và có thể sửa chính sách sau; khi đó dữ kiện mới thêm vào `facts.ts` và mục mới trong khối dữ liệu, kèm bản chính sách mới.

## Dữ liệu gửi cho mô hình

Khối dữ liệu (`renderRoadmapDataBlock`) gồm các mục `[1. HỒ SƠ]`, `[2. THỜI GIAN CỦA LỘ TRÌNH]` (ngày bắt đầu, kết thúc và từng tháng), `[3. HỌC PHẦN ĐANG HỌC]`, `[4. HỌC PHẦN CẦN HỌC THEO KẾ HOẠCH ĐÀO TẠO]` (trễ, theo kế hoạch học kỳ tiếp theo, học kỳ sau cần chuẩn bị đăng ký, nhóm lựa chọn còn thiếu), `[5. HỌC PHẦN CẦN CẢI THIỆN]` (điểm hệ 10, điểm chữ, học lại/học cải thiện), `[6. KỸ NĂNG NGHỀ CẦN BỔ SUNG]` (khóa, tên, bắt buộc/ưu tiên, trạng thái, điểm/ngưỡng của kỹ năng đã có điểm, cần tự học, học phần giúp bổ sung) và `[7. TIẾN ĐỘ XÉT TỐT NGHIỆP]`. Đúng các loại dữ liệu chính sách đã nêu (mã và tên học phần, điểm, khóa, chuyên ngành, nghề mục tiêu, kết quả hệ thống tính); không có họ tên, mã số sinh viên, email, lớp, sở thích hay tệp PDF. Mọi chuỗi đi qua `sanitizeText` (Ollama phân tích chuỗi token đặc biệt trong nội dung tin nhắn).

System prompt yêu cầu: chỉ nhắc học phần và kỹ năng có trong dữ liệu, dùng đúng mã và khóa đã cho; không bịa mã, lịch mở lớp, giảng viên, khóa học, chứng chỉ, trang web hay đường link; không tự đặt con số; không hứa hẹn; gọi học kỳ và ngày bằng chữ; văn bản thuần tiếng Việt, gọi sinh viên là "bạn"; bước tự học là nội dung kiến thức, bài tập hoặc dự án nhỏ, không nêu tên trang web hay khóa học.

Tùy chọn: `num_ctx` 16384 (như mọi loại job), `num_predict` 12288 (gồm cả phần suy nghĩ; câu trả lời dài nhất theo giới hạn khoảng 4k token, khối dữ liệu dưới 4k), `temperature` 0,4, `top_p` 0,95, `top_k` 64, `think: true` (người dùng chấp nhận AI chậm nếu đúng).

## Đầu ra và kiểm tra

Schema (`buildRoadmapSchema`, cùng tập con an toàn với grammar như các loại job khác): `summary` (≤ 500 ký tự); `study` ≤ 8 mục `{ code, advice }` với `code` thuộc enum các mã của job (môn cần học và các lựa chọn); `improve` ≤ 5 mục `{ code, advice }`; `skills` 1–4 mục `{ key, why, steps (1–3), outcome }` (0 mục khi không có kỹ năng); `months` đúng 3 mục `{ month: "1" | "2" | "3", focus, tasks (1–4) }`. Danh sách rỗng có enum `NONE` và `maxItems` 0.

`validateRoadmapOutput` chặt về cấu trúc (sai cấu trúc → `invalid_ai_output`), lọc từng mục như lời khuyên tốt nghiệp: một đoạn văn có liên kết, email, HTML, token đặc biệt, số mục của khối dữ liệu ("mục [4]"), con số hoặc mã học phần không có trong khối dữ liệu, hay khóa kỹ năng lạ thì bị bỏ; khóa kỹ năng hợp lệ viết trong văn bản được thay bằng tên kỹ năng. Mục lặp mã/khóa/tháng chỉ giữ mục đầu. Kỹ năng thiếu lý do hoặc không còn bước nào bị bỏ (kết quả mong đợi hỏng thì để trống); tháng không còn việc nào bị bỏ. Job chỉ thất bại khi `summary` không dùng được hoặc không còn gì. Kết quả sạch lưu ở `ai_output`, `ai_input` bị xóa.

## Hàng đợi và API

`createRoadmap` (trong giao dịch của `POST /`): khóa dòng `users` (`FOR KEY SHARE`), rồi khóa tư vấn `edupath:study-roadmap`, dọn job kẹt, đọc kết quả đánh giá mới nhất (không có → 409 `assessment_required`). Lộ trình đang chờ hoặc đang soạn **cho cùng kết quả đánh giá** được trả nguyên (200). Còn lại: tối đa một lần tạo mỗi 30 giây (429 `roadmap_too_frequent`), không tạo khi 20 job của sinh viên khác đang chờ (429 `queue_full`); hủy lộ trình đang chờ của kết quả cũ, chèn dòng `queued` (dữ kiện, `ai_input`), giữ 5 dòng mới nhất. Mỗi sinh viên chỉ có một dòng đang chờ (chỉ mục duy nhất từng phần). Job kẹt (chờ quá 24 giờ, hoặc lease hết hạn sau lần thử cuối) chuyển `failed` với `worker_timeout`.

| Lệnh `/api/student/roadmap` | Kết quả |
|---|---|
| `GET /` | `{ roadmap, assessment: { id, createdAt, hasCareer } \| null, stale, aiEnabled, worker: { online, supportsRoadmap } }` trong giao dịch `REPEATABLE READ READ ONLY`. `roadmap` là dòng mới nhất đã ghép dữ kiện với phần AI viết (`present.ts`); `stale` khi lộ trình được tạo từ kết quả đánh giá cũ hơn kết quả mới nhất. |
| `GET /status` | `{ id, status, errorCode, worker }` của dòng mới nhất; trang hỏi mỗi 3 giây khi đang chờ. |
| `POST /` `{}` | 201 lộ trình mới `queued`, hoặc 200 lộ trình đang soạn cho cùng kết quả. Lỗi: 409 `ai_disabled`, 409 `assessment_required`, 429 `roadmap_too_frequent`, 429 `queue_full`. |

Cần đăng nhập, `Cache-Control: no-store`, lệnh ghi phải có Origin đúng, tài khoản còn hoạt động. Không có header đồng ý: lộ trình chỉ dựng từ kết quả đánh giá sinh viên đã đồng ý, và **đi cùng kết quả đó** (khóa ngoại `ON DELETE CASCADE`): thay hay xóa bảng điểm, rút lại đồng ý, kết quả bị cắt bớt hay xóa tài khoản đều xóa lộ trình. Cán bộ không có API nào đọc lộ trình.

Worker: job `study_roadmap` được giao sau đề xuất kỹ năng nghề nghiệp và lời khuyên tốt nghiệp, trước nhận xét năng lực và đề xuất cho admin (sinh viên đang chờ trên trang), kèm `think: true`. Worker phát hành trước loại job này không quảng bá nó nên không bao giờ nhận; **cần khởi động lại worker AI** sau khi cập nhật để nhận lộ trình. Worker kiểm tra nhanh ở máy (`parseStudyRoadmapOutput`: `summary` không rỗng và bốn mảng đối tượng), server kiểm tra đầy đủ.

## Giao diện

- Chưa có kết quả đánh giá: hướng dẫn mở **Đánh giá năng lực** trước.
- Chưa có lộ trình: giới thiệu ba phần của lộ trình và nút đỏ **Tạo lộ trình** (máy AI đang tắt thì báo yêu cầu sẽ được giữ trong hàng đợi).
- Đang chờ/đang soạn: vòng xoay, thời gian đã chạy và lý do chờ (máy AI tắt, phiên bản cũ); các danh sách hệ thống tính hiện ngay bên dưới.
- Xong: tiêu đề "Từ … đến …", nghề mục tiêu và chuyên ngành, **Lời khuyên của cố vấn AI**, rồi **Môn bạn cần học** (mục AI chọn kèm lời khuyên, các học phần khác thu gọn, nhóm tự chọn còn thiếu), **Môn bạn cần cải thiện** (Học lại/Học cải thiện, điểm chữ), **Kỹ năng, kiến thức nên bổ sung** (vì sao cần, cách học, sau 3 tháng, học phần giúp bổ sung; kỹ năng khác liệt kê tên) và **Kế hoạch theo tháng** (3 thẻ có ngày). Nút **Tạo lại** ở góc trên.
- Lỗi: lý do bằng lời thường và nút **Thử lại**. Kết quả đánh giá đổi sau khi tạo, hoặc qua ngày kết thúc: ghi chú mời **Tạo lại**.

Ít con số, không thuật ngữ nội bộ (khóa S01…, mã học kỳ HK… chỉ xuất hiện dạng "HK1 2026–2027" trên nhãn).

## Lịch sử

- 23/10/2026 (87f61ff): bảng xếp môn theo học kỳ và lịch tuần (`study-plan/`, `/api/student/study-plan`, migration 046 `stu_study_plans`); 784315e lấy lịch tuần làm giao diện chính và xếp theo kế hoạch đào tạo, rồi được hoàn tác (c0063a5).
- 24/10/2026: người dùng bỏ hướng xếp lịch (lịch mở lớp ngẫu nhiên nên không xếp được như mong muốn; kế hoạch đăng ký học kỳ sau trường đã công bố trên cổng đào tạo) và chọn lộ trình 3 tháng do AI soạn. Mã `study-plan/` được gỡ (xem lại trong git ở 87f61ff); bảng `stu_study_plans` của migration 046 được giữ nguyên, không còn dùng.
