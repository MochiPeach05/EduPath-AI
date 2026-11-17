// Guides of the student portal for Trợ lý AI (STU-CHAT-01..05, 2026-10-28): short texts on how to use each page, indexed
// with the catalogs (knowledge.ts, source kind "guide") so the assistant can answer "làm sao để…" questions with a link to
// the page. Written from the FAQ and the privacy policy of the portal (apps/web/src/public-information.ts, policy
// 2026-10-26), the "?" help of StudentWorkspace.tsx and docs/*.md (profile-survey, study-roadmap, career-guidance,
// competency-assessment, graduation-standards, student-transcripts); they add no rule of their own. Numbers come from the
// code that applies them (levels and career thresholds, the expected term calendar, the specialties, the question limit),
// so a change there reaches the guide, and its embedding, at the next knowledge refresh.
// 2026-10-28: the FAQ still gives the career thresholds of comp-calc-v9 (Ưu tiên 70, Bắt buộc 85); the guides follow
// CAREER_THRESHOLDS (comp-calc-v10: Khá 62,5 and Giỏi 80; comp-calc-v25: Khá 62,5 for both). The policy does not describe Trợ lý AI yet: its guide follows
// migration 055 and assistant/chat.ts, facts.ts and validate.ts.
import { CAREER_THRESHOLDS, LEVEL_THRESHOLDS } from "../competency-assessment/constants.js";
import { SPECIALTIES } from "../competency-assessment/specialty.js";
import { MAJORS } from "../curricula/majors.js";
import { TERM_CALENDAR } from "../roadmap/window.js";
import { MAX_QUESTION_CHARS } from "./protocol.js";

/** One guide: `key` is its stable source key, `link` the page of the student portal it is about. */
export type PortalGuide = { key: string; title: string; link: string; content: string };

/** The student support address (apps/web/src/public-information.ts, supportEmail). */
const SUPPORT_EMAIL = "hotrosinhvien@vlu.edu.vn";
/** Days without a new message after which a conversation of Trợ lý AI is deleted (migration 055, chat.ts). */
const CONVERSATION_RETENTION_DAYS = 90;

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const formatNumber = (value: number) => decimal.format(value);
/** "2026-12-21" → "21/12/2026". */
const dateText = (iso: string) => iso.split("-").reverse().join("/");
/** "HK262" → "HK2 2026–2027", as the portal labels terms. */
const termText = (code: string) => {
  const match = /^HK(\d{2})(\d)$/.exec(code);
  if (!match) return code;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} ${start}–${start + 1}`;
};

/** The level a threshold opens, by its name on the student pages. */
const LEVEL_NAMES: [number, string][] = [
  [LEVEL_THRESHOLDS.excellent, "Xuất sắc"], [LEVEL_THRESHOLDS.proficient, "Giỏi"], [LEVEL_THRESHOLDS.good, "Khá"], [LEVEL_THRESHOLDS.basic, "Trung bình"],
];
const levelName = (threshold: number) => LEVEL_NAMES.find(([value]) => value === threshold)?.[1] ?? formatNumber(threshold);
const levelScale = () =>
  `${LEVEL_NAMES.map(([value, name]) => `${name} từ ${formatNumber(value)}`).join("; ")}; Yếu dưới ${formatNumber(LEVEL_THRESHOLDS.basic)}`;
/** One threshold for both kinds since comp-calc-v25 (user 2026-11-16: every career skill needs Khá). */
const careerThresholds = () => CAREER_THRESHOLDS.required === CAREER_THRESHOLDS.preferred
  ? `kỹ năng Bắt buộc và kỹ năng Ưu tiên đều cần từ ${formatNumber(CAREER_THRESHOLDS.required)} điểm (mức ${levelName(CAREER_THRESHOLDS.required)})`
  :`kỹ năng Bắt buộc cần từ ${formatNumber(CAREER_THRESHOLDS.required)} điểm (mức ${levelName(CAREER_THRESHOLDS.required)}), kỹ năng Ưu tiên cần từ `
    + `${formatNumber(CAREER_THRESHOLDS.preferred)} điểm (mức ${levelName(CAREER_THRESHOLDS.preferred)})`;

/** "Công nghệ thông tin: Công nghệ phần mềm, …, An ninh Mạng và IoTs (chỉ K27), …; Hệ thống thông tin: …". */
function specialtiesText(): string {
  const cohorts = (range?: { from?: number; to?: number }) => {
    if (!range) return "";
    if (range.from !== undefined && range.from === range.to) return ` (chỉ K${range.from})`;
    if (range.from === undefined && range.to !== undefined) return ` (K${range.to} trở về trước)`;
    if (range.from !== undefined && range.to === undefined) return ` (từ K${range.from})`;
    return ` (K${range.from}–K${range.to})`;
  };
  return MAJORS.map((major) => {
    const names = SPECIALTIES.filter((item) => item.major === major.code).map((item) => `${item.label}${cohorts(item.cohorts)}`);
    return names.length ? `${major.label}: ${names.join(", ")}` : "";
  }).filter(Boolean).join("; ");
}

const termCalendarText = () => TERM_CALENDAR.map((entry) => `${termText(entry.term)} từ ${dateText(entry.start)} đến ${dateText(entry.end)}`).join("; ");

/** The guides, in the order of the "?" help: getting started, the profile, the results, the planning pages, then data. */
export function portalGuides(): PortalGuide[] {
  const guides: [key: string, title: string, link: string, lines: string[]][] = [
    ["bat-dau", "Bắt đầu với EduPath AI", "#profile", [
      "EduPath AI là cổng hỗ trợ học tập và định hướng nghề nghiệp cho sinh viên Khoa Công nghệ Thông tin, Trường Đại học Văn Lang.",
      "Chỉ cần một bước để bắt đầu: chọn chuyên ngành và import bảng điểm ở Hồ sơ và bảng điểm (khi chưa có bảng điểm, làm được ngay ở Tổng quan hoặc Xét tốt nghiệp). Vị trí nghề nghiệp mục tiêu và Khảo sát nhanh không bắt buộc.",
      "Thứ tự nên làm:",
      "- Hồ sơ và bảng điểm: chọn chuyên ngành và import bảng điểm PDF.",
      "- Định hướng nghề nghiệp: xem các vị trí nghề nghiệp hợp với bạn; khi muốn, chọn vị trí nghề nghiệp mục tiêu và làm Khảo sát nhanh.",
      "- Đánh giá năng lực: bấm Đánh giá năng lực để xem điểm theo nhóm năng lực và mức thành thạo từng kỹ năng.",
      "- Khoảng trống kỹ năng: khi đã chọn vị trí nghề nghiệp mục tiêu, xem kỹ năng còn thiếu và học phần nên học.",
      "- Lộ trình học tập: theo dõi tiến độ, nhờ EduPath AI soạn lộ trình cho học kỳ tới và lên kế hoạch các học kỳ.",
      "- Xét tốt nghiệp: đối chiếu kết quả học tập của bạn với các điều kiện xét tốt nghiệp và đọc lời khuyên của EduPath AI.",
      "- Chương trình đào tạo và Kế hoạch đào tạo (trong menu tài khoản): tra cứu học phần và kế hoạch từng học kỳ.",
      `Họ tên, mã sinh viên, khóa và lớp được lấy từ tài khoản Microsoft của trường và chỉ để xem; nếu sai hoặc trống, hãy gửi email đến ${SUPPORT_EMAIL}.`,
    ]],
    ["tong-quan", "Trang Tổng quan và thông báo", "#overview", [
      "Trang Tổng quan gom kết quả của bạn ở một nơi: GPA tích lũy, tín chỉ đã đạt, năng lực chung, mức phù hợp với vị trí nghề nghiệp mục tiêu, tình trạng xét tốt nghiệp và Lộ trình AI; tiến độ theo từng học kỳ của kế hoạch đào tạo (bấm một học kỳ để xem môn); điều kiện xét tốt nghiệp; kỹ năng mạnh nhất và còn thiếu; biểu đồ điểm trung bình theo học kỳ; các môn đang học và môn Lộ trình AI đề xuất cho học kỳ tới; ô hỏi nhanh Trợ lý AI.",
      "- Cảnh báo chậm tiến độ (cuối trang): hệ thống tự phát hiện môn bắt buộc chưa đạt mà chưa học lại, môn trễ so với kế hoạch đào tạo, nhóm tự chọn còn thiếu tín chỉ, số tín chỉ mỗi học kỳ còn lại quá nhiều để kịp tốt nghiệp và điểm trung bình dưới ngưỡng xét tốt nghiệp. Đây là kết quả tham khảo, không thay cảnh báo học vụ của trường.",
      "- Thông báo nằm ở chuông trên thanh đầu trang; số trên chuông là thông báo chưa đọc. Bạn nhận thông báo khi bảng điểm đọc xong, khi có nhận xét năng lực, Lộ trình AI hay lời khuyên xét tốt nghiệp, khi có mục mới trong Cảnh báo chậm tiến độ, khi Khoa cập nhật chương trình, kế hoạch đào tạo hay tiêu chuẩn xét tốt nghiệp và khi Khoa gửi thông báo.",
      "- Trong danh sách thông báo, bạn lọc theo Chưa đọc, Cảnh báo, Kết quả AI, Từ Khoa hoặc Hệ thống, đánh dấu đã đọc, xóa (có Hoàn tác) và bấm nút để mở trang liên quan. Thông báo tự xóa sau 90 ngày.",
    ]],
    ["import-bang-diem", "Import bảng điểm PDF", "#profile", [
      "Bảng điểm là dữ liệu gốc của mọi kết quả trên EduPath AI. Cách import:",
      "- Tải bảng điểm dạng PDF từ cổng đào tạo của trường: tối đa 5 MB, không quá 20 trang, không khóa bằng mật khẩu; bản PDF xuất trực tiếp dễ đọc hơn ảnh chụp hoặc bản scan.",
      "- Mở Hồ sơ và bảng điểm (khi chưa có bảng điểm, cũng làm được ở Tổng quan hoặc Xét tốt nghiệp). Ở phần Bảng điểm của tôi, chọn chuyên ngành của bạn (sinh viên khóa 28 trở về trước chưa được chia chuyên ngành thì chọn Chưa có chuyên ngành), rồi chọn hoặc kéo thả tệp PDF vào vùng tải lên.",
      "- Tích ô xác nhận đây là bảng điểm của bạn và đồng ý để EduPath AI xử lý bảng điểm, rồi bấm Import bảng điểm (hoặc Cập nhật bảng điểm nếu đã có bản cũ).",
      "- Theo dõi thanh tiến trình. Đang chờ xử lý là PDF đã được nhận nhưng chưa bắt đầu đọc; Đang đọc bảng điểm là các dòng môn học đang được xử lý. Việc import chỉ xong khi có thông báo đã lưu và bảng môn học hiện bên dưới. Không cần tải lại cùng một tệp khi lần trước vẫn đang chạy; chọn nhầm tệp thì bấm Hủy xử lý.",
      "- Đối chiếu mã môn, tên môn, tín chỉ, điểm và kết quả từng học kỳ với PDF gốc, vì việc đọc tự động có thể nhầm.",
      "Mỗi tài khoản lưu một bảng điểm. Bản mới thay thế toàn bộ bản cũ sau khi đọc thành công, nên hãy dùng bản đầy đủ mọi học kỳ. Khi bảng điểm được thay hoặc bị xóa, các kết quả đánh giá năng lực tính từ bản cũ cũng bị xóa và bạn cần đánh giá lại.",
    ]],
    ["ket-qua-mon-hoc", "Ý nghĩa cột Kết quả trong chương trình và kế hoạch đào tạo", "#curriculum", [
      "Sau khi có bảng điểm, cột Kết quả trong Chương trình đào tạo và Kế hoạch đào tạo cho biết từng môn đã đạt hay chưa:",
      "- Dấu ✓ màu xanh: môn đã đạt theo bảng điểm bạn tải lên.",
      "- Dấu ✗ màu đỏ: môn đã có kết quả nhưng chưa đạt.",
      "- Ô trống hoặc dấu gạch (—): môn chưa có trong bảng điểm; điều này không có nghĩa là bạn đã học và trượt môn đó.",
      "Kết quả in trên bảng điểm luôn được dùng trước. Điểm chữ MT (miễn thi) được tính là đạt, kể cả khi không có điểm hệ 10 hay hệ 4. VT (vắng thi), CT (cấm thi) và DC là chưa đạt, không có điểm. Môn học nhiều lần chỉ cần một lần đạt hoặc được miễn thi là được đánh dấu đạt.",
      "Nếu ô Kết quả trong PDF để trống, EduPath AI suy ra kết quả từ điểm chữ: từ A+ đến D là đạt, F là chưa đạt.",
      "Nếu kết quả khác với dự kiến, hãy kiểm tra mã học phần và bảo đảm bảng điểm đã cập nhật đủ các học kỳ, gồm cả phần điểm bảo lưu.",
    ]],
    ["chuyen-nganh-nghe-muc-tieu", "Chọn chuyên ngành và vị trí nghề nghiệp mục tiêu", "#career", [
      "Chuyên ngành và vị trí nghề nghiệp mục tiêu quyết định học phần được xét, tiêu chuẩn xét tốt nghiệp và Khoảng trống kỹ năng của bạn.",
      "- Chuyên ngành: chọn khi import bảng điểm (bước 1 của khung import). Đã có bảng điểm thì bấm Đổi ở dòng Chuyên ngành trên thanh bảng điểm trong Hồ sơ và bảng điểm. Danh sách chỉ có các chuyên ngành của ngành và khóa của bạn; lựa chọn Chưa có chuyên ngành chỉ có ở khóa 28 trở về trước.",
      `- Các chuyên ngành theo ngành: ${specialtiesText()}.`,
      "- Vị trí nghề nghiệp mục tiêu (không bắt buộc): chọn ở trang Định hướng nghề nghiệp bằng nút Chọn làm vị trí nghề nghiệp mục tiêu; mục tiêu được lưu ngay. Muốn đổi, kể cả khi chưa có bảng điểm, bấm Đổi vị trí nghề nghiệp cạnh vị trí mục tiêu ở đầu trang rồi bấm Chọn làm mục tiêu ở vị trí mới. Chỉ trang Khoảng trống kỹ năng cần vị trí này; Xét tốt nghiệp và Đánh giá năng lực không cần.",
      "Sau khi đổi chuyên ngành, hãy bấm Đánh giá lại ở trang Đánh giá năng lực. Khi bạn chọn vị trí nghề nghiệp mục tiêu khác, EduPath AI tự đánh giá lại nếu bạn đã đánh giá trước đó, để Khoảng trống kỹ năng và Lộ trình học tập theo vị trí mới. Khóa và lớp lấy từ tài khoản trường, không sửa được trên EduPath AI.",
    ]],
    ["danh-gia-nang-luc", "Đánh giá năng lực", "#competency", [
      "Đánh giá năng lực tính điểm từng kỹ năng từ bảng điểm của bạn. Cần bảng điểm và chuyên ngành; vị trí nghề nghiệp mục tiêu không bắt buộc (chọn ở Định hướng nghề nghiệp để xem Khoảng trống kỹ năng).",
      "Các bước:",
      "- Chọn chuyên ngành và import bảng điểm PDF ở Hồ sơ và bảng điểm nếu chưa có.",
      "- Mở trang Đánh giá năng lực và bấm nút Đánh giá năng lực. Lần đầu, đọc phần giải thích về cách xử lý dữ liệu, tích ô đồng ý rồi xác nhận.",
      "Kết quả tính toán hiện ngay; nhận xét AI thường có sau khoảng 30 giây đến 1 phút. Trang có điểm tổng, điểm và mức theo nhóm năng lực, mức thành thạo từng kỹ năng, theo dõi năng lực theo học kỳ, tiến độ so với kế hoạch đào tạo và kết luận xét tốt nghiệp tham khảo.",
      "Khi đổi chuyên ngành hoặc thay bảng điểm, hãy bấm Đánh giá lại; khi bạn chọn vị trí nghề nghiệp mục tiêu khác, EduPath AI tự đánh giá lại nếu bạn đã đánh giá trước đó. Mỗi tài khoản giữ tối đa 20 lần đánh giá gần nhất. Nút Xóa kết quả đánh giá rút lại sự đồng ý và xóa toàn bộ kết quả cùng nhận xét AI (không khôi phục được); hồ sơ và bảng điểm vẫn được giữ.",
    ]],
    ["cach-tinh-diem-nang-luc", "Cách tính điểm và mức năng lực", "#competency", [
      "Mỗi học phần rèn luyện một số kỹ năng. Khoa cấu hình mức độ đó thành trọng số cho từng cặp học phần và kỹ năng; các trọng số của một học phần cộng lại là 100%.",
      "Điểm một kỹ năng là trung bình có trọng số của điểm các học phần liên quan bạn đã học, quy về thang 0–100 (điểm hệ 10 nhân 10): học phần càng nhiều tín chỉ và trọng số càng lớn thì ảnh hưởng càng nhiều. Môn học nhiều lần lấy lần đạt có điểm cao nhất; môn miễn thi (MT) được tính là đã học nhưng không đưa vào điểm trung bình.",
      `Mức theo ngưỡng xếp loại trên bảng điểm (điểm hệ 4 nhân 25): ${levelScale()}.`,
      "Điểm nhóm năng lực gộp các kỹ năng trong nhóm, điểm tổng gộp mọi kỹ năng theo cùng cách; Giáo dục thể chất và Giáo dục quốc phòng không tính vào hai điểm này.",
      "Kỹ năng chưa có điểm được ghi: Sắp học (học phần liên quan đang học hoặc có trong kế hoạch sau học kỳ đang học), Chưa học (không có học phần liên quan nào đang học hay sắp học theo kế hoạch), Chưa có điểm (đã học nhưng bảng điểm không có điểm số). Các trường hợp này không có nghĩa là bạn yếu kỹ năng đó.",
      "Mọi con số do hệ thống tính; AI chỉ viết nhận xét để bạn tham khảo.",
    ]],
    ["khoang-trong-ky-nang", "Đọc trang Khoảng trống kỹ năng", "#skill-gap", [
      "Khoảng trống kỹ năng so năng lực của bạn với yêu cầu của vị trí nghề nghiệp mục tiêu, từ lần Đánh giá năng lực mới nhất. Chưa chọn vị trí thì trang hiện nút Mở Định hướng nghề nghiệp để chọn. Nút Đổi (chưa chọn: Chọn) cạnh Vị trí nghề nghiệp mục tiêu ở đầu trang mở hộp chọn vị trí ngay trên trang, kèm điểm phù hợp kỹ năng của từng vị trí.",
      `- Mỗi kỹ năng của vị trí nghề nghiệp là Bắt buộc hoặc Ưu tiên: ${careerThresholds()}.`,
      "- Trạng thái từng kỹ năng: Đạt ngưỡng; Dưới ngưỡng · thiếu N điểm; Chưa học; Sắp học (kèm học kỳ); Cần tự học (chỉ học phần của chuyên ngành khác hoặc học phần tự chọn bạn không chọn mới rèn luyện kỹ năng này); Chưa đủ dữ liệu (chương trình đào tạo chưa có học phần nào đo kỹ năng này). Kỹ năng còn thiếu là kỹ năng dưới ngưỡng, chưa học, cần tự học hoặc chưa đủ dữ liệu.",
      `- Điểm phù hợp (0–100) là trung bình điểm các kỹ năng của vị trí nghề nghiệp, kỹ năng Bắt buộc tính gấp đôi; kỹ năng chưa có điểm, kể cả Sắp học, tính 0. Mức phù hợp: Rất phù hợp từ ${formatNumber(LEVEL_THRESHOLDS.excellent)}, Phù hợp từ ${formatNumber(LEVEL_THRESHOLDS.proficient)}, Trung bình từ ${formatNumber(LEVEL_THRESHOLDS.good)}, Ít phù hợp từ ${formatNumber(LEVEL_THRESHOLDS.basic)}, Không phù hợp dưới ${formatNumber(LEVEL_THRESHOLDS.basic)}.`,
      "- Trang còn có học phần nên ưu tiên (kèm tình trạng của bạn và điều kiện đăng ký), học phần nên học cải thiện, kỹ năng cần tự học, theo dõi mức cải thiện từng kỹ năng qua các học kỳ và nhận xét AI để tham khảo.",
    ]],
    ["dinh-huong-nghe-nghiep", "Định hướng nghề nghiệp", "#career", [
      "Trang Định hướng nghề nghiệp tính điểm phù hợp kỹ năng (thang 100) của bạn với mọi vị trí nghề nghiệp trong danh mục, cùng cách tính với Khoảng trống kỹ năng, từ bảng điểm hiện tại; trang này không dùng AI.",
      "- Vị trí nghề nghiệp phù hợp với năng lực hiện tại: sắp xếp theo điểm phù hợp giảm dần; vị trí đứng đầu kèm lý do và nút Chọn làm vị trí nghề nghiệp mục tiêu.",
      "- Các lựa chọn khác: Theo bảng xếp hạng (các vị trí tiếp theo) và Vị trí nghề nghiệp phù hợp với sở thích và thế mạnh (khớp Lĩnh vực quan tâm nhất xếp trước, rồi khớp nhiều Thế mạnh của bạn hơn trong Khảo sát nhanh).",
      "- Đánh giá điểm phù hợp kỹ năng với tất cả vị trí nghề nghiệp: điểm giảm dần; lọc theo lĩnh vực, tìm theo tên; mỗi vị trí có nút Chọn làm mục tiêu. Nút Đổi vị trí nghề nghiệp ở đầu trang mở danh sách này.",
      "- Xem chi tiết: mô tả, từng yêu cầu kỹ năng (Bắt buộc hoặc Ưu tiên) và mức hiện tại của bạn.",
      "- So sánh: bấm + So sánh ở 2 hoặc 3 vị trí, rồi bấm Xem so sánh trên thanh So sánh ở cuối màn hình.",
      "- Chọn làm vị trí nghề nghiệp mục tiêu (không bắt buộc): lưu ngay; nếu bạn đã đánh giá năng lực, EduPath AI tự đánh giá lại để Khoảng trống kỹ năng và Lộ trình học tập theo vị trí mới.",
      "- Khảo sát nhanh (5 câu, không bắt buộc) nằm ngay trên trang này.",
      "Khi chưa tính được (chưa có bảng điểm, chưa chọn chuyên ngành…), bạn vẫn xem được danh mục và yêu cầu của từng vị trí. Sau khi bạn bấm Xóa kết quả đánh giá ở trang Đánh giá năng lực (rút lại sự đồng ý), trang này thôi tính cho đến khi bạn đánh giá lại.",
    ]],
    ["khao-sat-dinh-huong", "Khảo sát nhanh", "#career", [
      "Khảo sát nhanh (trước đây là Khảo sát định hướng) nằm ở trang Định hướng nghề nghiệp và không bắt buộc. Bảng điểm cho biết bạn đã học gì; khảo sát cho EduPath AI biết thêm bạn muốn đi đâu, để trang Định hướng nghề nghiệp gợi ý thêm vị trí hợp với sở thích, thế mạnh và Lộ trình AI đưa ra lời khuyên sát với bạn.",
      "Khảo sát có 5 câu: Lĩnh vực quan tâm nhất, Thế mạnh của bạn (chọn 1 đến 5 công nghệ bạn thành thạo), Mục tiêu sau tốt nghiệp, Thời gian tự học mỗi tuần và Tiếng Anh chuyên ngành; mất khoảng 1 phút.",
      "Khi lưu, bạn tích ô đồng ý để EduPath AI dùng câu trả lời cho việc tư vấn lộ trình học tập bằng AI. Không làm khảo sát, bạn vẫn dùng được mọi trang, kể cả tạo Lộ trình AI.",
      "Sửa câu trả lời bằng Chỉnh sửa khảo sát. Xóa câu trả lời xóa toàn bộ câu trả lời và các lộ trình AI đã tạo.",
    ]],
    ["lo-trinh-ai", "Lộ trình AI đề xuất", "#roadmap", [
      "Tab Lộ trình AI đề xuất trong trang Lộ trình học tập: EduPath AI soạn lộ trình cho học kỳ tới như một cố vấn học tập. Cần có kết quả Đánh giá năng lực; có Khảo sát nhanh thì lộ trình sát với bạn hơn.",
      "Lộ trình gồm Lời khuyên của cố vấn AI, Môn bạn cần học, Môn học bạn cần học lại và cải thiện (học lại: học phần chưa đạt F, VT, CT, DC; học cải thiện: học phần đã đạt điểm D, D+ nếu bạn muốn nâng điểm), Kỹ năng, kiến thức nên bổ sung (vì sao cần, cách học) và Kế hoạch theo từng tháng của học kỳ. Danh sách học phần và kỹ năng do hệ thống tính từ kết quả đánh giá mới nhất; AI chọn ưu tiên và viết lời khuyên. Các học phần AI chọn được thêm vào Kế hoạch học kỳ một lần để bạn tự điều chỉnh.",
      `Lịch học kỳ dự kiến mà lộ trình dùng: ${termCalendarText()}.`,
      "Bấm Tạo lộ trình, hoặc Tạo lại khi kết quả đánh giá đã đổi hay lộ trình đã hết thời gian. Mỗi tài khoản giữ tối đa 5 lộ trình gần nhất; lộ trình bị xóa cùng kết quả đánh giá tạo ra nó.",
      "Lộ trình chỉ để tham khảo: hãy trao đổi với cố vấn học tập và xem lịch đăng ký học phần của trường trước khi đăng ký.",
    ]],
    ["ke-hoach-hoc-ky", "Theo dõi tiến độ và Kế hoạch học kỳ", "#roadmap", [
      "Trang Lộ trình học tập có ba tab: Theo dõi tiến độ, Lộ trình AI đề xuất và Kế hoạch học kỳ.",
      "- Theo dõi tiến độ: chương trình, điểm trung bình tích lũy, học kỳ đang học, thanh tiến độ tín chỉ (đã hoàn thành, đang học, đã lên kế hoạch, còn thiếu) và các nhóm yêu cầu của chương trình theo tiêu chuẩn xét tốt nghiệp, với từng học phần. Chế độ Chính thức chỉ tính học phần đã có kết quả và đang học; chế độ Theo kế hoạch tính thêm các học phần trong kế hoạch của bạn. Ý nghĩa các ký hiệu được giải thích ngay trên trang.",
      "- Kế hoạch học kỳ: các học kỳ từ học kỳ hiện tại; kéo thả hoặc bấm Thêm để đưa học phần từ Danh sách chờ (học phần còn thiếu theo nhóm) hay Tìm học phần vào một học kỳ, chuyển học kỳ hoặc bỏ khỏi kế hoạch. Trang cảnh báo khi chưa đạt môn tiên quyết, chưa học môn học trước, kế hoạch đào tạo không mở môn trong học kỳ đó, hoặc số tín chỉ của học kỳ quá nhiều hay quá ít. Kế hoạch tự lưu sau mỗi lần sửa.",
      "- Lần đầu, kế hoạch được điền sẵn các học phần bắt buộc còn phải học theo kế hoạch đào tạo của khóa (học phần đã trễ kế hoạch không được điền); khi có Lộ trình AI mới, các học phần AI chọn được thêm vào.",
    ]],
    ["xet-tot-nghiep", "Xét tốt nghiệp", "#graduation", [
      "Trang Xét tốt nghiệp đối chiếu bảng điểm của bạn với tiêu chuẩn xét tốt nghiệp của khóa (trong tài khoản) và chuyên ngành bạn chọn, được chọn tự động. Trang chỉ cần bảng điểm và chuyên ngành; khi chưa có bảng điểm, bạn chọn chuyên ngành và import ngay trên trang này. Hãy dùng bảng điểm đầy đủ mọi học kỳ.",
      "- Tiêu chuẩn gồm số tín chỉ tích lũy tối thiểu, điểm trung bình tích lũy tối thiểu và các nhóm môn. Nhóm bắt buộc cần đạt toàn bộ các môn được liệt kê; mỗi nhóm tự chọn cần đủ số tín chỉ yêu cầu, không cần học tất cả các môn trong nhóm.",
      "- Môn có dấu (*) là môn điều kiện: vẫn phải đạt nếu nằm trong nhóm bắt buộc nhưng không tính vào tín chỉ tích lũy và điểm trung bình (ví dụ các môn Giáo dục quốc phòng). Ở nhóm tự chọn, môn (*) vẫn giúp hoàn thành yêu cầu của nhóm.",
      "- Dòng Đã đạt và Yêu cầu ở đầu mỗi nhóm cho biết bạn còn thiếu bao nhiêu.",
      "- Môn bắt buộc hoặc tự chọn của chuyên ngành khác mà bạn đã đạt được tính vào nhóm tự chọn chuyên ngành của bạn, có ghi rõ trong nhóm đó.",
      "- Lời khuyên từ EduPath AI được tạo tự động sau khi có bảng điểm và gợi ý cách hoàn thành các điều kiện còn thiếu; kết luận và danh sách Đề xuất điều cần làm do hệ thống tính.",
      "Thông báo trên trang chỉ để bạn tự đối chiếu; kết quả xét tốt nghiệp chính thức do nhà trường công bố. Hãy liên hệ cố vấn học tập để xác nhận trường hợp cụ thể.",
    ]],
    ["chuong-trinh-ke-hoach-dao-tao", "Chương trình đào tạo và Kế hoạch đào tạo", "#curriculum", [
      "Chương trình đào tạo (CTĐT) và Kế hoạch đào tạo (KHĐT) nằm trong menu tài khoản.",
      "- CTĐT là khung chương trình của ngành và khóa: các khối kiến thức, học phần bắt buộc (BB) và tự chọn theo nhóm (TC…), số tín chỉ, chuyên ngành, năm và học kỳ dự kiến, môn tiên quyết và môn học trước. Trang chỉ hiện CTĐT của khóa và ngành trong hồ sơ của bạn, như trang Xét tốt nghiệp (không chọn CTĐT khác); bạn tìm học phần theo mã hoặc tên và lọc theo khối kiến thức, loại môn, chuyên ngành, năm học, học kỳ.",
      "- KHĐT là kế hoạch giảng dạy theo từng học kỳ (mã HK251 là học kỳ 1 năm học 2025–2026) của khóa và ngành trong hồ sơ của bạn: học phần, tín chỉ, loại môn, nhóm lựa chọn và chuyên ngành; khóa và ngành chưa có KHĐT xem kế hoạch dựng từ năm học, học kỳ dự kiến trong CTĐT. Đây là kế hoạch giảng dạy, không phải đăng ký học phần của bạn; hãy xem thêm lịch đăng ký học phần của trường.",
      "- Nhóm tự chọn chỉ cần đủ số tín chỉ yêu cầu, không cần học tất cả các môn trong danh sách.",
      "- Sau khi có bảng điểm, cột Kết quả đánh dấu môn đã đạt (✓) hoặc chưa đạt (✗).",
    ]],
    ["tro-ly-ai", "Trợ lý AI", "#assistant", [
      "Trợ lý AI trả lời câu hỏi về việc học của chính bạn: điểm trong bảng điểm (điểm từng môn, điểm trung bình tích lũy, tín chỉ tích lũy, môn chưa đạt), kết quả năng lực và khoảng trống kỹ năng, học phần nên học và lý do, lộ trình, tiến độ, điều kiện tốt nghiệp, nghề nghiệp và tài liệu tự học.",
      "- Dữ liệu để trả lời: bảng điểm bạn đã tải lên (chép đúng như in, không tính lại), kết quả hệ thống đã tính cho bạn (Đánh giá năng lực và Lộ trình AI mới nhất, tiến độ so với kế hoạch; Khảo sát nhanh khi bạn đã làm và đồng ý) và danh mục chung của Khoa (học phần, kỹ năng, nghề nghiệp, chương trình và kế hoạch đào tạo, tiêu chuẩn xét tốt nghiệp, hướng dẫn sử dụng, tài liệu tự học do EduPath AI tuyển chọn).",
      "- Mỗi ý trong câu trả lời ghi số nguồn như [1], [2]; bấm nguồn để mở trang liên quan. Đường link chỉ dẫn tới tài liệu tự học có trong danh sách.",
      "- Mọi con số do hệ thống tính, trợ lý không tự tính điểm. Câu trả lời do AI viết nên có thể chưa chính xác; hãy đối chiếu với số liệu trên trang và hỏi cố vấn học tập trước khi đăng ký học phần.",
      `- Câu hỏi cần kết quả bạn chưa có (bảng điểm, Đánh giá năng lực, Lộ trình AI) được trả lời ngay là chưa có cơ sở để tư vấn, kèm các bước cần làm. Câu hỏi gợi ý phía trên ô nhập theo những gì bạn đã làm; bấm để gửi. Mỗi câu hỏi tối đa ${formatNumber(MAX_QUESTION_CHARS)} ký tự; trong một cuộc trò chuyện, trợ lý trả lời lần lượt từng câu.`,
      `- Cuộc trò chuyện được lưu cùng tài khoản của bạn; bạn có thể xóa, và cuộc trò chuyện không có tin nhắn mới trong ${CONVERSATION_RETENTION_DAYS} ngày sẽ tự bị xóa.`,
    ]],
    ["ai-va-du-lieu", "EduPath AI dùng AI vào việc gì", "#assistant", [
      "EduPath AI dùng mô hình ngôn ngữ Gemma 4 26B chạy trên Cloudflare Workers AI: nhận xét học tập trong Đánh giá năng lực, Lộ trình AI cho học kỳ tới trong Lộ trình học tập và Lời khuyên từ EduPath AI trong Xét tốt nghiệp. Trợ lý AI cũng dùng mô hình này.",
      "- Mọi con số như điểm kỹ năng, mức năng lực, khoảng trống kỹ năng, mức phù hợp với vị trí nghề nghiệp và kết quả đối chiếu xét tốt nghiệp đều do hệ thống tính theo trọng số học phần Khoa cấu hình; AI chỉ diễn giải và viết lời khuyên.",
      "- Để viết nhận xét, mô hình chỉ nhận mã và tên học phần theo chương trình đào tạo, điểm của bạn ở các học phần đó, khóa, chuyên ngành, vị trí nghề nghiệp mục tiêu (nếu có) và các kết quả hệ thống đã tính. Lộ trình AI nhận thêm câu trả lời Khảo sát nhanh nếu bạn đã làm.",
      "- Mô hình không nhận họ tên, mã số sinh viên, email, lớp hay tệp PDF bảng điểm; Cloudflare không lưu dữ liệu sau khi xử lý xong và không dùng dữ liệu để huấn luyện mô hình AI.",
      "- Nhận xét, lộ trình và lời khuyên do AI viết chỉ để tham khảo và có thể chưa chính xác; hãy đối chiếu với số liệu trên trang và trao đổi với giảng viên hoặc cố vấn học tập trước khi quyết định.",
    ]],
    ["quyen-rieng-tu", "Tóm tắt quyền riêng tư", "#profile", [
      "Tóm tắt Chính sách bảo mật của EduPath AI (bản đầy đủ ở liên kết Chính sách & Điều khoản cuối trang):",
      "- Bạn đăng nhập bằng tài khoản Microsoft của trường; EduPath AI không biết và không lưu mật khẩu của bạn.",
      "- Bạn xem được toàn bộ thông tin của mình; sinh viên khác không xem được hồ sơ, bảng điểm, kết quả đánh giá năng lực, khảo sát hay lộ trình của bạn. Quản trị viên của Khoa Công nghệ Thông tin xem được điểm và kết quả từng môn trong bảng điểm ở trang quản trị (không gồm tệp PDF), và từ 31/10/2026 xem được tiến độ, kết quả đánh giá năng lực và các môn Lộ trình AI đề xuất của bạn trong báo cáo của Khoa; các báo cáo này không có câu trả lời khảo sát của bạn.",
      "- Cố vấn học tập của lớp bạn, quản trị viên và Ban chủ nhiệm khoa mở được trang của bạn; mỗi lần đều được ghi nhật ký và báo cho bạn.",
      "- Chuyên ngành, vị trí nghề nghiệp mục tiêu, Khảo sát nhanh và bảng điểm do bạn tự cung cấp và có thể sửa hoặc xóa bất cứ lúc nào. Đánh giá năng lực và Khảo sát nhanh cần sự đồng ý riêng.",
      "- Mô hình AI (Cloudflare Workers AI) không nhận họ tên, MSSV, email, lớp hay tệp PDF; Cloudflare không lưu và không dùng để huấn luyện. Bản scan chỉ gửi ảnh phần bảng điểm.",
      "- EduPath AI không bán dữ liệu, không quảng cáo, không theo dõi bạn trên trang khác. Dữ liệu lưu trên dịch vụ đám mây, máy chủ có thể ở ngoài Việt Nam.",
      `- Muốn sửa thông tin định danh, nhận bản sao dữ liệu hoặc xóa tài khoản, hãy gửi email từ email trường đến ${SUPPORT_EMAIL}.`,
    ]],
    ["co-van-va-can-bo-khoa", "Cố vấn học tập và cán bộ Khoa xem và làm thay được gì", "#profile", [
      "Cố vấn học tập được Khoa phân công cho lớp của bạn, quản trị viên của Khoa và Ban chủ nhiệm khoa mở được trang EduPath AI của bạn: hồ sơ, bảng điểm (kể cả tệp PDF), Khảo sát nhanh, đánh giá năng lực, khoảng trống kỹ năng, định hướng nghề nghiệp, lộ trình, kế hoạch học kỳ và xét tốt nghiệp.",
      "- Họ có thể làm thay bạn: import bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, sửa kế hoạch học kỳ, làm Khảo sát nhanh, chạy đánh giá năng lực và tạo lại nhận xét AI, tạo Lộ trình AI, tạo lại lời khuyên xét tốt nghiệp và hỏi Trợ lý AI; cuộc trò chuyện đó được ghi là do cố vấn học tập hay cán bộ Khoa tạo và bạn xem được.",
      "- Khảo sát họ làm thay được dùng cho các chức năng AI của bạn như khảo sát bạn tự làm, cho đến khi bạn sửa lại hoặc rút đồng ý.",
      "- Họ không đồng ý hay rút đồng ý thay bạn, không xóa dữ liệu, và không xem thông báo trong chuông cũng như các cuộc trò chuyện Trợ lý AI do bạn tạo.",
      "- Mỗi lần mở trang của bạn và mỗi việc làm thay đều được ghi vào nhật ký thao tác, và bạn nhận một thông báo trong chuông khi có người làm thay bạn. Khi Khoa đổi phân công lớp, cố vấn cũ không còn xem được trang của bạn.",
      "- Trước khi bạn đăng nhập lần đầu, họ có thể nhập trước danh sách lớp (mã sinh viên, họ và tên, lớp, email trường); khi đó bạn chỉ có tên trong danh sách, không ai làm thay hay chạy AI cho bạn. Lần đăng nhập đầu tiên, tài khoản của bạn được ghép với tên đó theo mã sinh viên.",
    ]],
    ["luu-va-xoa-du-lieu", "Lưu giữ và xóa dữ liệu", "#profile", [
      "- Bảng điểm: mỗi tài khoản một bảng điểm, giữ đến khi bạn thay bằng bản mới, bấm Xóa bảng điểm hoặc tài khoản bị xóa. Xóa bảng điểm xóa tệp PDF, dữ liệu môn học đã import và các kết quả đánh giá năng lực; thông tin cá nhân vẫn được giữ. Bảng điểm đã xóa không khôi phục được, hãy tự giữ bản PDF gốc.",
      "- Kết quả đánh giá năng lực và nhận xét AI: tối đa 20 lần gần nhất; bị xóa khi bạn thay hoặc xóa bảng điểm, hoặc khi bấm Xóa kết quả đánh giá ở trang Đánh giá năng lực (rút lại sự đồng ý).",
      "- Khảo sát nhanh: giữ đến khi bạn bấm Xóa câu trả lời ở Định hướng nghề nghiệp; các lộ trình AI cũng bị xóa theo.",
      "- Lộ trình AI: tối đa 5 lộ trình gần nhất, bị xóa cùng kết quả đánh giá tạo ra nó. Kế hoạch học kỳ: giữ đến khi bạn xóa.",
      "- Dữ liệu gửi cho mô hình AI được xóa sau khi xử lý xong.",
      `- Khi không còn dùng EduPath AI, chẳng hạn sau khi tốt nghiệp, bạn có thể tự xóa bảng điểm và gửi email đến ${SUPPORT_EMAIL} để đề nghị xóa tài khoản.`,
    ]],
    ["ho-tro", "Hỗ trợ, góp ý và báo lỗi", "#overview", [
      `- Góp ý hoặc báo lỗi: gửi email đến ${SUPPORT_EMAIL} từ email trường, mô tả ngắn chức năng bạn đang dùng, các bước đã làm và thông báo lỗi hiển thị trên màn hình. Nếu gửi kèm ảnh chụp màn hình, hãy che thông tin không cần thiết và không chụp thông tin của người khác.`,
      "- Đăng nhập: dùng tài khoản Microsoft do trường cấp (với sinh viên là email @vanlanguni.vn). Phiên đăng nhập tự kết thúc sau một thời gian không sử dụng; khi đó chỉ cần đăng nhập lại. Thông báo trang này dành riêng cho sinh viên nghĩa là bạn vừa dùng tài khoản không phải tài khoản sinh viên.",
      "- EduPath AI là trang web, dùng được trên máy tính và điện thoại; các bảng dài dễ xem hơn trên máy tính. Dùng máy chung thì nhớ bấm Đăng xuất.",
      "- Câu hỏi thường gặp và Chính sách & Điều khoản nằm ở cuối trang; nút ? trên thanh trên cùng có hướng dẫn nhanh từng trang.",
    ]],
  ];
  return guides.map(([key, title, link, lines]) => ({ key, title, link, content: lines.join("\n") }));
}
