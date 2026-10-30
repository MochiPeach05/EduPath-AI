# Tổng quan sinh viên (STU-PROG-01…03)

Người dùng (30/10/2026) xem bản xem trước, góp ý "hơi ít thông tin", "Cái cần lưu ý đẩy xuống dưới cùng còn thông báo xóa đi vì mình có cái icon chuông", rồi duyệt: "Ok triển khai đi". Bản xem trước: https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652

## Trang (`apps/web/src/StudentOverview.tsx`)
Thứ tự từ việc cần làm ngay tới chi tiết:
1. Lời chào, chuyên ngành, học kỳ đang học, đếm ngược tới học kỳ sau (lịch `roadmap/window.ts` TERM_CALENDAR).
2. Khối đỏ hồ sơ còn thiếu (giữ nguyên như trước).
3. 6 ô số liệu: GPA tích lũy (kèm thay đổi so với học kỳ trước), tín chỉ đã đạt, năng lực chung, mức phù hợp nghề, xét tốt nghiệp, Lộ trình AI.
4. **Tiến độ học tập** (STU-PROG-02): thanh tín chỉ (đã đạt, đang học, trễ kế hoạch, còn lại) và từng học kỳ của kế hoạch đào tạo; bấm một học kỳ để xem môn. Bên cạnh là **Xét tốt nghiệp**: từng điều kiện của tiêu chuẩn của chính sinh viên.
5. **Năng lực và nghề mục tiêu** (3 kỹ năng mạnh nhất, kỹ năng còn thiếu, mức phù hợp) và **Điểm trung bình theo học kỳ** (biểu đồ GPA học kỳ và tích lũy, vạch 2,00, rê chuột xem số, có bảng số liệu; cặp màu #3a6ad4/#a33ea1 qua kiểm tra mù màu).
6. **Học kỳ này** (môn đang học và kỹ năng rèn luyện) và **Học kỳ tới** (môn Lộ trình AI đề xuất kèm lý do, kỹ năng tự học, việc của tháng đầu, số tín chỉ đã xếp vào Kế hoạch học kỳ).
7. **Hỏi nhanh Trợ lý AI**: ô hỏi và câu gợi ý; câu hỏi được chuyển sang trang Trợ lý AI và gửi ngay (`assistant-handoff.ts`, sessionStorage, tối đa 60 giây).
8. **Cần chú ý** (STU-PROG-03) ở cuối trang.

Không có khối thông báo trên trang: thông báo chỉ ở chuông (`docs/notifications.md`).

## API `GET /api/student/overview` (`apps/api/src/overview/`)
Hợp đồng: `apps/web/src/overview-types.ts`. Một lần đọc, một giao dịch REPEATABLE READ READ ONLY, không dùng AI.
- Bảng điểm: chép đúng các dòng tổng kết in trên bảng điểm (không tính lại GPA).
- Tiến độ: chạy engine đánh giá năng lực trên bảng điểm hiện tại (`readAssessmentInputs` với `careerOptional`, `weightsOptional`; `assessWithoutHistory`), chỉ dùng trạng thái học phần và học kỳ dự kiến; không đọc điểm kỹ năng.
- Xét tốt nghiệp: tiêu chuẩn của chính sinh viên, như trang Điều kiện xét tốt nghiệp.
- Năng lực: chỉ lấy lần Đánh giá năng lực đã lưu; null khi chưa có hoặc sinh viên đã rút lại sự đồng ý; `stale` khi bảng điểm, chuyên ngành hay nghề đã đổi.
- Lộ trình AI: lần mới nhất; số tín chỉ đã xếp lấy từ Kế hoạch học kỳ đã lưu.

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
