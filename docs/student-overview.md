# Tổng quan sinh viên (STU-PROG-01…03)

Người dùng (30/10/2026) xem bản xem trước, góp ý "hơi ít thông tin", "Cái cần lưu ý đẩy xuống dưới cùng còn thông báo xóa đi vì mình có cái icon chuông", rồi duyệt: "Ok triển khai đi". Bản xem trước: https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652

## Trang (`apps/web/src/StudentOverview.tsx`)
Thứ tự từ việc cần làm ngay tới chi tiết:
1. Lời chào, chuyên ngành, học kỳ đang học (không còn đếm ngược, "soạn … trước" hay "đánh giá dd/mm": người dùng bỏ 30/10).
2. Khối đỏ hồ sơ còn thiếu (giữ nguyên như trước).
3. 6 ô số liệu: GPA tích lũy (kèm thay đổi so với học kỳ trước), tín chỉ đã đạt, năng lực chung, mức phù hợp nghề, xét tốt nghiệp, Lộ trình AI.
4. Hai cột độc lập (99762d7, người dùng thấy lưới theo hàng "xấu xấu"):
   - cột trái: **Tiến độ học tập** (STU-PROG-02: thanh tín chỉ đã đạt, đang học, trễ kế hoạch, còn lại và từng học kỳ của kế hoạch đào tạo; bấm một học kỳ để xem môn), rồi một thẻ chia đôi **Học kỳ này** (môn đang học, kỹ năng rèn luyện) | **Học kỳ tới · theo Lộ trình AI** (môn đề xuất kèm lý do, "Lộ trình AI gợi ý luyện thêm", việc của tháng đầu, tín chỉ của học kỳ đó trong Kế hoạch học kỳ);
   - cột phải: **Xét tốt nghiệp** (từng điều kiện của tiêu chuẩn của chính sinh viên), **Năng lực và nghề mục tiêu** (kỹ năng mạnh nhất kèm môn minh chứng, kỹ năng còn thiếu, mức phù hợp), **Điểm trung bình theo học kỳ** (GPA học kỳ tính cả môn chưa đạt, GPA tích lũy chỉ tính môn đã đạt, chép từ bảng điểm; vạch 2,00; bảng số liệu; cặp màu #3a6ad4/#a33ea1 qua kiểm tra mù màu).
5. Màn hình hẹp: một cột.
6. **Hỏi nhanh Trợ lý AI**: ô hỏi và câu gợi ý; câu hỏi được chuyển sang trang Trợ lý AI và gửi ngay (`assistant-handoff.ts`, sessionStorage, tối đa 60 giây).
7. **Cần chú ý** (STU-PROG-03) ở cuối trang.

Không có khối thông báo trên trang: thông báo chỉ ở chuông (`docs/notifications.md`).

## API `GET /api/student/overview` (`apps/api/src/overview/`)
Hợp đồng: `apps/web/src/overview-types.ts`. Một lần đọc, một giao dịch REPEATABLE READ READ ONLY, không dùng AI.
- Bảng điểm: chép đúng các dòng tổng kết in trên bảng điểm (không tính lại GPA).
- Tiến độ: chạy engine đánh giá năng lực trên bảng điểm hiện tại (`readAssessmentInputs` với `careerOptional`, `weightsOptional`; `assessWithoutHistory`), chỉ dùng trạng thái học phần và học kỳ dự kiến; không đọc điểm kỹ năng.
- Xét tốt nghiệp: tiêu chuẩn của chính sinh viên, như trang Điều kiện xét tốt nghiệp.
- Năng lực: chỉ lấy lần Đánh giá năng lực đã lưu; null khi chưa có hoặc sinh viên đã rút lại sự đồng ý; `stale` khi bảng điểm, chuyên ngành hay nghề đã đổi.
- Lộ trình AI: lần mới nhất. `roadmap.plan` {credits, status} là tín chỉ của học kỳ tới trong Kế hoạch học kỳ đã lưu (nếu chưa xếp thì tổng của lộ trình), kiểm tra theo đúng mức của Kế hoạch học kỳ (`roadmap.limits` {min, max}, cùng cách tính `termLoad`), nên Tổng quan và Kế hoạch học kỳ luôn cùng kết luận, ví dụ "vượt tối đa 18 TC".
- Kỹ năng mạnh: `courses[]` là các môn tạo nên điểm (phần đóng góp lớn trước, kèm điểm chữ được tính).

## Quy tắc hiển thị chung (30/10/2026, `apps/web/src/display-format.ts`, `apps/api/src/term-name.ts`)
- Học kỳ một kiểu: "HK1 2026–2027" (`termName`).
- Điểm 0–100: tối đa một chữ số thập phân, làm tròn xuống tới 0,1 để không bao giờ hiện đã chạm ngưỡng 62,5/80/90 khi chưa chạm (`scoreText`); dấu phẩy thập phân ở mọi nơi.
- Màu theo chữ (`meaningOf`): xanh lá Xuất sắc/Giỏi/Rất phù hợp/Phù hợp, xanh dương Khá, vàng Trung bình/Ít phù hợp và các mục trễ, đỏ chỉ cho chưa đạt (môn F/VT/CT, GPA dưới ngưỡng), xám chưa có điểm.
- Chữ tối thiểu 12px, chữ thường 14px.

## Cần chú ý (`overview/warnings.ts`, hàm thuần `overviewWarnings`)
Hệ thống tự tính, không dùng AI; chỉ để tham khảo, không thay cảnh báo học vụ của trường.
| Loại | Mức | Khi nào |
| --- | --- | --- |
| failed_course | Nguy cơ | Môn bắt buộc chưa đạt (F, VT, CT), chưa có lần đạt và không đang học lại |
| pace | Nguy cơ | Tín chỉ còn lại chia cho số học kỳ còn lại của kế hoạch vượt mức nặng nhất mà kế hoạch đặt cho một học kỳ (hoặc kế hoạch không còn học kỳ nào) |
| gpa_below | Nguy cơ | GPA tích lũy dưới ngưỡng của tiêu chuẩn xét tốt nghiệp |
| late_course | Cần chú ý | Môn của học kỳ đã qua chưa học (tối đa 3 mục, phần còn lại gộp một mục) |
| elective_short | Cần chú ý | Nhóm tự chọn của học kỳ đã qua còn thiếu tín chỉ |
| on_track | Ổn | Không có mục nào ở trên |
| missing_data | Cần chú ý | Chưa có bảng điểm, chưa chọn chuyên ngành, chưa có kế hoạch đào tạo… |

Mỗi mục có `key` cố định (`failed:<mã>`, `pace`, `late:<mã>`…). Các mục mức Nguy cơ và Cần chú ý (trừ missing_data) thành thông báo ở chuông, mỗi mục một lần (`notifications/notify.ts` notifyWarnings), ngay sau khi import bảng điểm và mỗi khi mở Tổng quan.

## Lỗi "học kỳ đang học" khi học lại (sửa cùng đợt)
Bài kiểm tra 50 câu của Trợ lý AI (30/10) thấy dữ liệu của Lộ trình AI và Trợ lý AI ghi "học kỳ đang học: học kỳ 2 năm học 2023–2024" cho sinh viên đang ở học kỳ 1 năm học 2026–2027. Nguyên nhân: môn đang học lại mang học kỳ của lần rớt cũ trong `result.courses`, và `roadmap/facts.ts` lấy học kỳ sớm nhất. Nay lấy `transcript.studyTerm` đã lưu (từ comp-calc-v13), nếu thiếu thì học kỳ muộn nhất; kết quả đã lưu đúng ngay, không cần Đánh giá lại. Nhãn "Sắp học (học kỳ…)" của trang Đánh giá năng lực vẫn có thể ghi học kỳ cũ cho môn đang học lại: sửa phần đó cần nâng phiên bản engine, chờ người dùng quyết.
