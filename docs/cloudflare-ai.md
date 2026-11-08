# AI và OCR trên Cloudflare Workers AI

Người dùng chốt ngày 8/11/2026: "Chốt phương án chuyển ocr thành gemma luôn và bắt đầu quá trình đẩy lên worker AI của Cloudflare". Mục tiêu là không còn mô hình nào chạy trên máy cá nhân.

## Chạy ở đâu

| Việc | Trước (`AI_PROVIDER` trống) | Sau (`AI_PROVIDER=cloudflare`) |
| --- | --- | --- |
| Nhận xét năng lực, Lộ trình AI, lời khuyên xét tốt nghiệp, đề xuất kỹ năng/liên kết, Trợ lý AI | Worker trên PC (`npm run ai-worker`): gọi Gemma 4 E4B qua Ollama | Ngay trong API trên Render (`ai-worker/cloud.ts`), gọi `@cf/google/gemma-4-26b-a4b-it` |
| Embedding của Trợ lý AI | EmbeddingGemma (768 chiều) trong Ollama | BGE-M3 (`@cf/baai/bge-m3`, 1024 chiều). EmbeddingGemma trên Workers AI ngừng ngày 20/11/2026 |
| PDF có lớp chữ | Đọc trên Render (`text-layer.ts`, PyMuPDF) | Như cũ |
| PDF scan hoặc ảnh chụp | Worker OCR trên PC (PaddleOCR) | Đọc trên Render: `worker.py --parse --gemma` (`services/ocr/gemma_ocr.py`) |

Worker AI trong API vẫn chạy đúng vòng lặp và giao thức của worker trên PC (`worker.ts`, gọi `/api/worker/...` qua `127.0.0.1`). Nhờ vậy cách nhận việc, gia hạn, thử lại và kiểm tra kết quả không đổi. Chỉ phần gọi mô hình khác (`ai-worker/cloudflare.ts`):

- `num_predict` → `max_completion_tokens`.
- `schema` → `response_format: json_schema`. Nếu Workers AI từ chối lược đồ (400), gửi lại một lần không kèm lược đồ.
- Luôn gửi `chat_template_kwargs.enable_thinking`, vì Workers AI bật suy nghĩ khi không nói gì. Phần suy nghĩ không bao giờ được giữ lại.
- Hết 10.000 neuron miễn phí trong ngày (mã 4006), token bị từ chối hoặc không có model: báo `ollama_unavailable`, không thử lại.
- Model bận (3040), 429 hoặc 5xx: thử lại tối đa 2 lần.

Khi `AI_PROVIDER=cloudflare`:

- Route `/api/worker/competency-assessments` chỉ nhận kết nối từ chính máy chủ. Worker AI trên PC nếu còn chạy sẽ nhận 403 `worker_moved`.
- Route `/api/worker/transcripts` trả 403 `worker_moved` cho worker OCR trên PC, khi trình đọc của máy chủ đã sẵn sàng.
- Mọi PDF đều kết thúc trên máy chủ. PDF mà Gemma không đọc được kết thúc bằng `ocr_failed`, sinh viên có thể thử lại.

## OCR bằng Gemma (`services/ocr/gemma_ocr.py`)

1. Trang không có lớp chữ dùng được được vẽ ở 200 DPI. Bản scan được xoay thẳng như với PaddleOCR (`rectify`). Nếu vẫn không thấy khung bảng (bảng ngắn ở trang cuối, đường kẻ dọc quá ngắn để xoay), `deskew` thử các góc trong ±1,5° và chọn góc làm các hàng mực sắc nét nhất.
2. `ppocr_table.table_bands` tìm khung bảng. Chỉ phần khung bảng được gửi đi; mọi thứ ngoài khung bảng bị cắt bỏ: tiêu đề, đầu trang, chân trang, phần thông tin quanh bảng. Không tìm thấy khung bảng thì trang không được gửi (`table_not_found`).
3. Phần bảng được cắt thành các dải khoảng 1/3 trang, cắt đúng trên đường kẻ ngang của bảng (`strip_cuts`). Không dòng nào bị cắt đôi hay đọc hai lần. Thử ngày 8/11: khi các dải còn chồng lên nhau, dòng cuối của học kỳ trước bị đọc lại sang học kỳ sau. Mỗi dải có thêm lề trắng trên và dưới, mã hóa JPEG chất lượng 90 (khoảng 300 kB). Mọi dải của mọi trang được gửi song song, tối đa 6 yêu cầu cùng lúc.
4. Gemma trả JSON `items`: `term`, `course`, `summary` (`lines` hoặc `text`: từng dòng "Nhãn: giá trị" của CẢ HAI ô tổng kết), `section`, `header`. Nhiệt độ 0, không suy nghĩ.
5. `RowBuilder` chuyển các mục thành đúng các dòng 8 ô mà lớp chữ và PaddleOCR tạo ra:
   - nhãn tổng kết được so gần đúng với nhãn chuẩn; nhãn chép hai lần chỉ tính một;
   - các mảnh của cùng một khối tổng kết gộp lại;
   - học kỳ bị sót tiêu đề (dòng môn ngay sau khối tổng kết, hoặc số thứ tự bắt đầu lại từ 1) thành học kỳ kế tiếp, và trang có `term_title_inferred`;
   - dòng trùng số thứ tự nhưng khác mã được giữ lại để server đánh dấu.
6. Từ đây dùng lại `test_ocr.parse_pages` và các bước kiểm tra sau nó. Dòng do Gemma bịa thêm làm số tín chỉ đạt và điểm TB học kỳ lệch với khối tổng kết in trên bảng điểm. Trang đọc bằng OCR luôn có `ocr_requires_visual_review`.

Trang có `method: "gemma"`. `ocr_settings` là `{ engine: "gemma", model, dpi, usage: { requests, prompt_tokens, completion_tokens } }`.

Đánh giá ngày 8/11 trên 8 bảng điểm scan giả theo đúng mẫu VLU (27 trang, 374 dòng môn):
- 373 dòng đọc được, 0 dòng bịa thêm, 1 dòng thiếu; 367 dòng đúng hoàn toàn.
- Số tín chỉ, điểm hệ 4, điểm chữ và kết quả đúng 100%; điểm hệ 10 đúng 99,7%; mã môn đúng 98,7% (các dòng sai đều bị đánh dấu cần kiểm tra).
- Khối tổng kết khớp 610/639 dòng.
- Khoảng 30 giây và 150–320 neuron mỗi bảng điểm.

## Cấu hình (`apps/api/.env`, Render → Environment)

- `CLOUDFLARE_ACCOUNT_ID`: 32 ký tự hex.
- `CLOUDFLARE_API_TOKEN`: token tạo từ mẫu "Workers AI" (Read + Edit).
- `AI_PROVIDER=cloudflare`: bật chuyển sang Cloudflare. Để trống thì giữ worker trên PC.
- `AI_CONCURRENCY`: số việc AI chạy cùng lúc, 1–4, mặc định 2.

Giá trị sai không làm sập trang. `aiProviderConfig` đọc lỏng; `server.ts` chỉ ghi log "the AI worker was not started" rồi chạy tiếp. Token không bao giờ được ghi log, và chỉ được truyền cho tiến trình Python khi chạy OCR bằng Gemma.

## Kiểm thử

- `apps/api`: `ai-worker/cloudflare.test.ts`, `ai-worker/cloud.test.ts`, `student/text-layer.test.ts`.
- `services/ocr`: `python -m unittest test_gemma_ocr`.
- Đánh giá trên bảng điểm giả theo đúng mẫu VLU: lấy bảng của PDF thật trên máy, thay mọi điểm và số tổng kết bằng số ngẫu nhiên, xóa chữ ngoài bảng. Chạy trong thư mục tạm, không commit. Không gửi bảng điểm thật nào lên Cloudflare để thử.
