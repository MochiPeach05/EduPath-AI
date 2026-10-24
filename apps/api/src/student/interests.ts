import { z } from "zod";

// "Công nghệ bạn thích" and "Sở thích khi rảnh" (user 2026-10-24: "làm dạng các công nghệ, sở thích khi rảnh ... để tránh
// việc sv bỏ trống hoặc nhập bừa"): 1 to 5 of each. First kept in the profile (migration 049), then moved into the profile
// survey ("áp dụng vào Khảo sát định hướng luôn", migration 050) so the AI study roadmap reads them (policy 2026-10-25).
// The survey page renders the options GET /api/student/survey sends.

export const INTEREST_MAX = 5;
type InterestOption = { id: string; label: string };

export const INTEREST_TECH = [
  { id: "web_frontend", label: "Web front-end (HTML, CSS, JavaScript, React)" },
  { id: "web_backend", label: "Web back-end (Node.js, Java, .NET, PHP)" },
  { id: "mobile", label: "Ứng dụng di động (Android, iOS, Flutter)" },
  { id: "python_data", label: "Python, phân tích dữ liệu" },
  { id: "ai_ml", label: "Trí tuệ nhân tạo, học máy" },
  { id: "database", label: "Cơ sở dữ liệu (SQL, NoSQL)" },
  { id: "cloud_devops", label: "Cloud, DevOps (Docker, AWS)" },
  { id: "security", label: "An ninh mạng" },
  { id: "networking", label: "Mạng máy tính" },
  { id: "game", label: "Phát triển game (Unity, Unreal)" },
  { id: "embedded_iot", label: "Nhúng, IoT" },
  { id: "uiux", label: "Thiết kế UI/UX" },
  { id: "testing", label: "Kiểm thử phần mềm" },
  { id: "blockchain", label: "Blockchain" },
] as const satisfies readonly InterestOption[];

export const INTEREST_HOBBIES = [
  { id: "side_projects", label: "Tự làm dự án, viết code" },
  { id: "reading", label: "Đọc sách, tài liệu" },
  { id: "online_courses", label: "Học khóa học trực tuyến" },
  { id: "coding_contests", label: "Thi lập trình, giải thuật" },
  { id: "gaming", label: "Chơi game" },
  { id: "sports", label: "Thể thao, vận động" },
  { id: "music", label: "Âm nhạc" },
  { id: "art_design", label: "Vẽ, thiết kế, chụp ảnh" },
  { id: "content", label: "Viết blog, làm nội dung" },
  { id: "clubs_volunteer", label: "Câu lạc bộ, tình nguyện" },
  { id: "travel", label: "Du lịch, khám phá" },
  { id: "languages", label: "Học ngoại ngữ" },
] as const satisfies readonly InterestOption[];

const ids = (options: readonly InterestOption[]) => options.map((option) => option.id) as [string, ...string[]];
export const INTEREST_TECH_IDS = ids(INTEREST_TECH);
export const INTEREST_HOBBY_IDS = ids(INTEREST_HOBBIES);

/** 1 to INTEREST_MAX different options of the list. */
export const interestChoices = (allowed: [string, ...string[]]) =>
  z.array(z.enum(allowed)).min(1).max(INTEREST_MAX).refine((list) => new Set(list).size === list.length);

/** The labels of the chosen ids, in list order. */
export const interestLabels = (options: readonly InterestOption[], chosen: readonly string[]) =>
  options.filter((option) => chosen.includes(option.id)).map((option) => option.label);

/** PATCH /api/student/profile still takes both lists (pages loaded before the move): they only prefill the survey. */
export const interestFields = {
  interestTech: interestChoices(INTEREST_TECH_IDS).optional(),
  interestHobbies: interestChoices(INTEREST_HOBBY_IDS).optional(),
};
export const bothOrNeither = (input: { interestTech?: unknown; interestHobbies?: unknown }) =>
  (input.interestTech === undefined) === (input.interestHobbies === undefined);
