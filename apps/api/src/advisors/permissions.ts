// What a cố vấn học tập may see and do (AD-AST-09, "Xem danh sách các thao tác được cấp quyền cho cố vấn học tập"; user
// 2026-11-03). The page Quyền cố vấn shows this list as it is; the checks themselves live in access.ts (ACTING_ACTIONS,
// advisorReadOnly) and in the routers, and the privacy policy of 2026-11-03 says the same in its own words. Since the
// user's "Quản lý sinh viên" (2026-11-03: AD-AST "QTV & CVHT") the same rules hold for admins and Ban chủ nhiệm khoa, for
// every student instead of the advisor's own classes.

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
    { label: "Quản lý sinh viên", detail: "Cố vấn học tập: các lớp được Khoa phân công và sinh viên của từng lớp; quản trị viên, Ban chủ nhiệm khoa: mọi lớp và mọi sinh viên. Tìm theo MSSV hoặc họ tên, lọc theo lớp và tình trạng hồ sơ." },
    { label: "Trang của sinh viên", detail: "Xem chi tiết mở toàn bộ trang sinh viên (hồ sơ, bảng điểm, Khảo sát định hướng, Đánh giá năng lực, Khoảng trống kỹ năng, Định hướng nghề nghiệp, Lộ trình học tập, Xét tốt nghiệp, chương trình và kế hoạch đào tạo) của sinh viên lớp mình phụ trách, hoặc của mọi sinh viên với quản trị viên và Ban chủ nhiệm khoa." },
    { label: "Danh mục của Khoa", detail: "Chương trình đào tạo, kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp, năng lực, kỹ năng, lĩnh vực và vị trí nghề nghiệp, ở chế độ chỉ xem." },
    { label: "Cố vấn học tập", detail: "Danh sách cố vấn học tập của Khoa và các lớp từng người phụ trách." },
    { label: "Thống kê", detail: "Các trang Thống kê (tổng quan, tiến độ, nguy cơ, kỹ năng thiếu, vị trí mục tiêu, môn đề xuất) và tệp Excel của chúng, chỉ tính sinh viên các lớp mình phụ trách; Nhật ký thao tác gồm thao tác của chính mình và các thao tác liên quan đến sinh viên các lớp mình phụ trách." },
  ],
  act: [
    { label: "Import bảng điểm", detail: "Tải bảng điểm PDF lên thay sinh viên, kể cả khi sinh viên chưa import lần nào." },
    { label: "Đánh giá năng lực", detail: "Chạy và đánh giá lại năng lực, tạo lại nhận xét AI, khi sinh viên đã có bảng điểm, chuyên ngành và vị trí nghề nghiệp mục tiêu; không chạy lại khi sinh viên đã tự xóa kết quả đánh giá." },
    { label: "Lộ trình AI", detail: "Tạo Lộ trình AI cho học kỳ tới, khi sinh viên đã làm Khảo sát định hướng." },
    { label: "Lời khuyên xét tốt nghiệp", detail: "Xem và tạo lại lời khuyên của AI ở trang Xét tốt nghiệp." },
    { label: "Trợ lý AI", detail: "Hỏi Trợ lý AI trong tài khoản của sinh viên; cố vấn và quản trị viên chỉ thấy các cuộc trò chuyện mình tạo, sinh viên thấy tất cả." },
  ],
  never: [
    { label: "Khảo sát định hướng", detail: "Không làm, sửa hay xóa câu trả lời thay sinh viên." },
    { label: "Đồng ý chính sách", detail: "Không đồng ý hay rút đồng ý thay sinh viên." },
    { label: "Xóa dữ liệu", detail: "Không xóa bảng điểm, kết quả đánh giá, lộ trình hay cuộc trò chuyện của sinh viên." },
    { label: "Thông báo của sinh viên", detail: "Không xem, đánh dấu đã đọc hay xóa thông báo trong chuông của sinh viên." },
    { label: "Lựa chọn của sinh viên", detail: "Không chọn chuyên ngành, vị trí nghề nghiệp mục tiêu, không sửa Kế hoạch học kỳ." },
    { label: "Trang quản trị", detail: "Vai trò Cố vấn học tập chỉ xem: không thêm, sửa, xóa, import dữ liệu hay tải tệp Excel nguồn, không chạy AI đề xuất liên kết kỹ năng; không xem Tài khoản và Thông báo." },
  ],
  notes: [
    "Mỗi việc làm thay được ghi vào Nhật ký thao tác (người làm, việc đã làm, sinh viên).",
    "Sinh viên nhận thông báo trong chuông khi cố vấn học tập hoặc quản trị viên của Khoa import bảng điểm, chạy Đánh giá năng lực, tạo Lộ trình AI hay hỏi Trợ lý AI thay mình.",
    "Cố vấn học tập chỉ mở được trang của sinh viên thuộc lớp mình đang phụ trách (khi Khoa đổi phân công, quyền đi theo lớp); quản trị viên và Ban chủ nhiệm khoa mở được trang của mọi sinh viên.",
  ],
};
