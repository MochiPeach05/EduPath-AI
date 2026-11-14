# Không gian sinh viên

## Một bước để bắt đầu (14/11/2026)

Giảng viên hướng dẫn góp ý ngày 13/11: bắt chọn 3 mục rồi thêm khảo sát dài làm sinh viên nản; vị trí nghề nghiệp chỉ chọn khi muốn định hướng; Xét tốt nghiệp chỉ cần bảng điểm và chuyên ngành; chọn chuyên ngành ngay trong giao diện import. Bản xem trước được duyệt ("Triển khai theo kế hoạch này đi"): https://claude.ai/code/artifact/1d5dbbec-1c0b-4aa2-acb0-839de3ae86b6.

- Khung import (`StudentTranscript`, `SpecialtyChoice`): bước 1 Chuyên ngành của bạn (chuyên ngành của ngành và khóa, cùng Chưa có chuyên ngành), bước 2 tệp PDF, ô xác nhận, Import bảng điểm. Chuyên ngành đổi thì lưu bằng `PATCH /api/student/profile` trước khi gửi PDF. Đã có bảng điểm thì thanh bảng điểm ghi Chuyên ngành kèm Đổi. Chế độ `start` (gọn) dùng ở Tổng quan và Xét tốt nghiệp khi chưa có bảng điểm.
- Bỏ: khung đỏ "Bắt buộc trước khi sử dụng" ở Tổng quan, thanh 4 bước và thẻ Mục tiêu học tập ở Hồ sơ, lời nhắc "Hồ sơ của bạn chưa đầy đủ" ở mọi trang, `requiredProfileItems`, `StudentProfileSteps`, `StudentProfileEditor`, `StudentCareerExplorer`.
- Hồ sơ và bảng điểm chỉ còn Thông tin học tập và Bảng điểm của tôi. Khảo sát chuyển sang Định hướng nghề nghiệp (Khảo sát nhanh, 5 câu, không bắt buộc). Vị trí nghề nghiệp mục tiêu chỉ chọn ở Định hướng nghề nghiệp.
- Hướng dẫn "?" còn 3 bước. "Hồ sơ đầy đủ" bên quản trị = có bảng điểm và chuyên ngành.

| Trang | Cần | Tùy chọn |
|---|---|---|
| Tổng quan | Không chặn; chưa có bảng điểm thì hiện khung Bắt đầu (chuyên ngành + PDF) | |
| Xét tốt nghiệp | Bảng điểm, chuyên ngành (import ngay trên trang khi chưa có) | |
| Đánh giá năng lực | Bảng điểm, chuyên ngành | Vị trí nghề nghiệp mục tiêu |
| Định hướng nghề nghiệp | Bảng điểm, chuyên ngành | Chọn vị trí mục tiêu, Khảo sát nhanh ngay trên trang |
| Khoảng trống kỹ năng | Đánh giá năng lực, vị trí nghề nghiệp mục tiêu (chưa có: nút mở Định hướng) | |
| Lộ trình AI | Đánh giá năng lực | Khảo sát nhanh |
| CTĐT, Kế hoạch đào tạo, Trợ lý AI | Không đòi gì | |

Trang `/dashboard` dùng bố cục sidebar, thanh công cụ, ba thẻ truy cập nhanh, hồ sơ học tập và cột mục tiêu nghề nghiệp. Chỉ tham khảo cấu trúc giao diện từ ảnh người dùng cung cấp; nội dung được điều chỉnh theo chức năng EduPath.

- Từ 24/10/2026, Tổng quan mở đầu bằng khối đỏ "Hoàn thành Hồ sơ và bảng điểm" khi hồ sơ còn thiếu, và các trang khác có dòng nhắc; xem `profile-survey.md`.
- Tổng quan và hồ sơ hiển thị dữ liệu thật qua `GET /api/student/profile`. Endpoint yêu cầu Student và chỉ truy vấn ID lấy từ session, không nhận ID người khác từ trình duyệt. Phản hồi không cache.
- Sidebar điều hướng qua hash, hỗ trợ Back/Forward và màn hình nhỏ. Tìm kiếm trên thanh công cụ tìm các chức năng trong sidebar.
- Đăng xuất dùng luồng Microsoft hiện có và hiển thị lỗi nếu thất bại.
- Bảng điểm, năng lực, nghề nghiệp, lộ trình, chương trình đào tạo và trợ lý AI có trạng thái chưa triển khai; không tạo điểm số, môn học hoặc kết quả AI giả.
- Không có migration mới. Không chạy build/test/smoke test theo yêu cầu người dùng.
