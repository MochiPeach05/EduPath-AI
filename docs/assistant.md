# Trợ lý AI (STU-CHAT-01..05)

Trang **Trợ lý AI** của cổng sinh viên là một chatbot tư vấn học tập. Nó trả lời bằng mô hình Gemma 4 E4B chạy cục bộ, theo kiểu **RAG** (retrieval-augmented generation). Trước khi trả lời, hệ thống tìm dữ liệu liên quan, đưa vào prompt và buộc mô hình chỉ trả lời từ dữ liệu đó, ghi số nguồn [n].

Người dùng yêu cầu ngày 28/10/2026: "triển khai giai đoạn 1, 2, 3 luôn".

| Mã | Chức năng | Dữ liệu trả lời |
| --- | --- | --- |
| STU-CHAT-01 | Giải thích khoảng trống kỹ năng | Kết quả đánh giá năng lực mới nhất: kỹ năng của nghề mục tiêu, mức các kỹ năng |
| STU-CHAT-02 | Tư vấn lộ trình học tập | Học phần đang học, cần học, cần cải thiện; tiến độ tốt nghiệp; Lộ trình AI mới nhất |
| STU-CHAT-03 | Hỏi đáp với trợ lý AI | Bảng điểm của sinh viên (tra cứu điểm, GPA, tín chỉ tích lũy; từ assistant-v4). Kho tri thức chung: CTĐT, KHĐT, kỹ năng, nghề, tiêu chuẩn tốt nghiệp, hướng dẫn |
| STU-CHAT-04 | Giải thích lý do đề xuất môn học | Lộ trình AI (lời khuyên từng học phần), liên kết môn–kỹ năng và trọng số, môn tiên quyết |
| STU-CHAT-05 | Gợi ý tài nguyên tự học | Danh sách tài nguyên đã kiểm tra link (`apps/api/src/assistant/learning-resources.json`) |

## Vì sao là RAG kết hợp
- **Gemma E4B không biết gì về Văn Lang.** Không có dữ liệu thì mô hình bịa mã môn, số tín chỉ và link. RAG đưa đúng dữ liệu vào prompt, nên câu trả lời có nguồn để kiểm tra.
- **Không fine-tune.**
  - Dữ liệu đổi theo khóa.
  - GPU 4 GB không đủ để huấn luyện.
  - Mô hình đã fine-tune không ghi được nguồn.
- **Hai tầng truy xuất:**
  - **Dữ liệu cá nhân dùng SQL**, chính xác hoàn toàn (`facts.ts`). Tầng này lấy kết quả mà engine đã tính, dùng chung các dòng với prompt của Lộ trình AI (`roadmapDataSections`), và từ assistant-v4 cả bảng điểm đã lưu (mục Bảng điểm). Nguyên tắc giữ như cũ: engine tính, AI chỉ giải thích; điểm trong bảng điểm được chép nguyên.
  - **Kho tri thức chung dùng tìm kiếm kết hợp** (`search.ts`):
    - BM25 theo từ (bỏ dấu, có cặp từ liền nhau như "co so du lieu");
    - vector EmbeddingGemma (768 chiều, cosine);
    - gộp hai kết quả bằng Reciprocal Rank Fusion.
- **API chọn dữ liệu, mô hình không tự gọi công cụ.** Ý định của câu hỏi được nhận ra bằng luật từ khóa (`intent.ts`), vì mô hình nhỏ hay gọi công cụ sai.

## Mô hình và tốc độ (đo trên máy chạy AI, 28/10/2026)
- Máy dùng GPU RTX 3050 Laptop 4 GB. Gemma 4 E4B nặng 6,6 GB và được nạp một phần lên GPU (`num_gpu` 38), chiếm khoảng 3,3 GB VRAM.
- Đọc prompt khoảng 1 400 token/giây (7 254 token mất 5,3 giây). Viết câu trả lời 46–79 token/giây. Nạp mô hình lần đầu mất khoảng 14 giây.
- **Bật thinking (assistant-v2, 29/10/2026).** Người dùng đề nghị bật, và phép thử 6 câu hỏi trên sinh viên giả K29 xác nhận nên bật:

  | | Thời gian (trung vị) | Lỗi đọc sai dữ liệu |
  | --- | --- | --- |
  | Tắt thinking | 11 giây | Có, ở 4/6 câu |
  | Bật thinking | 27 giây | Không thấy |

  Các lỗi khi tắt thinking:
  - liệt kê kỹ năng đã đạt là kỹ năng cần bổ sung;
  - nhầm hai học kỳ;
  - đọc "8/10 môn" thành còn thiếu 8 môn;
  - nhầm nhóm năng lực thành mức kỹ năng.

  Trong lúc mô hình suy nghĩ, trang hiện "Trợ lý đang soạn câu trả lời…". Phần suy nghĩ không được lưu.
- Gemma 4 không có endpoint embedding (Ollama báo "This server does not support embeddings"). Vì vậy dùng **EmbeddingGemma** (`embeddinggemma`, 308M), chạy bằng CPU (`num_gpu` 0) để không tranh VRAM với Gemma:
  - một câu hỏi mất khoảng 50 ms;
  - 32 đoạn văn mất khoảng 1 giây;
  - thử nhanh với 8 câu hỏi tiếng Việt diễn đạt khác tài liệu, cả 8 đều tìm đúng ở vị trí đầu.

## Luồng một câu hỏi
1. Sinh viên gửi câu hỏi (`POST /api/student/assistant/threads` hoặc `/threads/:id/messages`). API lưu câu hỏi và một tin nhắn trả lời ở trạng thái `queued`; tin nhắn này cũng chính là job của worker, loại `assistant_chat`. API đánh thức worker đang chờ.
2. Worker claim job và nhận văn bản cần embed, có tiền tố của EmbeddingGemma `task: search result | query: …`. Với câu hỏi không phải câu đầu của cuộc trò chuyện, job mang thêm một prompt **viết lại câu hỏi** (xem mục Trí nhớ hội thoại): Gemma viết lại trước, không bật thinking, và worker embed câu đã viết lại.
3. Worker gọi `POST /:id/prepare { leaseToken, vector, standalone }`. API dựng prompt:
   - dữ liệu cá nhân, chọn theo ý định của câu này và của 2 câu trả lời trước;
   - 6 đoạn tri thức tìm được bằng câu đã viết lại;
   - tối đa 3 đoạn mà 2 câu trả lời trước đã dẫn;
   - tài nguyên tự học của các kỹ năng còn thiếu;
   - 8 tin nhắn gần nhất, giữ nguyên dòng (bỏ số nguồn cũ).
4. Gemma suy nghĩ (thinking) rồi trả lời bằng văn bản thường. Worker gửi phần chữ đã viết lên `POST /:id/progress` khoảng 0,7 giây một lần; trang web hỏi `GET /messages/:id` mỗi giây nên chữ hiện dần.
5. Worker gọi `/complete { answer }`. API kiểm tra câu trả lời (`validate.ts`):
   - giữ số nguồn hợp lệ;
   - xóa mọi link không có trong danh sách tài nguyên của prompt;
   - ghi cảnh báo khi có mã học phần không có trong dữ liệu.

   Sau đó API lưu câu trả lời kèm các nguồn được dẫn. Phần chữ hiện dần ở bước 4 cũng được lọc link theo cách này.

Không có job, worker gửi `/claim { wait: true }` và API giữ yêu cầu tối đa 12 giây. Một câu hỏi mới đánh thức yêu cầu đang giữ, nên câu trả lời bắt đầu ngay.

Thứ tự claim:
1. câu trả lời của Trợ lý AI;
2. các loại cũ;
3. embedding của kho tri thức (sau cùng).

## Trí nhớ hội thoại (assistant-v3, 29/10/2026)
Người dùng thấy trợ lý "quên" cuộc trò chuyện sau 2–3 câu hỏi mơ hồ. Bản v2 có ba nguyên nhân:
- Lịch sử chỉ gồm 6 tin nhắn, mỗi tin bị dồn thành một dòng 600 ký tự, nên danh sách trong câu trả lời trước bị cắt mất.
- Tìm kiếm chỉ ghép câu hỏi với đúng một câu hỏi liền trước, mà câu đó thường cũng mơ hồ. Cách nhận ra câu hỏi nối tiếp chỉ là luật đơn giản (`isFollowUp`).
- Ý định được xác định lại cho từng câu, nên dữ liệu Lộ trình hay Kỹ năng rơi khỏi prompt dù cả cuộc trò chuyện đang nói về nó.

Bản v3 sửa bằng ba kỹ thuật chuẩn của RAG có hội thoại:
1. **Viết lại câu hỏi (query rewriting).** Câu hỏi không phải câu đầu được Gemma viết lại thành câu độc lập trước khi tìm kiếm, ví dụ "Còn môn thứ hai thì sao?" thành câu nêu đúng tên học phần (`buildRewritePrompt`).
   - Lần gọi này không bật thinking, viết tối đa 160 token và dùng cùng `num_ctx` với câu trả lời, nên Ollama không phải nạp lại mô hình.
   - Câu đã viết lại được dùng để tìm kiếm, để nhận ý định, và được đưa vào prompt ("Ý đầy đủ của câu hỏi theo hội thoại").
   - Nếu viết lại lỗi hoặc không dùng được (`standaloneQuestion`), API tìm bằng văn bản cũ.
2. **Giữ nguồn và chủ đề.** Mỗi nguồn được dẫn lưu kèm khóa của đoạn tri thức (`ref`, chỉ ở server). Câu hỏi sau đưa lại tối đa 3 đoạn mà 2 câu trả lời trước đã dẫn. Ý định của 2 câu trả lời trước cũng được cộng vào ý định của câu mới.
3. **Lịch sử dài hơn.** Prompt giữ 8 tin nhắn: mỗi câu hỏi tối đa 500 ký tự, mỗi câu trả lời tối đa 1.200 ký tự, giữ nguyên dòng nên danh sách vẫn là danh sách.

## Bảng điểm (assistant-v4, 29/10/2026)
Một sinh viên hỏi "Điểm tổng của tôi hiện tại là bao nhiêu". Bản v3 trả lời "Mình không có thông tin về điểm tổng (GPA)" rồi nói sang điểm năng lực, vì trợ lý không đọc bảng điểm. Người dùng yêu cầu: "giữ nguyên json bảng điểm luôn và lấy thêm thông tin từ nó nữa để sinh viên có thể tra cứu".

- **Dữ liệu có cấu trúc, không dùng embedding.** Bảng điểm của một sinh viên chỉ khoảng 40–70 dòng và mỗi con số phải đúng tuyệt đối, nên nó thuộc tầng SQL: `student_transcripts.parsed_data` (không bao giờ đọc cột PDF), đọc qua `withoutSettledReviews` như trang sinh viên và trang quản trị.
- **Nguồn "Bảng điểm của bạn"** (`transcript.ts`; kind `transcript`, link `#profile`) đứng ngay sau hồ sơ:
  - luôn có: các dòng tích lũy in ở cuối học kỳ gần nhất có điểm (Tổng số tín chỉ tích lũy, Điểm TB tích lũy hệ 4 và hệ 10, Xếp loại học tập tích lũy) kèm ghi chú đó là GPA hay "điểm tổng", học phần đang học, số học phần, học phần chưa đạt, đang học lại và đã học lại rồi đạt;
  - câu hỏi nêu học phần (mã, hoặc tên đầy đủ; tên dài nhất thắng, nên "Hệ quản trị cơ sở dữ liệu" không kéo theo "Cơ sở dữ liệu") hay học kỳ ("học kỳ 1 năm 2024-2025", "HK241", "học kỳ vừa rồi", "học kỳ này", "năm hai"): thêm các dòng đó cùng tổng kết của học kỳ; mã không có trong bảng điểm thì nói rõ;
  - câu hỏi về điểm không nêu học phần hay học kỳ: cả bảng điểm, mỗi dòng một học phần ("mã tên (TC): điểm hệ 10, hệ 4, điểm chữ, kết quả"), theo học kỳ, kèm mọi dòng tổng kết in trên bảng điểm. Tối đa 80 dòng; dài hơn thì bỏ các học kỳ cũ nhất và ghi rõ.
- **Cùng quy tắc với trang sinh viên:**
  - ô Kết quả in trên bảng điểm quyết định Đạt/Không đạt; ô trống thì theo điểm chữ;
  - MT là đạt; VT (vắng thi) và CT (cấm thi) là không đạt, không có điểm; F in "Đạt" (khóa trước đạt từ 4,0) là đạt;
  - một học phần đạt khi có một lần đạt, kể cả lần học lại dưới mã khác cùng tên (học trả nợ với khóa sau, như comp-calc-v17).
- **Số liệu chép nguyên.** Điểm và các dòng tổng kết giữ đúng như in; hệ thống không tính lại GPA. Prompt assistant-v4 thêm vào nguyên tắc 2: điểm, GPA, tín chỉ tích lũy và xếp loại lấy đúng như nguồn Bảng điểm, không cộng, tính trung bình, làm tròn hay quy đổi hệ 10 – hệ 4.
- **Ý định "transcript"** (`intent.ts`): bảng điểm, GPA, điểm tổng / trung bình / tích lũy / môn / học kỳ / chữ / hệ 4, tín chỉ tích lũy, rớt / nợ / qua môn, vắng thi, cấm thi; "mấy điểm", "điểm cao nhất", "điểm của…", "xếp loại" khi câu hỏi không nói về kỹ năng, năng lực hay mức phù hợp. "Điểm mạnh", "điểm yếu", "điểm phù hợp", "điểm năng lực", "điểm kỹ năng" không phải câu hỏi về điểm học phần.
- Đã có bảng điểm nhưng chưa có kết quả đánh giá năng lực: trợ lý vẫn có nguồn Bảng điểm, và hồ sơ nói rõ phần còn thiếu là Đánh giá năng lực.
- Prompt do API dựng nên không cần khởi động lại worker. Hướng dẫn "Trợ lý AI" trong kho tri thức nay nói trợ lý đọc bảng điểm; kho được embed lại ở lần làm mới tiếp theo.

**Kiểm tra (29/10/2026).** Sinh viên giả lập K29 có bảng điểm 40 dòng trong 10 học kỳ: F rồi học lại đạt, VT đang học lại, CT chưa học lại, MT ở điểm bảo lưu, môn điều kiện. Kết quả đánh giá được tính từ chính bảng điểm đó, kèm kho tri thức local. Gemma 4 E4B có thinking, `num_gpu` 38:

| Câu hỏi | Câu trả lời | Đúng? |
| --- | --- | --- |
| Điểm tổng của tôi hiện tại là bao nhiêu? | GPA cuối học kỳ 3 năm học 2025–2026: 2,85 (hệ 4), 7,28 (hệ 10) | Đúng |
| Môn Cơ sở dữ liệu mình được mấy điểm? | Học hai lần: F 3,5 (học kỳ 3 năm học 2023–2024, Không đạt), rồi B 7,5 (học kỳ 1 năm học 2024–2025, Đạt) | Đúng |
| Học kỳ 1 năm 2024-2025 mình học những môn nào? | Đủ 6 học phần với điểm và kết quả, kể cả môn CT | Đúng |
| Mình còn nợ môn nào không? | Phát triển ứng dụng di động (CT) cần học lại; Kỹ thuật lập trình (VT) đang học lại; thêm một môn điểm D, ghi đúng là học cải thiện | Đúng |
| Môn nào mình điểm cao nhất? | Nhập môn Công nghệ phần mềm, 9,5 | Đúng |
| Mình tích lũy được bao nhiêu tín chỉ rồi? | 79 tín chỉ, còn thiếu 47 TC | Đúng (câu đầu xưng nhầm "Mình đã tích lũy") |

- Mỗi câu mất 16–27 giây. Prompt từ 3,4 nghìn token (hỏi một học phần) đến 9,1 nghìn token (cả bảng điểm cùng các đoạn CTĐT), trong ngữ cảnh 16 nghìn token.
- Không có link bịa hay mã học phần lạ.
- Gemma viết "2,85" cho giá trị "2.85" in trên bảng điểm: cùng con số, chỉ đổi dấu thập phân theo cách viết tiếng Việt.

## Khi chưa có kết quả, và câu hỏi gợi ý (assistant-v5, 29/10/2026)
Người dùng (29/10) gửi ảnh: sinh viên chưa import bảng điểm, chưa đánh giá năng lực, hỏi "Vì sao lộ trình đề xuất các môn này cho mình?" và nhận câu trả lời chung chung. Yêu cầu: nói rõ "bạn chưa thực hiện đánh giá năng lực nên chúng tôi chưa có cơ sở để tư vấn", mời hoàn thành đủ các bước, và đặt câu hỏi đề xuất phía trên ô nhập.
- **Trả lời ngay, không qua AI** (`readiness.ts`). Khi nhận câu hỏi, API đọc 6 mục:
  - bảng điểm, chuyên ngành, nghề mục tiêu;
  - Khảo sát định hướng (đã trả lời và đồng ý, như khối đỏ ở Tổng quan);
  - kết quả Đánh giá năng lực, Lộ trình AI.
- **Câu hỏi nào được trả lời ngay.** Đó là câu hỏi về chính sinh viên ("mình", "tôi", "em", "tớ", "tui", hoặc "còn thiếu") mà dữ liệu chưa trả lời được. Câu trả lời cố định có trạng thái completed ngay trong phản hồi POST, `prompt_version` assistant-readiness-v1, và nguồn là các trang cần mở. Có ba trường hợp:
  - Hỏi điểm (ý định transcript), hoặc hỏi mình đủ điều kiện tốt nghiệp chưa, khi chưa có bảng điểm: "Bạn chưa import bảng điểm nên…".
  - Hỏi kỹ năng còn thiếu, lộ trình, nên học gì, vì sao đề xuất (gaps, roadmap, course_reason) khi chưa có Đánh giá năng lực: "Bạn chưa thực hiện Đánh giá năng lực nên mình chưa có cơ sở để tư vấn cho câu hỏi này…". Theo sau là các bước còn thiếu theo thứ tự: import bảng điểm, chọn chuyên ngành và nghề, Khảo sát định hướng, Đánh giá năng lực, và Tạo lộ trình nếu câu hỏi nói về Lộ trình AI.
  - Hỏi vì sao lộ trình đề xuất khi đã đánh giá nhưng chưa tạo Lộ trình AI: "Bạn chưa tạo Lộ trình AI…".
- **Không chặn nhầm.**
  - Câu hỏi cách làm ("làm sao để…", "hướng dẫn…"), câu hỏi về danh mục (kế hoạch đào tạo, chương trình đào tạo, môn tiên quyết) và câu hỏi chung không xưng hô vẫn do AI trả lời.
  - Khi đã có bảng điểm, câu hỏi về điểm, nợ môn, học lại do AI trả lời từ bảng điểm, kể cả khi chưa đánh giá năng lực.
  - Đại từ được dò trên chữ có dấu, nên "tới", "tối ưu", "thông minh" không bị hiểu là "tôi", "mình". Câu gõ không dấu có danh sách từ ghép để loại trừ.
- **Các câu còn lại do AI trả lời.** Nguồn hồ sơ nói rõ "chưa có cơ sở để tư vấn" và các bước cần làm. Prompt assistant-v5 thêm một cách trả lời: câu hỏi cần kết quả riêng mà dữ liệu ghi là chưa có thì câu đầu nói rõ điều đó và các bước, không thay bằng lời khuyên chung. Câu hỏi về thông tin chung vẫn trả lời bình thường.
- **Câu hỏi gợi ý** (`GET /threads` trả thêm `suggestions`, tối đa 6):
  - Đầu tiên là việc còn phải làm: import bảng điểm, chọn chuyên ngành và nghề, Khảo sát định hướng, chạy Đánh giá năng lực hoặc tạo Lộ trình AI.
  - Sau đó là câu hỏi về kết quả của chính sinh viên: GPA, nợ môn, kỹ năng còn thiếu, học kỳ tới, vì sao lộ trình đề xuất, điều kiện tốt nghiệp, tài liệu tự học, cách EduPath AI dùng dữ liệu.
  - Một phép thử chạy cả 64 tổ hợp 6 mục và bảo đảm không câu gợi ý nào dẫn tới câu trả lời "chưa có cơ sở".
- Prompt do API dựng nên không cần khởi động lại worker.

**Kiểm tra (29/10/2026).** Dùng sinh viên giả lập K29 chưa có bảng điểm, chuyên ngành, nghề và đánh giá, kèm kho tri thức local; Gemma 4 E4B có thinking:

| Câu hỏi | Đường đi | Câu trả lời |
| --- | --- | --- |
| Vì sao lộ trình đề xuất các môn này cho mình? | Trả lời ngay | "Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực nên mình chưa có cơ sở để tư vấn…", 5 bước, nguồn 4 trang |
| Học kỳ tới nên học môn gì? | AI, 17 giây | Câu đầu "Mình chưa có cơ sở để tư vấn riêng cho bạn về học phần nên học…", rồi 3 bước |
| Điểm mạnh nhất hiện tại là gì? | AI, 12 giây | "Mình chưa có cơ sở để tư vấn về điểm mạnh hiện tại của bạn vì bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực", rồi các bước |
| Môn Cấu trúc dữ liệu và giải thuật học những gì? | AI, 16 giây | Trả lời bình thường từ học phần và kỹ năng |
| Kế hoạch đào tạo K29 học kỳ 3 có những môn nào? | AI, 35 giây | Trả lời bình thường: ba học kỳ 3 của KHĐT K29 kèm học phần |

## Giọng trả lời tự nhiên (assistant-v6, 29/10/2026)
Người dùng (29/10): "Tôi thấy hiện tại nó trả lời không có human lắm". Bản đề xuất được duyệt ("Làm theo đề xuất của bạn đi"). Các dấu hiệu "máy" tìm thấy trên câu trả lời v5:
- số nguồn sau gần như mọi câu, có khi chồng ba số "[7], [5], [12]";
- gạch đầu dòng và in đậm cho cả 1–2 ý;
- câu khuôn mẫu như "Bạn vui lòng…", "Lưu ý: …", "Cụ thể,";
- tự gọi mình là "EduPath AI";
- mã học phần trên từng dòng;
- lời chào và lời từ chối kể ra cả danh sách chủ đề.

Thay đổi:
- **Prompt assistant-v6** (`prompt.ts`), mục "Giọng văn và cách trình bày":
  - giọng anh/chị khóa trên tư vấn cho đàn em, xưng "mình – bạn", không tự gọi là "EduPath AI";
  - câu đầu trả lời thẳng, không nhắc lại câu hỏi;
  - viết câu văn liền mạch; danh sách chỉ khi có từ 3 mục;
  - danh sách cụm từ khuôn mẫu bị cấm;
  - mã học phần chỉ khi cần để đăng ký;
  - động viên khi kết quả chưa tốt;
  - có thể kết thúc bằng một câu hỏi gợi mở;
  - lời chào hay cảm ơn chỉ đáp một câu.
- **Ví dụ trong prompt:** 3 cặp ví dụ "Không nên / Nên" với tên giả (môn X, môn Z), không có mã hay con số thật để tránh bị chép vào câu trả lời.
- **Số nguồn:**
  - Nguyên tắc 3 đổi thành: mỗi nguồn ghi một lần trong một đoạn, ở cuối câu hoặc cuối đoạn.
  - `validate.ts` (`compactCitations`) tự làm việc này cả khi Gemma vẫn ghi nhiều: bỏ "[]", gộp các số đứng liền nhau thành một nhóm đã sắp xếp, và trong mỗi đoạn chỉ giữ lần ghi cuối của mỗi nguồn. Danh sách nguồn ở ô Nguồn không đổi.
- **Câu trả lời cố định** (`readiness.ts`, assistant-readiness-v2):
  - cùng giọng, vẫn giữ ý "chưa có cơ sở để tư vấn";
  - không còn số [n] trong từng bước; các trang cần mở là nguồn, theo thứ tự các bước.
- `temperature` giữ 0.3 và thinking vẫn bật. Prompt do API dựng nên không cần khởi động lại worker.

**Kiểm tra (29/10/2026).** Cùng 11 câu hỏi, cùng dữ liệu và kho tri thức, chỉ khác prompt. Sinh viên là sinh viên giả lập K29 (có bảng điểm, kết quả đánh giá, khảo sát) và một sinh viên chưa có gì; Gemma 4 E4B có thinking.

| Chỉ số (trung bình 11 câu) | assistant-v5 | assistant-v6 |
| --- | --- | --- |
| Độ dài | 587 ký tự | 424 ký tự |
| Số nguồn [n] mỗi câu trả lời | 3,7 | 1,7 |
| Câu trả lời có gạch đầu dòng | 8/11 | 2/11 |
| Cụm từ khuôn mẫu | 5 | 2 |
| Kết thúc bằng câu hỏi gợi mở | 3/11 | 6/11 |
| Thời gian | 20 giây | 18 giây |

- **Hai vòng sửa sau lần chạy đầu:**
  - Gemma vẫn mở đầu bằng "Mình thấy bạn đang muốn…": prompt có thêm cặp ví dụ về câu mở đầu.
  - Khi viết thành đoạn văn, Gemma bỏ link tài liệu tự học: nguyên tắc 4 buộc mỗi tài nguyên một dòng kèm link.
- Bản v5 trả lời câu "Học kỳ tới mình nên học những môn nào?" bằng "Mình chưa có cơ sở để tư vấn…" dù sinh viên đã có kết quả. Bản v6 trả lời đúng bằng các môn cần học lại và cải thiện.
- **Độ đúng:** 17 câu của bộ đánh giá, điều kiện C (`--conditions=C`, lựa chọn mới của `eval/assistant/run.ts`) phủ mọi loại câu hỏi. Kết quả 15/15 câu trong phạm vi đúng, 2/2 câu ngoài phạm vi từ chối đúng.
- **Còn lại:** đôi khi vẫn có "Cụ thể,", và danh sách hai mục.


## Kết quả kiểm tra (29/10/2026)
Bộ đánh giá tự động `apps/api/eval/assistant/run.ts` ghi kết quả vào `docs/assistant-evaluation.md`. Bộ này gồm 48 câu hỏi trên sinh viên giả lập K29 và danh mục của CSDL local, và đã chạy trên assistant-v2.

| Đo | Kết quả |
| --- | --- |
| Tìm đúng dữ liệu, recall@6 | Từ khóa 94%, vector 85%, **kết hợp 98%** (với câu không dấu: vector 55%, kết hợp 100%) |
| Trả lời đúng (44 câu trong phạm vi) | A, Gemma không có RAG: **0/44**; B, RAG không thinking: 44/44; C, RAG có thinking (bản chạy thật): **44/44** |
| Link bịa / mã học phần lạ | 0 ở cả ba cấu hình |
| Dẫn nguồn [n] | B và C: 44/44 |
| Câu ngoài phạm vi | Từ chối đúng 4/4 ở cả ba cấu hình, kể cả câu đòi chép lại hướng dẫn hệ thống |
| Thời gian (trung vị) | A 1,6 giây; B 5,8 giây; C 18 giây |

- **Bộ đánh giá chấm theo từ khóa**, nên không thấy lỗi đọc sai dữ liệu khi câu trả lời vẫn chứa đúng con số. Vì vậy thinking được chọn theo phép thử đọc tay 6 câu (mục Mô hình và tốc độ): tắt thinking thì 4/6 câu đọc sai, bật thinking thì không thấy câu nào.
- **Hội thoại nhiều lượt (assistant-v3).** Phép thử là một cuộc trò chuyện 5 lượt, trong đó lượt 2–5 là câu hỏi mơ hồ, chạy theo cách cũ và cách mới, có thinking:

  | Lượt | v2 (cũ) | v3 (mới) |
  | --- | --- | --- |
  | "Môn đầu tiên trong đó học về gì?" | Hỏi lại sinh viên; tìm nhầm tài liệu GIS, IoT | Viết lại thành "Học phần 71ITIS30203 Hệ quản trị cơ sở dữ liệu học về cái gì?"; trả lời đúng các kỹ năng và môn học trước |
  | "Còn môn thứ hai thì sao?" | Đoán từ hồ sơ; dữ liệu tìm được không liên quan | Viết lại đúng tên học phần; trả lời đúng kỹ năng, nhóm tự chọn và môn học trước |
  | "Vậy mình nên ưu tiên cái nào trước?" | Lan man sang các môn học lại khác | So đúng hai môn đang bàn và giải thích vì sao ưu tiên Hệ quản trị CSDL |
  | "Có tài liệu nào để mình tự học trước cho nó không?" | Tài liệu kế toán, deep learning… | Tài liệu SQL Server của Microsoft Learn |

  Bước viết lại mất khoảng 1,3 giây khi GPU rảnh. Lúc đo song song với bộ đánh giá, nó mất 10–21 giây vì phải chờ GPU.
- **Đề xuất của báo cáo đánh giá đã áp dụng ở v3:**
  - tài nguyên của kỹ năng còn thiếu được tra theo đúng tên kỹ năng và đặt lên đầu;
  - tìm kiếm chung chỉ giữ tối đa 2 danh sách tài nguyên;
  - "danh sách" không còn bị hiểu là hỏi về sách.

## Kho tri thức chung
Bảng `ai_knowledge_chunks` (migration 055) chỉ chứa dữ liệu danh mục, không có dữ liệu sinh viên. Mỗi dòng là một đoạn văn tiếng Việt: học phần, kỹ năng, nghề, lĩnh vực, CTĐT, KHĐT theo học kỳ, tiêu chuẩn tốt nghiệp, hướng dẫn dùng cổng, hoặc tài nguyên tự học của một kỹ năng.
- `knowledge.ts` dựng lại kho từ các bảng danh mục, tối đa 10 phút một lần, chạy nền trong một lần claim.
- Đoạn nào đổi nội dung thì mất embedding và được xếp hàng embed lại (`knowledge_embedding`, 32 đoạn một job).
- Đoạn chưa có embedding vẫn tìm được theo từ.
- Kho có vài nghìn đoạn, nên tìm chính xác trong bộ nhớ là đủ nhanh và không cần pgvector. Postgres local không có pgvector; Supabase có bản 0.8.2 nếu sau này cần.

## Lưu trữ, quyền riêng tư
- **Bảng:**
  - `stu_chat_threads`, `stu_chat_messages`: hội thoại;
  - `ai_knowledge_chunks`, `ai_knowledge_jobs`: kho tri thức.

  Cả bốn bảng bật RLS và không cấp quyền cho anon/authenticated.
- **Mỗi sinh viên chỉ có một câu trả lời đang chờ.** Hai câu hỏi phải cách nhau ít nhất 3 giây, tối đa 60 câu mỗi giờ. Hàng đợi chung tối đa 30 câu trả lời của người khác.
- **Lưu và xóa:**
  - Sinh viên tự xóa cuộc trò chuyện.
  - Cuộc trò chuyện không có tin nhắn mới trong 90 ngày tự xóa.
  - `ai_input` (dữ liệu gửi cho mô hình) bị xóa khi job kết thúc.
- **Chính sách bảo mật ngày 28/10/2026** (người dùng đồng ý ngày 28/10) thêm mục Trợ lý AI và thời gian lưu. `CONSENT_VALID_SINCE` giữ nguyên 2026-10-25, nên không ai bị hỏi lại.
- **Chính sách bảo mật ngày 29/10/2026** (theo yêu cầu bảng điểm của người dùng) thêm việc trợ lý dùng điểm trong bảng điểm: mục Trợ lý AI, các câu hỏi thường gặp về dữ liệu AI và bảng điểm, mục đích sử dụng và dòng "Bản cập nhật ngày 29/10/2026". `TRANSCRIPT_POLICY_VERSION` và `policyVersion` là 2026-10-29; `CONSENT_VALID_SINCE` vẫn 2026-10-25, nên không ai bị hỏi lại.
- **Dữ liệu trợ lý được dùng:**
  - bảng điểm đã lưu (`parsed_data`, không bao giờ đọc PDF), vốn chỉ tồn tại khi sinh viên đã đồng ý lúc tải lên;
  - khảo sát định hướng, chỉ khi sự đồng ý `profile_survey` còn hiệu lực;
  - kết quả đánh giá và lộ trình, vốn chỉ tồn tại khi sinh viên đã đồng ý.
- **Mô hình không nhận** họ tên, MSSV, email, lớp hay PDF. Dòng tổng kết của bảng điểm chỉ được đưa vào khi nhãn là điểm, tín chỉ, xếp loại hay rèn luyện.

## Vận hành
- Trên máy chạy AI: tải model embedding bằng `ollama pull embeddinggemma`, rồi khởi động lại worker (`npm run ai-worker -w @edupath/api`). Worker cũ không quảng bá hai loại job mới nên không nhận chúng.
- Biến môi trường mới của worker là `OLLAMA_EMBED_NUM_GPU`, mặc định 0 (chạy embedding bằng CPU).
- Bước viết lại câu hỏi (v3) chạy trên worker, nên cần khởi động lại worker sau bản v3. Worker cũ bỏ qua prompt viết lại, và API vẫn tìm bằng văn bản của nó.
- API chỉ nhận câu hỏi khi có `AI_WORKER_KEY`. Trang báo "Trợ lý AI đang tạm ngưng" khi worker không quảng bá `assistant_chat`.

## Điểm TB học tập (assistant-v8, 31/10/2026)
Người dùng (31/10): "hãy xem cách tính của bảng điểm thật và học theo". Nguồn Bảng điểm của bạn chép thêm "Điểm TB học tập (Hệ 4)" và "Tổng số tín chỉ đăng ký" cạnh các dòng tích lũy, kèm một câu: Điểm TB học tập tính mọi tín chỉ đã đăng ký, kể cả môn chưa đạt; Điểm TB tích lũy (GPA) chỉ tính môn đã đạt. System prompt không đổi; worker không cần khởi động lại.

## Dấu thập phân và tên học kỳ (assistant-v7, 30/10/2026)
Người dùng (30/10): "Trợ lý AI trả lời “2.45”" và "Học kỳ đang được gọi theo 4 kiểu".
- Điểm in trên bảng điểm và các dòng tổng kết đưa cho AI dùng dấu phẩy (cùng chữ số); câu trả lời qua `decimalComma` trong `checkAnswer` và trên web (`assistant-format.ts`), nên câu trả lời đã lưu cũng hiện "2,45". Số phiên bản, ngày tháng, địa chỉ IP và đường link giữ nguyên.
- Học kỳ trong dữ liệu Bảng điểm, facts và các đoạn KHĐT của chỉ mục viết "HK1 2023–2024 (năm thứ 1, học kỳ 1)" như các trang; câu hỏi viết kiểu cũ (HK231, "học kỳ 1 năm học …") vẫn được hiểu. Các đoạn KHĐT được worker embed lại tự động.
- System prompt không đổi; worker không cần khởi động lại.

## Mã nguồn
- **API** (`apps/api/src/assistant/`):
  - `protocol.ts` (giao thức worker), `intent.ts`, `facts.ts`, `transcript.ts` (nguồn Bảng điểm), `prompt.ts` (assistant-v7), `validate.ts` (kiểm tra câu trả lời, gộp số nguồn);
  - `readiness.ts` (trả lời ngay khi chưa có kết quả, câu hỏi gợi ý);
  - `chat.ts` (hội thoại và job), `router.ts` (API cho sinh viên), `wakeup.ts`;
  - `knowledge.ts`, `knowledge-jobs.ts`, `guides.ts`, `search.ts`, `learning-resources.json`.
- **Worker:** `apps/api/src/ai-worker/`.
- **Web:** `apps/web/src/StudentAssistant.tsx`, `assistant-format.ts`, `assistant-types.ts`.
- **Kiểm tra link tài nguyên:** `node scripts/check-learning-resources.mjs`.
- **Đánh giá chất lượng:** `docs/assistant-evaluation.md`.
