// "Sở thích" of the profile as choices (user 2026-10-24: "làm dạng các công nghệ, sở thích khi rảnh ... để tránh việc sv
// bỏ trống hoặc nhập bừa"): 1 to 5 of each list. The ids must match apps/api/src/student/interests.ts (checked there).

export const INTEREST_MAX = 5;
export type InterestOption = { id: string; label: string };

export const INTEREST_TECH: InterestOption[] = [
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
];

export const INTEREST_HOBBIES: InterestOption[] = [
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
];

/** The labels of the chosen ids, in list order; unknown ids are left out. */
export const interestLabels = (options: InterestOption[], ids: readonly string[] | null | undefined) =>
  options.filter((option) => ids?.includes(option.id)).map((option) => option.label);

/** A list with the option added or removed; never more than INTEREST_MAX. */
export function toggleInterest(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length >= INTEREST_MAX ? [...ids] : [...ids, id];
}

/** Both lists have at least one choice (the profile's "Sở thích cá nhân" item). */
export const hasInterests = (profile: { interestTech?: readonly string[] | null; interestHobbies?: readonly string[] | null } | null) =>
  Boolean(profile?.interestTech?.length && profile?.interestHobbies?.length);

/** The Vietnamese message of a list still empty, or "". */
export const interestProblem = (kind: "tech" | "hobbies", ids: readonly string[]) =>
  ids.length ? "" : kind === "tech" ? "Vui lòng chọn ít nhất một công nghệ bạn thích." : "Vui lòng chọn ít nhất một sở thích khi rảnh.";
