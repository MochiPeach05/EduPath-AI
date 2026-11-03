# EduPath AI

**AI đồng hành · Học tập bứt phá.** Nền tảng đánh giá năng lực và tư vấn lộ trình học tập cá nhân hóa cho sinh viên
ngành Công nghệ Thông tin, Trường Đại học Văn Lang.

- Bản đang chạy: <https://edupath-ai-q28n.onrender.com>, đăng nhập bằng tài khoản Microsoft của trường.
- Kiến trúc chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Bài toán

Sinh viên khó tự trả lời ba câu hỏi:

- Mình đang mạnh, yếu ở kỹ năng nào?
- Mình còn thiếu gì cho vị trí nghề nghiệp mình muốn?
- Mình cần học gì, vào học kỳ nào để kịp tốt nghiệp?

Câu trả lời nằm rải rác trong bảng điểm, chương trình đào tạo (CTĐT), kế hoạch đào tạo (KHĐT) và tiêu chuẩn xét tốt
nghiệp của từng khóa. Mỗi cố vấn học tập lại phụ trách nhiều lớp cùng lúc.

EduPath AI giải quyết bằng các bước:

1. Đọc bảng điểm PDF của sinh viên.
2. Đối chiếu với dữ liệu đào tạo của Khoa để tính năng lực theo từng kỹ năng.
3. So năng lực đó với yêu cầu của các vị trí nghề nghiệp trong danh mục của Khoa.
4. Kiểm tra điều kiện xét tốt nghiệp.
5. Đề xuất lộ trình học tập cho học kỳ tới.

Mọi con số do mã nguồn tính. AI chạy cục bộ (Gemma 4 qua Ollama) để giải thích kết quả bằng lời dễ hiểu, soạn lộ
trình và trả lời câu hỏi.

## Người dùng

| Vai trò | Dùng EduPath AI để |
|---|---|
| Sinh viên | Import bảng điểm; xem năng lực, khoảng trống kỹ năng, vị trí nghề nghiệp phù hợp và điều kiện xét tốt nghiệp; nhận Lộ trình AI; hỏi Trợ lý AI |
| Cố vấn học tập | Xem các lớp mình phụ trách, mở trang của từng sinh viên và làm thay một số việc (import bảng điểm, đánh giá năng lực, Lộ trình AI, hỏi Trợ lý AI). Mỗi việc được ghi nhật ký và báo cho sinh viên |
| Quản trị viên, Ban chủ nhiệm khoa | Quản lý dữ liệu đào tạo, nghề nghiệp, năng lực, tài khoản và cố vấn; xem báo cáo; gửi thông báo; mở trang của mọi sinh viên như cố vấn |
| Trưởng/phó bộ môn, Giảng viên | Dùng cổng quản trị theo quyền được cấp |

## Chức năng

### Cổng sinh viên (`/dashboard`)

| Trang | Nội dung |
|---|---|
| Tổng quan | GPA, tín chỉ, năng lực chung, mức phù hợp với vị trí nghề nghiệp mục tiêu, tình trạng xét tốt nghiệp, tiến độ theo kế hoạch đào tạo, các mục cần chú ý |
| Hồ sơ và bảng điểm | Thông tin học tập; Mục tiêu học tập (vị trí nghề nghiệp mục tiêu, chuyên ngành); Khảo sát định hướng (thế mạnh, sở trường, thành tích); import bảng điểm PDF, đọc bằng OCR |
| Đánh giá năng lực | Điểm từng kỹ năng và nhóm năng lực, tính từ điểm học phần và trọng số kỹ năng của học phần; diễn biến theo học kỳ; nhận xét của AI |
| Khoảng trống kỹ năng | Kỹ năng của sinh viên so với yêu cầu của vị trí nghề nghiệp mục tiêu; học phần nên học, nên cải thiện; kỹ năng cần tự học |
| Định hướng nghề nghiệp | Điểm phù hợp với mọi vị trí nghề nghiệp của danh mục, bảng xếp hạng, gợi ý theo Khảo sát định hướng, so sánh các vị trí |
| Lộ trình học tập | Theo dõi tiến độ theo tiêu chuẩn xét tốt nghiệp. Lộ trình AI cho học kỳ tới: môn cần học, học lại, học cải thiện, kỹ năng nên bổ sung, kế hoạch theo tháng. Kế hoạch học kỳ kéo thả, có kiểm tra học phần tiên quyết và số tín chỉ |
| Xét tốt nghiệp | Bảng điểm đối chiếu với tiêu chuẩn xét tốt nghiệp của khóa và chuyên ngành; lời khuyên của AI |
| Trợ lý AI | Hỏi đáp về kết quả học tập của chính mình và quy định của Khoa; câu trả lời có dẫn nguồn |
| Thông báo | Chuông thông báo: kết quả AI, cảnh báo tiến độ, thông báo của Khoa; lọc theo loại |

### Cổng quản trị (`/quantri`)

| Nhóm | Nội dung |
|---|---|
| Báo cáo | Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký thao tác; xem toàn khóa hoặc từng khóa; xuất Excel |
| Tài khoản, Sinh viên | Phân quyền, khóa/mở tài khoản, tạo trước tài khoản; hồ sơ và bảng điểm của sinh viên |
| Cố vấn học tập | Danh sách cố vấn và lớp phụ trách, import từ file phân công của Khoa. Quản lý sinh viên: mở trang của sinh viên và làm thay |
| Quản lý đào tạo | Chương trình đào tạo, kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp theo khóa và chuyên ngành, nhập từ file Excel của Khoa |
| Quản lý nghề nghiệp | Lĩnh vực, danh mục kỹ năng, vị trí nghề nghiệp và yêu cầu kỹ năng; AI gợi ý kỹ năng cho vị trí nghề nghiệp |
| Quản lý năng lực | Nhóm năng lực, cấu hình năng lực. Cấu hình môn học: liên kết học phần với kỹ năng kèm trọng số, làm thủ công hoặc để AI đề xuất bản nháp rồi người quản trị duyệt áp dụng |
| Quản lý thông báo | Gửi thông báo của Khoa tới sinh viên, xem các thông báo đã gửi |

## Cách EduPath AI dùng AI

- **Mã nguồn tính, AI giải thích.** Các chỉ số dưới đây do mã nguồn tính, trong `apps/api/src/competency-assessment`,
  `graduation` và `study-plan`:
  - điểm năng lực, khoảng trống kỹ năng, điểm phù hợp;
  - tiến độ học tập và điều kiện xét tốt nghiệp.

  AI chỉ viết nhận xét, lời khuyên, lộ trình và câu trả lời dựa trên các số liệu đó. Đầu ra được kiểm tra trước khi
  hiển thị.
- **Chạy cục bộ.** Model `gemma4:e4b` và `embeddinggemma` chạy bằng Ollama trên một máy cá nhân có GPU. Worker AI tự lấy việc từ
  hàng đợi trong PostgreSQL qua HTTPS. Dữ liệu không được gửi tới dịch vụ AI đám mây nào. Model không nhận họ tên, MSSV,
  email hay tệp PDF bảng điểm.
- **Có phiên bản.** Mỗi prompt và cách tính có mã phiên bản lưu cùng kết quả, để biết kết quả nào cần tạo lại khi quy
  tắc thay đổi.

| Việc của AI | Hiện ở |
|---|---|
| Nhận xét năng lực cho sinh viên | Đánh giá năng lực |
| Lộ trình học tập cho học kỳ tới | Lộ trình học tập |
| Lời khuyên xét tốt nghiệp | Xét tốt nghiệp |
| Trả lời câu hỏi bằng RAG: dữ liệu SQL của sinh viên và kho tri thức tìm bằng BM25 kết hợp EmbeddingGemma | Trợ lý AI |
| Gợi ý kỹ năng cho vị trí nghề nghiệp | Quản trị, Vị trí nghề nghiệp |
| Gợi ý liên kết học phần với kỹ năng, kèm trọng số | Quản trị, Cấu hình môn học |

## Kiến trúc

```text
Trình duyệt (React + Vite)
        │ HTTPS, cookie HttpOnly
        ▼
Render Web Service: API Express 5, phục vụ luôn bản build React
        │                                    ▲
        ▼                                    │ lấy việc qua HTTPS, xác thực bằng khóa worker
PostgreSQL: dữ liệu, session,          Máy cá nhân chạy worker
hàng đợi việc AI và OCR                 ├─ Worker AI: Ollama (gemma4:e4b, embeddinggemma)
                                        └─ Worker OCR: PaddleOCR + PyMuPDF đọc PDF bảng điểm

Microsoft Entra ID: đăng nhập bằng tài khoản trường (MSAL, Authorization Code + PKCE)
```

| Thành phần | Công nghệ |
|---|---|
| Giao diện | React 19, Vite 8, TypeScript |
| API | Node.js 22, Express 5, pg, zod, MSAL Node, exceljs và xlsx, pdfjs-dist |
| Cơ sở dữ liệu | PostgreSQL, migration SQL đánh số trong `apps/api/migrations` |
| AI | Ollama, Gemma 4 E4B (`gemma4:e4b`), EmbeddingGemma |
| OCR | Python, PaddleOCR 3.7, PyMuPDF |
| Kiểm thử | Vitest |
| Triển khai | Render, một Web Service cho cả web và API |

## Cấu trúc thư mục

```text
EduPath_AI/
├─ apps/
│  ├─ api/        API Express: src/ chia theo module, migrations/, data/ (file CTĐT, KHĐT mẫu)
│  └─ web/        Giao diện React: src/, public/
├─ services/
│  ├─ ai/         Cấu hình và script chạy worker AI (mã worker ở apps/api/src/ai-worker)
│  └─ ocr/        Worker OCR viết bằng Python
├─ scripts/       Thiết lập worker, seed tài khoản demo, kiểm tra tích hợp verify-*.mjs
├─ docs/          Tài liệu từng chức năng
└─ render.yaml    Cấu hình triển khai Render
```

## Chạy trên máy

Cần Node.js 22. PostgreSQL cần cho mọi chức năng lưu dữ liệu. Ollama và Python chỉ cần khi chạy worker AI và worker
OCR.

1. Cài thư viện:

   ```powershell
   npm install
   ```

2. Tạo file cấu hình của API:

   ```powershell
   Copy-Item .\apps\api\.env.example .\apps\api\.env
   ```

   Rồi điền các biến:
   - `DATABASE_URL`: chuỗi kết nối PostgreSQL.
   - `SESSION_SECRET`: chuỗi ngẫu nhiên dài ít nhất 32 ký tự.
   - `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_SECRET`: lấy từ App Registration trên Microsoft Entra, với
     redirect URI `http://localhost:4000/api/auth/microsoft/callback`.
   - `AI_WORKER_KEY`, `OCR_WORKER_KEY`: do các script thiết lập worker tạo (bước 5 và 6).

3. Tạo bảng:

   ```powershell
   npm run db:migrate --workspace @edupath/api
   ```

   Khi `DATABASE_AUTO_MIGRATE=true`, API cũng tự chạy migration còn thiếu lúc khởi động.

4. Chạy API và giao diện, rồi mở <http://localhost:5173>:

   ```powershell
   npm run dev
   ```

5. Worker AI: làm theo [services/ai/README.md](services/ai/README.md). Các bước chính: `ollama pull gemma4:e4b`,
   `ollama pull embeddinggemma`, `node scripts/setup-ai-worker.mjs`, rồi `npm run ai-worker --workspace @edupath/api`.
6. Worker OCR: làm theo [docs/ocr-demo.md](docs/ocr-demo.md). Các bước chính: cài
   `services/ocr/requirements.txt`, chạy `node scripts/setup-ocr-worker.mjs`, rồi `services/ocr/start-worker.ps1`.

Khi để trống `DATABASE_URL`, API chạy ở chế độ xem thử: chỉ có trang công khai và đăng nhập, dữ liệu nằm trong bộ nhớ
và mất khi khởi động lại.

Dữ liệu đào tạo (CTĐT, KHĐT, tiêu chuẩn xét tốt nghiệp, danh sách cố vấn học tập) do quản trị viên import từ file Excel
của Khoa trong cổng quản trị.

## Kiểm thử

```powershell
npm run typecheck
npm test
npm run build
```

Kết quả ngày 03/11/2026: API 105 tệp, 1 666 test; web 54 tệp, 622 test; tất cả đều qua. Các script
`scripts/verify-*.mjs` kiểm tra tích hợp trên PostgreSQL thật, dùng một schema tạm.

## Triển khai

`render.yaml` mô tả một Render Web Service:

| Mục | Giá trị |
|---|---|
| Lệnh build | `npm ci --include=dev && npm run build` |
| Lệnh chạy | `npm start` |
| Kiểm tra sức khỏe | `/api/health` |

- API phục vụ luôn bản build React, nên web và API cùng origin, cookie đăng nhập giữ HttpOnly.
- Khi `DATABASE_AUTO_MIGRATE=true`, API áp dụng migration còn thiếu lúc khởi động.
- Các biến bí mật (`DATABASE_URL`, `ENTRA_*`, `AI_WORKER_KEY`, `OCR_WORKER_KEY`) khai báo trên Render với `sync: false`
  và không đưa vào Git.
- Trên Microsoft Entra, thêm redirect URI `https://<ten-service>.onrender.com/api/auth/microsoft/callback`.
- Worker AI và worker OCR chạy trên máy cá nhân, trỏ tới API trên Render bằng khóa worker tương ứng.

## Dữ liệu và quyền riêng tư

- Người dùng đăng nhập bằng tài khoản Microsoft của trường. Vai trò quyết định người dùng vào cổng sinh viên hay cổng
  quản trị.
- Đánh giá năng lực và Khảo sát định hướng cần sinh viên đồng ý theo Chính sách bảo mật (trang
  `/chinh-sach-va-dieu-khoan`).
- Mỗi lần cố vấn học tập hoặc quản trị viên mở trang của sinh viên hay làm thay sinh viên đều được ghi vào Nhật ký thao
  tác, và sinh viên được báo trong chuông thông báo.
- AI chạy cục bộ và không nhận thông tin định danh.
- Repository không chứa `.env`, mật khẩu, dữ liệu sinh viên thật hay file nguồn có thông tin cá nhân của Khoa.

## Tài liệu

| Chủ đề | Tài liệu |
|---|---|
| Kiến trúc tổng thể | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Đăng nhập, tài khoản quản trị | [SPRINT_2_ADMIN_AUTH.md](docs/SPRINT_2_ADMIN_AUTH.md) |
| Bảng điểm và OCR | [student-transcripts.md](docs/student-transcripts.md), [ocr-demo.md](docs/ocr-demo.md) |
| Năng lực | [competency-assessment.md](docs/competency-assessment.md), [competency-management.md](docs/competency-management.md) |
| Nghề nghiệp | [career-positions.md](docs/career-positions.md), [career-guidance.md](docs/career-guidance.md), [career-ai-suggestions.md](docs/career-ai-suggestions.md) |
| Lộ trình học tập | [study-roadmap.md](docs/study-roadmap.md) |
| Xét tốt nghiệp | [graduation-standards.md](docs/graduation-standards.md), [graduation-advice.md](docs/graduation-advice.md) |
| Trợ lý AI | [assistant.md](docs/assistant.md), [assistant-evaluation.md](docs/assistant-evaluation.md) |
| Tổng quan và thông báo | [student-overview.md](docs/student-overview.md), [notifications.md](docs/notifications.md) |
| Báo cáo quản trị | [admin-reports.md](docs/admin-reports.md) |
| Cố vấn học tập | [advisors.md](docs/advisors.md) |
| Chương trình và kế hoạch đào tạo | [curriculum-guide.md](docs/curriculum-guide.md), [training-plan-guide.md](docs/training-plan-guide.md) |
| Khảo sát định hướng | [profile-survey.md](docs/profile-survey.md) |
| Worker AI | [services/ai/README.md](services/ai/README.md) |
