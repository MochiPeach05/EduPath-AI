# AI và OCR trên Cloudflare Workers AI

Người dùng chốt ngày 8/11/2026: "Chốt phương án chuyển ocr thành gemma luôn và bắt đầu quá trình đẩy lên worker AI của Cloudflare". Mục tiêu là không còn mô hình nào chạy trên máy cá nhân.

## Chạy ở đâu

| Việc | Trước (`AI_PROVIDER` trống) | Sau (`AI_PROVIDER=cloudflare`) |
| --- | --- | --- |
| Nhận xét năng lực, Lộ trình AI, lời khuyên xét tốt nghiệp, đề xuất kỹ năng/liên kết, Trợ lý AI | Worker trên PC (`npm run ai-worker`): gọi Gemma 4 E4B qua Ollama | Ngay trong API trên Render (`ai-worker/cloud.ts`), gọi `@cf/google/gemma-4-26b-a4b-it` |
| Embedding của Trợ lý AI | EmbeddingGemma (768 chiều) trong Ollama | BGE-M3 (`@cf/baai/bge-m3`, 1024 chiều). EmbeddingGemma trên Workers AI ngừng ngày 20/11/2026 |
| PDF có lớp chữ | Đọc trên Render (`text-layer.ts`, PyMuPDF) | Như cũ |
| PDF scan hoặc ảnh chụp | Worker OCR trên PC (PaddleOCR) | Đọc trên Render: `worker.py --parse --gemma` (`services/ocr/gemma_ocr.py`) |
| PDF in qua máy in ảo (không có lớp chữ, chữ là nét vẽ vector) | Worker OCR trên PC (PaddleOCR) | Từ 13/11: đọc chính xác trên Render, không OCR, không AI (`services/ocr/outline_text.py`); xem mục "PDF in qua máy in ảo" |

Worker AI trong API vẫn chạy đúng vòng lặp và giao thức của worker trên PC (`worker.ts`, gọi `/api/worker/...` qua `127.0.0.1`). Nhờ vậy cách nhận việc, gia hạn, thử lại và kiểm tra kết quả không đổi. Chỉ phần gọi mô hình khác (`ai-worker/cloudflare.ts`):

- `num_predict` → `max_completion_tokens`.
- `schema`: thử chế độ `json_schema` trước, vì chỉ chế độ này giữ câu trả lời đúng lược đồ. Thử ngày 8/11, không suy nghĩ: 2/2 nhận xét năng lực qua bộ kiểm tra của API.
  - Nếu câu trả lời kéo theo một dải trống dài (từ 1.500 ký tự trắng ở cuối), hoặc Workers AI từ chối lược đồ (400), dừng ngay và hỏi lại ở chế độ `json_object`. Khi đó lược đồ được đặt ở cuối câu lệnh (`SCHEMA_NOTE`). Lý do: một lộ trình ở chế độ `json_schema` từng chèn khoảng trắng tới hết 12.288 token, 2/3 là khoảng trắng; `json_object` cho 6/6 JSON hợp lệ.
  - `jsonOnly` lấy JSON ra khỏi khối ```json hay chữ bao quanh, sửa vài lỗi cú pháp nhỏ (`repairJson`: xuống dòng chưa thoát, chuỗi rỗng thừa, dấu phẩy thừa) và bỏ khóa rỗng (`"": " "`).
  - Câu trả lời không suy nghĩ tối đa 8.192 token (`ANSWER_CAP`).
- Luôn gửi `chat_template_kwargs.enable_thinking`, vì Workers AI bật suy nghĩ khi không nói gì. Mặc định suy nghĩ TẮT, kể cả với việc có yêu cầu suy nghĩ. Thử ngày 8/11: Gemma 4 26B suy nghĩ hết 8.192 rồi 24.576 token (10 phút) cho một câu trả lời của Trợ lý AI mà vẫn chưa trả lời; tắt suy nghĩ thì trả lời đúng sau 9 giây. Muốn bật lại thì đặt `AI_THINKING=on`; khi đó mỗi việc được cộng thêm 16.384 token cho phần suy nghĩ. Phần suy nghĩ không bao giờ được giữ lại.
- Hết 10.000 neuron miễn phí trong ngày (mã 4006), token bị từ chối hoặc không có model: báo `ollama_unavailable`, không thử lại.
- Model bận (3040), 429 hoặc 5xx: thử lại tối đa 2 lần.

Khi `AI_PROVIDER=cloudflare`:

- Route `/api/worker/competency-assessments` chỉ nhận kết nối từ chính máy chủ. Worker AI trên PC nếu còn chạy sẽ nhận 403 `worker_moved`.
- Route `/api/worker/transcripts` trả 403 `worker_moved` cho worker OCR trên PC, khi trình đọc của máy chủ đã sẵn sàng.
- Mọi PDF đều kết thúc trên máy chủ.
  - Khi Workers AI tạm thời không nhận việc (hết lượt miễn phí trong ngày, quá tải, mất kết nối, token bị từ chối), PDF kết thúc bằng `ocr_busy` (`worker.gemma_error`). Trang báo máy đọc bản scan đang tạm ngưng, bảng điểm cũ vẫn giữ, gợi ý thử lại sau hoặc dùng PDF xuất từ cổng đào tạo.
  - Các lỗi khác (không tìm thấy khung bảng, câu trả lời không phải JSON) kết thúc bằng `ocr_failed`.

## PDF in qua máy in ảo: đọc từ nét chữ vector (`services/ocr/outline_text.py`, 13/11/2026)

Người dùng hỏi ngày 13/11: "ocr của gemma 4 26B vẫn đang làm sai ở bước nhập bảng điểm, bạn có cách nào tốt hơn không". Kiểm tra 18 bảng điểm đã lưu mà trước giờ phải đi qua OCR (15 do Gemma đọc, 3 do PaddleOCR): **không file nào là ảnh scan**. Cả 18 là PDF sinh viên in từ trình duyệt bằng máy in ảo (17 file "Microsoft: Print To PDF", 1 file Foxit) thay vì "Lưu dưới dạng PDF". Máy in ảo không ghi lớp chữ: mỗi ký tự là một nét vẽ vector, đúng hình con chữ Arial của trang cổng đào tạo, trên lưới 600 DPI của máy in.

Cách đọc mới không nhận dạng ảnh mà **so hình học**:

1. Lấy mọi nét vẽ tô kín của trang (`page_paths`). Hình chữ nhật dài và mảnh là đường kẻ bảng; còn lại là ứng viên ký tự.
2. Tìm lưới của máy in (`device_unit`) và các cỡ chữ của trang (`font_sizes`).
3. Một nét vẽ là một ký tự khi mọi đỉnh của nó nằm trên các điểm của đúng một con chữ Arial ở một cỡ chữ của trang, sai lệch không quá khoảng một đơn vị máy in, theo cả hai chiều (`candidates`, `_fit`). Dữ liệu đối chiếu là `arial_glyphs.json`: với mỗi ký tự và kiểu chữ, bề rộng, khung bao và các điểm nằm trên đường viền của con chữ (không đủ để vẽ lại phông).
4. Ghép ký tự thành dòng, từ theo đường chân chữ, vị trí và bề rộng con chữ (`phrases`). Dấu thanh rời (cổng đào tạo viết "học kỳ" bằng o + dấu nặng, y + dấu huyền) được gắn về đúng chữ của nó (`attach_marks`).
5. Viết lại các từ thành lớp chữ ẩn trên một trang mới chỉ có đường kẻ bảng (`text_pages`, phông `outline_blank.ttf`: mỗi ký tự là một ô chữ nhật, không có hình chữ), rồi đọc bằng đúng bộ đọc lớp chữ sẵn có (`test_ocr.native_rows`). Dấu ✓/✗ là ảnh: đọc từ chính ô Kết quả của trang gốc, theo màu, và theo hình dạng khi bản in không màu (`cell_mark`).

Không đoán: một nét vẽ trong bảng không khớp con chữ nào, hoặc khớp hai ký tự khác nhau, thì cả trang đó quay về OCR bằng Gemma như cũ (`in_doubt`). Ngoại lệ duy nhất là chữ I hoa và l thường, Arial vẽ cả hai thành một thanh chữ nhật: phân biệt theo các chữ trong từ (mã môn toàn chữ hoa và số là I; sau chữ thường là l; đầu từ trước nguyên âm là l…) và, khi các chữ chưa đủ chắc, theo vị trí của thanh giữa hai chữ bên cạnh (`_settle_bars`).

Trang đọc theo cách này ghi `method: "pdf_outline"`, không có cảnh báo "cần đối chiếu" vì không còn nhận dạng. Chạy ngay trong lượt `--text-only` trên Render (PyMuPDF, numpy, OpenCV có sẵn), không gọi Workers AI, không tốn neuron, không gửi gì ra ngoài máy chủ.

Đo ngày 13/11 (đọc lại trong bộ nhớ, chỉ in số đếm, không ghi gì vào database):

- 18/18 bảng điểm đã lưu đọc trọn bằng cách mới, 2–3,4 giây mỗi file trên máy thử.
- 978 dòng môn: 976 dòng trùng hoàn toàn với kết quả OCR đã lưu (mã, tín chỉ, hệ 10, hệ 4, điểm chữ, kết quả); 2 dòng còn lại khác mã môn, và ở cả hai mã do cách mới đọc có trong danh mục, mã OCR đã lưu thì không (Gemma làm rớt một chữ số; PaddleOCR đọc sai một ký tự).
- 1.607/1.607 giá trị ở các ô tổng kết trùng nhau.
- 6 PDF có lớp chữ được giả lập thành bản in máy in ảo (`outline_build.py simulate`) rồi đọc lại: 297 dòng môn và 798 giá trị tổng kết trùng với lớp chữ gốc.

Tệp đi kèm: `arial_glyphs.json`, `outline_blank.ttf`, `outline_build.py` (dựng hai tệp trên và bản giả lập; cần fontTools và Arial của Windows, máy chủ không chạy), `fixtures/outline_transcript.{html,pdf}` (bảng điểm bịa để kiểm thử).

## Thử với mọi bảng điểm trong máy người dùng (14/11): hai chỗ sửa trong bộ đọc

Người dùng yêu cầu ngày 13/11: "test với toàn bộ bảng điểm tôi có trong máy". Tìm được 17 bảng điểm thật khác nhau (13 file trong thư mục bộ thử, 4 file ở nơi khác, 3 bản sao). Chỉ in số đếm, không sao chép file.

- 16/17 đọc trọn trong lượt `--text-only`, không OCR, không AI: 13 file có lớp chữ (48 trang), 3 file in bằng Microsoft Print to PDF (10 trang, 1,9–2,4 giây mỗi file). 797 dòng môn, 150 học kỳ; số thứ tự của mọi khối đều liền 1..n.
- 3 file in máy in ảo được kiểm lại theo cách không dùng bộ giải mã: dựng lại 12.829 ký tự đã đọc bằng chính tệp phông Arial của Windows ở đúng vị trí và cỡ chữ, vẽ cả hai ở 600 DPI rồi chồng lên nhau, cho phép lệch 2 đơn vị máy in: 0 điểm lệch. Phép chồng này bắt được 720/720 ký tự cố ý đổi sai (8 thành 3, ơ thành ô, dấu chấm thành dấu phẩy, i thành í). Một trong ba file có bản "Lưu dưới dạng PDF" của cùng bảng điểm: 51/51 dòng và 130/130 giá trị tổng kết trùng. Mã, tên, tín chỉ của 143/144 dòng trùng với chữ của cổng đào tạo trong bảng điểm có lớp chữ của sinh viên khác (dòng còn lại không có bản đối chiếu).
- 10 file có lớp chữ Arial được giả lập thành bản in máy in ảo rồi đọc lại: 524/525 dòng và 1.400/1.400 giá trị tổng kết trùng lớp chữ; dòng còn lại là tên môn mà chính lớp chữ đặt dấu nặng sai chữ ("lưc̣"), bản đọc từ nét chữ ra "lực".
- File còn lại cần OCR là đúng: nửa trên trang 1 của nó là **một tấm ảnh** (tiêu đề cột, Điểm bảo lưu, học kỳ đầu), phần sau mới là chữ. Gemma đọc trên tài khoản thử: 36 dòng, khoảng 280 neuron, 35 giây; 30/30 dòng có trong lớp chữ trùng hoàn toàn, 78/78 giá trị tổng kết trùng, học kỳ nằm trong ảnh khớp số tín chỉ đạt và điểm trung bình in trên giấy.

Hai chỗ sửa trong `test_ocr.py`:

1. **Trang có ảnh lớn trong một bảng điểm luôn đi OCR** (`holds_picture`: ảnh rộng từ nửa trang và cao từ một phần năm trang). File nói trên trước đây chỉ đi OCR vì lưới bảng của nó tình cờ có 10 cột; nếu lưới đủ 8 cột, lớp chữ sẽ được đọc và 6 dòng nằm trong ảnh mất mà không có cảnh báo nào. Quy tắc chỉ áp dụng khi tài liệu có dòng môn (ở lớp chữ hoặc nét chữ); tài liệu không có dòng môn nào (slide, báo cáo có hình) vẫn bị từ chối ngay, không tốn OCR. Băng-rôn của cổng trên bản in cả trang chỉ cao khoảng 1/12 trang nên không bị tính.
2. **Bản in cả trang web không còn báo "Có N dòng không đọc được" sai** (`parse_pages`). Trên trang đọc bằng lớp chữ hoặc nét chữ, ba loại dòng sau không phải dòng bị mất: dòng trống; ô chạy hết chiều ngang bảng nằm trước dòng đầu tiên hoặc sau dòng cuối cùng của bảng điểm (bộ lọc, nút chọn, ô "Chú ý", chân trang của cổng); dòng có địa chỉ web (dòng chân trang của trình duyệt lọt vào khung bảng ở chỗ ngắt trang). Một ô chạy hết chiều ngang nằm **giữa** hai dòng của bảng điểm vẫn được báo, vì có thể là một tiêu đề bộ đọc chưa biết. Trang đọc bằng OCR giữ nguyên cách báo cũ.

Kiểm tra trên 52 bảng điểm đã lưu (chỉ đọc, trong bộ nhớ, chỉ in số đếm): dòng môn, học kỳ và ô tổng kết của cả 52 file giống hệt trước và sau khi sửa; 4 bản in cả trang hết cảnh báo sai (10, 15, 6, 7 dòng thành 0), 3 trong số đó không còn bị đánh dấu cần đối chiếu. Cả 52 file giờ đọc trọn trong lượt `--text-only` (34 lớp chữ, 18 nét chữ). Dữ liệu đã lưu không đổi.

## OCR bằng Gemma (`services/ocr/gemma_ocr.py`)

Từ 13/11 chỉ còn dành cho bản scan và ảnh chụp thật, và cho trang in máy in ảo mà `outline_text.py` không đọc trọn được.


1. Trang không có lớp chữ dùng được được vẽ ở 200 DPI. Bản scan được xoay thẳng như với PaddleOCR (`rectify`). Nếu vẫn không thấy khung bảng (bảng ngắn ở trang cuối, đường kẻ dọc quá ngắn để xoay), `deskew` thử các góc trong ±1,5° và chọn góc làm các hàng mực sắc nét nhất.
2. `ppocr_table.table_bands` tìm khung bảng. Chỉ phần khung bảng được gửi đi; mọi thứ ngoài khung bảng bị cắt bỏ: tiêu đề, đầu trang, chân trang, phần thông tin quanh bảng. Không tìm thấy khung bảng thì trang không được gửi (`table_not_found`).
3. Phần bảng được cắt thành các dải, cắt đúng trên đường kẻ ngang của bảng (`strip_cuts`). Mỗi dải nhỏ đủ để Gemma đọc ở độ phân giải gốc: tối đa `IMAGE_PIXELS` = 600.000 điểm ảnh, khoảng 4–5 dòng ở 200 DPI. Đo ngày 8/11: Gemma 4 trên Workers AI nhìn mọi ảnh qua khoảng 270 token, dù `detail` là low, auto hay high, nên ảnh lớn hơn sẽ bị thu nhỏ trước khi đọc. Không dòng nào bị cắt đôi hay đọc hai lần. Thử ngày 8/11: khi các dải còn chồng lên nhau, dòng cuối của học kỳ trước bị đọc lại sang học kỳ sau. Mỗi dải có thêm lề trắng trên và dưới, mã hóa JPEG chất lượng 90 (khoảng 300 kB). Mọi dải của mọi trang được gửi song song, tối đa 6 yêu cầu cùng lúc.
4. Gemma trả JSON `items`: `term`, `course`, `summary` (`lines` hoặc `text`: từng dòng "Nhãn: giá trị" của CẢ HAI ô tổng kết), `section`, `header`. Nhiệt độ 0, không suy nghĩ.
4b. Kiểm tra đủ dòng: dòng kẻ thấp có 8 ô là dòng môn. Nếu Gemma trả về ít dòng môn hơn số dòng đó (dải đầu trang được trừ 1 cho dòng tên cột), dải được đọc lại, tối đa 2 lần, và giữ câu trả lời nhiều dòng môn nhất (`read_checked`). Thử ngày 8/11: Gemma từng chép cả 5 dòng môn của một dải vào mục `header`.
5. `RowBuilder` chuyển các mục thành đúng các dòng 8 ô mà lớp chữ và PaddleOCR tạo ra:
   - mã môn sai định dạng VLU được sửa khi đổi đúng một ký tự dễ nhầm (0/O, 1/I, 5/S, 8/B, 2/Z, 6/G) cho ra đúng một mã hợp lệ (`fixed_code`, ví dụ 71P0LE10022 thành 71POLE10022);
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

Đánh giá lại sau khi dùng dải đọc ở độ phân giải gốc và kiểm tra đủ dòng (8/11), trên 2 bảng điểm giả (106 dòng môn):
- 106 dòng đọc được, 0 bịa thêm, 0 sót; 105 dòng đúng hoàn toàn. Dòng còn lại nhầm O với 0 trong mã môn, nay đã được `fixed_code` sửa.
- Khối tổng kết khớp 207/207 dòng.
- Khoảng 50 giây và 400 neuron mỗi bảng điểm.

## Thử với bảng điểm thật của bộ thử (8/11, tài khoản phụ, chỉ in số đếm)

13 PDF trong thư mục thử của người dùng:
- 10 PDF có lớp chữ: PyMuPDF đọc trên máy chủ, mỗi file khoảng 1 giây, server đều nhận.
- 3 bản scan: Gemma đọc mỗi file trong 23–37 giây. So với PaddleOCR trên PC: 130/130 dòng giống hệt ở cả 6 trường.
- Ép Gemma đọc 4 PDF có lớp chữ như bản scan, lấy lớp chữ làm đáp án:
  - file 2: 53/53 dòng đúng hoàn toàn;
  - file 4: 51/51;
  - file 5: 52/52;
  - file 1 (7 trang, 15 học kỳ): 77/77 ở hai lần chạy; một lần khác thiếu 5 dòng, vì Gemma không cho kết quả giống nhau mọi lần.
- Khối tổng kết khớp 93–98% số dòng.

Các bản sửa từ lần thử này:
- Trang không có khung bảng (trang chữ ký, trang trống) bị bỏ qua kèm cảnh báo `table_not_found` thay vì làm hỏng cả bảng điểm.
- Lỗi 500 được thử lại sau 3, 10 rồi 30 giây.
- Ngoài kiểm tra số dòng môn, mỗi dải còn được kiểm tra số tiêu đề học kỳ (dòng một ô) và số dòng của khối tổng kết (dòng cao; ít nhất 7 dòng mỗi khối). Thiếu thì đọc lại, vì tiêu đề bị sót sẽ bị đoán là học kỳ kế tiếp, mà sinh viên thường bỏ học kỳ hè.

## Khối tổng kết: đọc hai lần (9/11)

Đo lại theo từng ô giá trị (nhãn in mà không có giá trị thì không tính là sót), trên 4 bảng điểm thật của bộ thử: 397 giá trị in, 396 đúng (99,7%), 1 sót. Con số 93–98% ở trên đếm cả các dòng in không có giá trị, như "Điểm rèn luyện học kỳ" của học kỳ hè. Ô sót thuộc học kỳ đang học: bảng in "Xếp loại học tập HK: KXL", các ô khác để trống, nhưng Gemma ghi "null" cho cả khối.

Cách sửa (`check_boxes`):
- "null", "None" và các chữ tương tự được hiểu là ô trống, không còn bị báo là giá trị sai.
- Mỗi khối tổng kết được cắt riêng (`box_images`) rồi đọc lần thứ hai bằng câu lệnh riêng (`BOX_PROMPT`). Dòng nào hai lần đọc giống nhau thì giữ. Dòng nào khác nhau thì đọc lần thứ ba bằng ảnh phóng to 1,2 lần và lấy theo đa số.
- Không có đa số: giữ kết quả của lần đọc riêng, trang có cảnh báo `summary_unsure`.
- Lần đọc riêng bị lỗi, hoặc số khối Gemma đọc được không khớp số ảnh khối: giữ nguyên như đã đọc, trang có cảnh báo `summary_unchecked`. Lỗi ở lần đọc riêng không làm hỏng cả bảng điểm.
- Chi phí thêm khoảng 10 neuron mỗi khối, tức khoảng 100–150 neuron mỗi bảng điểm.

Thử trên các bảng điểm sinh viên đã import (9/11, theo yêu cầu của người dùng): PDF lấy từ database và chỉ nằm trong bộ nhớ, gửi lên tài khoản phụ, chỉ in số đếm.
- Database có 18 bảng điểm: 15 PDF có lớp chữ, 3 bản scan. Dữ liệu đã lưu khớp với bộ đọc lớp chữ hiện tại. Riêng 1 bảng import ngày 18/10 thiếu một ô "KXL", vì bộ đọc lúc đó chưa biết chữ này.
- Ép Gemma đọc 2 PDF có lớp chữ, lấy lớp chữ làm đáp án: dòng môn đúng hoàn toàn 51/51 và 56/56; khối tổng kết đúng 102/102 và 110/110 giá trị, gồm cả ô KXL.
- 3 bản scan, so với kết quả PaddleOCR đã lưu:
  - khối tổng kết khớp 118/118, 102/102 và 118/118 giá trị;
  - dòng môn khớp 64/64, 80/80 và 58/60. Ở file cuối có 2 mã môn khác PaddleOCR, chưa rõ bên nào đúng.
- 1 PDF có lớp chữ không đọc xong: Workers AI trả lỗi 500 cho một dải cả 4 lần thử.

## Thử trên tài khoản phụ (8/11)

Các lần thử dùng tài khoản Cloudflare phụ (`CLOUDFLARE_TEST_ACCOUNT_ID`, `CLOUDFLARE_TEST_API_TOKEN` trong `apps/api/.env`), không bao giờ dùng tài khoản của web. Với sinh viên giả của schema e2e:
- Nhận xét năng lực: xong sau 51 giây, qua bộ kiểm tra của API.
- Lộ trình AI: xong sau 79 giây, 10 môn, 4 tháng.
- Lời khuyên xét tốt nghiệp: 18 giây.
- Trợ lý AI: 3–9 giây.
- Tải bảng điểm qua API (sinh viên giả K28):
  - PDF có lớp chữ: đọc xong sau 3 giây (8 học kỳ, 44 môn);
  - cùng bảng điểm ở dạng scan: Gemma đọc xong sau 33 giây, cũng 8 học kỳ và 44 môn.

## Ngân sách neuron 24 giờ (`ai-worker/budget.ts`, migration 060, theo tài khoản từ 061)

Ngày 9/11: tài khoản miễn phí đã dùng 11.060 neuron trong ngày 8/11 vẫn bị lỗi 4006 ("used up your daily free allocation") sau mốc 00:00 UTC, dù trang quản lý ghi 0/10k. Đây là lỗi đã biết của Cloudflare với tài khoản miễn phí từng vượt 10.000 neuron; Cloudflare Community có nhiều báo cáo kẹt từ 5 đến hơn 10 tiếng. Vì vậy server không để tài khoản vượt mức:
- Nhiều khả năng Cloudflare tính 10.000 neuron miễn phí theo 24 giờ trượt, không xóa về 0 lúc 00:00 UTC (tài liệu của Cloudflare chỉ ghi "mỗi ngày"). Bằng chứng ngày 9/11: tài khoản thử báo 4006 lúc 05:45 UTC khi mới dùng khoảng 4.300 neuron từ 00:00 UTC, cộng khoảng 5.000 neuron đã dùng tối hôm trước thì vừa chạm 10.000. Vì vậy từ migration 060 server đếm theo giờ và cộng 24 giờ gần nhất.
- Mỗi lần gọi chat, embedding hay đọc bản scan bằng Gemma đều cộng số neuron vào giờ hiện tại trong bảng `ai_usage_hours`. Số lấy từ `usage.neurons` mà Workers AI trả về; nếu không có thì tính từ số token theo giá (Gemma 4 26B: 0,10 và 0,30 USD mỗi triệu token; BGE-M3: 0,0118 USD; 1.000 neuron = 0,011 USD).
- Giới hạn mặc định 9.000 neuron trong 24 giờ gần nhất (`AI_DAILY_NEURONS`; `off` là không giới hạn, dành cho gói trả phí). Mỗi việc mới cần dư ít nhất 600 neuron.
- Khi chạm mức: worker báo `daily_budget` và ngừng nhận việc. Các việc AI nằm chờ trong hàng đợi và chạy tiếp khi neuron của các giờ cũ ra khỏi khung 24 giờ. Bảng điểm scan kết thúc bằng `ocr_busy` mà không gửi ảnh đi.
- Nếu Workers AI vẫn trả 4006 (neuron dùng ở nơi khác, hoặc Cloudflare đếm khác), server ghi `ai_quota_block` và ngừng mọi lệnh gọi Workers AI trong 1 giờ thay vì gọi lại liên tục. Worker AI và bộ đọc bảng điểm dùng chung khóa này.
- Từ migration 061 (9/11, người dùng: "Tôi đã đổi key rồi nhưng sao nó k chạy nhỉ"), cả bộ đếm lẫn khóa đều tính riêng cho từng tài khoản Cloudflare. Bảng chỉ lưu 16 ký tự đầu của SHA-256 mã tài khoản, không lưu mã. Vì vậy khi đổi key trên Render sang tài khoản khác, web chạy ngay với bộ đếm trống, không bị khóa hay lượt dùng của tài khoản cũ cản. Xóa dòng `ai_quota_block` của một tài khoản thì khóa của tài khoản đó được gỡ trong vòng 30 giây, không cần khởi động lại.
- Thiếu hai bảng này (schema thử) thì mỗi tiến trình đếm trong bộ nhớ.

## Cấu hình (`apps/api/.env`, Render → Environment)

- `CLOUDFLARE_ACCOUNT_ID`: 32 ký tự hex.
- `CLOUDFLARE_API_TOKEN`: token tạo từ mẫu "Workers AI" (Read + Edit).
- `AI_PROVIDER=cloudflare`: bật chuyển sang Cloudflare. Để trống thì giữ worker trên PC.
- `AI_CONCURRENCY`: số việc AI chạy cùng lúc, 1–4, mặc định 2.

Giá trị sai không làm sập trang. `aiProviderConfig` đọc lỏng; `server.ts` chỉ ghi log "the AI worker was not started" rồi chạy tiếp. Token không bao giờ được ghi log, và chỉ được truyền cho tiến trình Python khi chạy OCR bằng Gemma.

## Kiểm thử

- `apps/api`: `ai-worker/cloudflare.test.ts`, `ai-worker/cloud.test.ts`, `student/text-layer.test.ts`.
- `services/ocr`: `python -m unittest test_gemma_ocr test_outline_text`.
- Đánh giá trên bảng điểm giả theo đúng mẫu VLU: lấy bảng của PDF thật trên máy, thay mọi điểm và số tổng kết bằng số ngẫu nhiên, xóa chữ ngoài bảng. Chạy trong thư mục tạm, không commit. Bảng điểm thật chỉ được gửi lên tài khoản phụ khi người dùng yêu cầu (8/11: thư mục thử; 9/11: bảng điểm trong database). Khi đó chỉ gửi phần bảng đã che và chỉ in số đếm.
