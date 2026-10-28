# Trợ lý AI (STU-CHAT-01..05)

Trang **Trợ lý AI** của cổng sinh viên là một chatbot tư vấn học tập. Nó trả lời bằng mô hình Gemma 4 E4B chạy cục bộ, theo kiểu **RAG** (retrieval-augmented generation). Trước khi trả lời, hệ thống tìm dữ liệu liên quan, đưa vào prompt và buộc mô hình chỉ trả lời từ dữ liệu đó, ghi số nguồn [n].

Người dùng yêu cầu ngày 28/10/2026: "triển khai giai đoạn 1, 2, 3 luôn".

| Mã | Chức năng | Dữ liệu trả lời |
| --- | --- | --- |
| STU-CHAT-01 | Giải thích khoảng trống kỹ năng | Kết quả đánh giá năng lực mới nhất: kỹ năng của nghề mục tiêu, mức các kỹ năng |
| STU-CHAT-02 | Tư vấn lộ trình học tập | Học phần đang học, cần học, cần cải thiện; tiến độ tốt nghiệp; Lộ trình AI mới nhất |
| STU-CHAT-03 | Hỏi đáp với trợ lý AI | Kho tri thức chung: CTĐT, KHĐT, kỹ năng, nghề, tiêu chuẩn tốt nghiệp, hướng dẫn |
| STU-CHAT-04 | Giải thích lý do đề xuất môn học | Lộ trình AI (lời khuyên từng học phần), liên kết môn–kỹ năng và trọng số, môn tiên quyết |
| STU-CHAT-05 | Gợi ý tài nguyên tự học | Danh sách tài nguyên đã kiểm tra link (`apps/api/src/assistant/learning-resources.json`) |

## Vì sao là RAG kết hợp
- **Gemma E4B không biết gì về Văn Lang.** Không có dữ liệu thì mô hình bịa mã môn, số tín chỉ và link. RAG đưa đúng dữ liệu vào prompt, nên câu trả lời có nguồn để kiểm tra.
- **Không fine-tune.**
  - Dữ liệu đổi theo khóa.
  - GPU 4 GB không đủ để huấn luyện.
  - Mô hình đã fine-tune không ghi được nguồn.
- **Hai tầng truy xuất:**
  - **Dữ liệu cá nhân dùng SQL**, chính xác hoàn toàn (`facts.ts`). Tầng này lấy kết quả mà engine đã tính, dùng chung các dòng với prompt của Lộ trình AI (`roadmapDataSections`). Nguyên tắc giữ như cũ: engine tính, AI chỉ giải thích.
  - **Kho tri thức chung dùng tìm kiếm kết hợp** (`search.ts`):
    - BM25 theo từ (bỏ dấu, có cặp từ liền nhau như "co so du lieu");
    - vector EmbeddingGemma (768 chiều, cosine);
    - gộp hai kết quả bằng Reciprocal Rank Fusion.
- **API chọn dữ liệu, mô hình không tự gọi công cụ.** Ý định của câu hỏi được nhận ra bằng luật từ khóa (`intent.ts`), vì mô hình nhỏ hay gọi công cụ sai.

## Mô hình và tốc độ (đo trên máy chạy AI, 28/10/2026)
- Máy dùng GPU RTX 3050 Laptop 4 GB. Gemma 4 E4B nặng 6,6 GB và được nạp một phần lên GPU (`num_gpu` 38), chiếm khoảng 3,3 GB VRAM.
- Đọc prompt khoảng 1 400 token/giây (7 254 token mất 5,3 giây). Viết câu trả lời 46–79 token/giây. Nạp mô hình lần đầu mất khoảng 14 giây.
- Một câu trả lời có ngữ cảnh 6–8 nghìn token mất khoảng 10–20 giây, không bật thinking.
- Gemma 4 không có endpoint embedding (Ollama báo "This server does not support embeddings"). Vì vậy dùng **EmbeddingGemma** (`embeddinggemma`, 308M), chạy bằng CPU (`num_gpu` 0) để không tranh VRAM với Gemma:
  - một câu hỏi mất khoảng 50 ms;
  - 32 đoạn văn mất khoảng 1 giây;
  - thử nhanh với 8 câu hỏi tiếng Việt diễn đạt khác tài liệu, cả 8 đều tìm đúng ở vị trí đầu.

## Luồng một câu hỏi
1. Sinh viên gửi câu hỏi (`POST /api/student/assistant/threads` hoặc `/threads/:id/messages`). API lưu câu hỏi và một tin nhắn trả lời ở trạng thái `queued`; tin nhắn này cũng chính là job của worker, loại `assistant_chat`. API đánh thức worker đang chờ.
2. Worker claim job và nhận văn bản cần embed, có tiền tố của EmbeddingGemma `task: search result | query: …`. Câu hỏi nối tiếp ngắn được tìm kèm câu hỏi trước đó.
3. Worker gọi `POST /:id/prepare { leaseToken, vector }`. API dựng prompt:
   - dữ liệu cá nhân, chọn theo ý định;
   - 6 đoạn tri thức tìm được;
   - tài nguyên tự học của các kỹ năng còn thiếu;
   - lịch sử 6 lượt gần nhất (bỏ số nguồn cũ).
4. Gemma trả lời bằng văn bản thường. Worker gửi phần chữ đã viết lên `POST /:id/progress` khoảng 0,7 giây một lần; trang web hỏi `GET /messages/:id` mỗi giây nên chữ hiện dần.
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
- **Dữ liệu trợ lý được dùng:**
  - khảo sát định hướng, chỉ khi sự đồng ý `profile_survey` còn hiệu lực;
  - kết quả đánh giá và lộ trình, vốn chỉ tồn tại khi sinh viên đã đồng ý.
- **Mô hình không nhận** họ tên, MSSV, email, lớp hay PDF.

## Vận hành
- Trên máy chạy AI: tải model embedding bằng `ollama pull embeddinggemma`, rồi khởi động lại worker (`npm run ai-worker -w @edupath/api`). Worker cũ không quảng bá hai loại job mới nên không nhận chúng.
- Biến môi trường mới của worker là `OLLAMA_EMBED_NUM_GPU`, mặc định 0 (chạy embedding bằng CPU).
- API chỉ nhận câu hỏi khi có `AI_WORKER_KEY`. Trang báo "Trợ lý AI đang tạm ngưng" khi worker không quảng bá `assistant_chat`.

## Mã nguồn
- **API** (`apps/api/src/assistant/`):
  - `protocol.ts` (giao thức worker), `intent.ts`, `facts.ts`, `prompt.ts` (assistant-v1), `validate.ts`;
  - `chat.ts` (hội thoại và job), `router.ts` (API cho sinh viên), `wakeup.ts`;
  - `knowledge.ts`, `knowledge-jobs.ts`, `guides.ts`, `search.ts`, `learning-resources.json`.
- **Worker:** `apps/api/src/ai-worker/`.
- **Web:** `apps/web/src/StudentAssistant.tsx`, `assistant-format.ts`, `assistant-types.ts`.
- **Kiểm tra link tài nguyên:** `node scripts/check-learning-resources.mjs`.
- **Đánh giá chất lượng:** `docs/assistant-evaluation.md`.
