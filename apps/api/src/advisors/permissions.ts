// What a cố vấn học tập may see and do (AD-AST-09, "Xem danh sách các thao tác được cấp quyền cho cố vấn học tập"; user
// 2026-11-03; the specialty, the target vị trí nghề nghiệp, Kế hoạch học kỳ and Khảo sát định hướng since 2026-11-10). The
// page Quyền cố vấn shows this list as it is; the checks themselves live in access.ts (ACTING_ACTIONS, advisorReadOnly) and in the routers, and the privacy
// policy (2026-11-03, 2026-11-10) says the same in its own words. Since the user's "Quản lý sinh viên" (2026-11-03: AD-AST
// "QTV & CVHT") the same rules hold for admins and Ban chủ nhiệm khoa, for every student instead of the advisor's own
// classes.

export type AdvisorPermissionItem = { label: string; detail: string };
export type AdvisorPermissions = {
  /** What an advisor reads. */
  view: AdvisorPermissionItem[];
  /** What an advisor does for a student of their classes, in the student's page. */
  act: AdvisorPermissionItem[];
  /** What an advisor never does. */
  never: AdvisorPermissionItem[];
  /** How the student and the Khoa keep track. */
  notes: string[];
};

export const ADVISOR_PERMISSIONS: AdvisorPermissions = {
  view: [
    { label: "Quản lý sinh viên", detail: "Cố vấn học tập: các lớp được Khoa phân công và sinh viên của từng lớp; quản trị viên, Ban chủ nhiệm khoa: mọi lớp và mọi sinh viên. Tìm theo MSSV hoặc họ tên, lọc theo lớp và tình trạng hồ sơ. Import trước danh sách sinh viên đầy đủ của lớp (MSSV, họ và tên, lớp, email trường), kể cả sinh viên chưa đăng nhập EduPath AI, và xóa khỏi danh sách lớp sinh viên chưa đăng nhập (từ 14/11/2026)." },
    { label: "Trang của sinh viên", detail: "Xem chi tiết mở toàn bộ trang sinh viên (hồ sơ, bảng điểm, Khảo sát định hướng, Đánh giá năng lực, Khoảng trống kỹ năng, Định hướng nghề nghiệp, Lộ trình học tập, Xét tốt nghiệp, chương trình và kế hoạch đào tạo) của sinh viên lớp mình phụ trách, hoặc của mọi sinh viên với quản trị viên và Ban chủ nhiệm khoa." },
    { label: "Danh mục của Khoa", detail: "Chương trình đào tạo, kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp, năng lực, kỹ năng, lĩnh vực và vị trí nghề nghiệp, ở chế độ chỉ xem." },
    { label: "Cố vấn học tập", detail: "Danh sách cố vấn học tập của Khoa và các lớp từng người phụ trách." },
    { label: "Thống kê", detail: "Các trang Thống kê (tổng quan, tiến độ, nguy cơ, kỹ năng thiếu, vị trí mục tiêu, môn đề xuất) và tệp Excel của chúng, chỉ tính sinh viên các lớp mình phụ trách; Nhật ký thao tác gồm thao tác của chính mình và các thao tác liên quan đến sinh viên các lớp mình phụ trách." },
  ],
  act: [
    { label: "Import bảng điểm", detail: "Tải bảng điểm PDF lên thay sinh viên, kể cả khi sinh viên chưa import lần nào." },
    { label: "Chuyên ngành và vị trí nghề nghiệp mục tiêu", detail: "Chọn hoặc đổi chuyên ngành của sinh viên ở khung import bảng điểm (Hồ sơ và bảng điểm) và vị trí nghề nghiệp mục tiêu ở trang Định hướng nghề nghiệp, như sinh viên tự làm (từ 10/11/2026). Khi sinh viên đã có kết quả Đánh giá năng lực, đổi vị trí nghề nghiệp mục tiêu sẽ tự đánh giá lại (từ 14/11/2026)." },
    { label: "Kế hoạch học kỳ", detail: "Thêm, bỏ, chuyển học phần, thêm học kỳ và áp dụng hoặc bỏ qua đề xuất trong Kế hoạch học kỳ của sinh viên (trang Lộ trình học tập), như sinh viên tự làm (từ 10/11/2026)." },
    { label: "Khảo sát định hướng", detail: "Làm hoặc sửa Khảo sát định hướng thay sinh viên, không đánh dấu ô đồng ý thay sinh viên (từ 10/11/2026). Khảo sát này được dùng cho các chức năng AI của sinh viên như khảo sát sinh viên tự làm, cho đến khi sinh viên sửa lại hoặc rút đồng ý; không làm thay được khi sinh viên đã xóa câu trả lời khảo sát." },
    { label: "Đánh giá năng lực", detail: "Chạy và đánh giá lại năng lực, tạo lại nhận xét AI, khi sinh viên đã có bảng điểm và chuyên ngành (vị trí nghề nghiệp mục tiêu không bắt buộc từ 14/11/2026); không chạy lại khi sinh viên đã tự xóa kết quả đánh giá." },
    { label: "Lộ trình AI", detail: "Tạo Lộ trình AI cho học kỳ tới, khi sinh viên đã có kết quả Đánh giá năng lực; có Khảo sát định hướng thì lộ trình dùng thêm câu trả lời (khảo sát không bắt buộc từ 14/11/2026)." },
    { label: "Lời khuyên xét tốt nghiệp", detail: "Xem và tạo lại lời khuyên của AI ở trang Xét tốt nghiệp." },
    { label: "Trợ lý AI", detail: "Hỏi Trợ lý AI trong tài khoản của sinh viên; cố vấn và quản trị viên chỉ thấy các cuộc trò chuyện mình tạo, sinh viên thấy tất cả." },
  ],
  never: [
    { label: "Đồng ý chính sách", detail: "Không đồng ý hay rút đồng ý thay sinh viên." },
    { label: "Xóa dữ liệu", detail: "Không xóa bảng điểm, câu trả lời khảo sát, kết quả đánh giá, lộ trình hay cuộc trò chuyện của sinh viên." },
    { label: "Thông báo của sinh viên", detail: "Không xem, đánh dấu đã đọc hay xóa thông báo trong chuông của sinh viên." },
    { label: "Trang quản trị", detail: "Vai trò Cố vấn học tập chỉ xem, trừ import danh sách sinh viên và xóa khỏi danh sách sinh viên chưa đăng nhập của lớp mình phụ trách: không thêm, sửa, xóa, import dữ liệu khác hay tải xuống Excel CTĐT, KHĐT, tiêu chuẩn, không chạy AI đề xuất liên kết kỹ năng; không xem Tài khoản và Thông báo." },
    { label: "Sinh viên chưa đăng nhập", detail: "Sinh viên chỉ có tên trong danh sách lớp chưa có trang EduPath AI: không ai import bảng điểm, chạy AI, làm thay hay gửi thông báo cho họ cho đến khi họ tự đăng nhập lần đầu." },
  ],
  notes: [
    "Mỗi việc làm thay được ghi vào Nhật ký thao tác (người làm, việc đã làm, sinh viên); Kế hoạch học kỳ tự lưu sau mỗi thay đổi nên được ghi tối đa một dòng mỗi nửa giờ.",
    "Sinh viên nhận thông báo trong chuông khi cố vấn học tập hoặc quản trị viên của Khoa import bảng điểm, đổi chuyên ngành hay vị trí nghề nghiệp mục tiêu, sửa Kế hoạch học kỳ, làm Khảo sát định hướng, chạy Đánh giá năng lực, tạo Lộ trình AI hay hỏi Trợ lý AI thay mình.",
    "Cố vấn học tập chỉ mở được trang của sinh viên thuộc lớp mình đang phụ trách (khi Khoa đổi phân công, quyền đi theo lớp); quản trị viên và Ban chủ nhiệm khoa mở được trang của mọi sinh viên.",
  ],
};
