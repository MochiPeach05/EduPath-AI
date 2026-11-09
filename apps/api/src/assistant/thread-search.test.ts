import { describe, expect, it, vi } from "vitest";
import { foldWithMap, plainMessage, searchSnippet, searchThreads, searchWords } from "./thread-search.js";

// Tìm cuộc trò chuyện (2026-11-09). Synthetic conversations only.
const studentId = "11111111-1111-4111-8111-111111111111";
const advisorId = "88888888-8888-4888-8888-888888888888";
const at = (iso: string) => new Date(iso);
const threads = [
  { id: "t-new", title: "Điều kiện xét tốt nghiệp của khóa mình là gì?", createdAt: at("2026-11-08T02:00:00Z"), updatedAt: at("2026-11-08T02:05:00Z"), createdBy: null, createdByRole: null },
  { id: "t-mid", title: "Học kỳ tới mình nên học những môn nào?", createdAt: at("2026-11-05T02:00:00Z"), updatedAt: at("2026-11-05T02:05:00Z"), createdBy: null, createdByRole: null },
  { id: "t-old", title: "Mình nên tự học kỹ năng còn thiếu ở đâu?", createdAt: at("2026-10-30T02:00:00Z"), updatedAt: at("2026-10-30T02:05:00Z"), createdBy: null, createdByRole: null },
];
// As the SQL returns them: newest first.
const messages = [
  { threadId: "t-new", content: "Bạn cần đủ **132 tín chỉ** và chuẩn đầu ra tiếng Anh [1]." },
  { threadId: "t-new", content: "Điều kiện xét tốt nghiệp của khóa mình là gì?" },
  { threadId: "t-mid", content: "Học kỳ tới bạn nên học:\n- **Cơ sở dữ liệu nâng cao** [2]\n- Kiểm thử phần mềm [3]" },
  { threadId: "t-mid", content: "Học kỳ tới mình nên học những môn nào?" },
  { threadId: "t-old", content: "Bạn có thể tự học SQL ở https://example.edu/sql [1] và luyện thêm phần cơ sở dữ liệu." },
  { threadId: "t-old", content: "Mình nên tự học kỹ năng còn thiếu ở đâu?" },
];

function fakeDb() {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("FROM stu_chat_threads") ? threads : sql.includes("FROM stu_chat_messages") ? messages : [],
  }));
  return { query } as unknown as Parameters<typeof searchThreads>[0] & { query: typeof query };
}

describe("Tìm cuộc trò chuyện", () => {
  it("compares words without accents or case, each once, and needs at least two letters", () => {
    expect(searchWords("  Điều KIỆN  điều kiện, tốt-nghiệp?")).toEqual(["dieu", "kien", "tot-nghiep"]);
    expect(searchWords("a")).toEqual([]);
    expect(searchWords("? !")).toEqual([]);
    expect(searchWords("ĐỒ ÁN")).toEqual(["do", "an"]);
    const { folded, at: from } = foldWithMap("Xét Điều");
    expect(folded).toBe("xet dieu");
    expect(from[4]).toBe(4);
    expect(from.at(-1)).toBe("Xét Điều".length);
  });

  it("reads a message as plain text and shows the piece around the first match, cut at spaces", () => {
    expect(plainMessage("Bạn cần:\n- **Cơ sở dữ liệu** [2]\n1. Kiểm thử [3]")).toBe("Bạn cần: Cơ sở dữ liệu Kiểm thử");
    const text = `${"Mở đầu dài dòng ".repeat(12)}cần học Cơ sở dữ liệu nâng cao ${"rồi phần sau còn dài ".repeat(12)}`.trim();
    const piece = searchSnippet(text, ["co", "so", "du", "lieu"], 80);
    expect(piece.startsWith("…")).toBe(true);
    expect(piece.endsWith("…")).toBe(true);
    expect(piece).toContain("Cơ sở dữ liệu");
    expect(piece.length).toBeLessThanOrEqual(82);
    expect(searchSnippet("Ngắn gọn thôi", ["gon"])).toBe("Ngắn gọn thôi");
  });

  it("finds conversations by their title or any message, every word somewhere in it, newest first", async () => {
    const db = fakeDb();
    // Every word in the title: no piece of a message.
    expect(await searchThreads(db, studentId, "dieu kien tot nghiep")).toEqual([{ thread: threads[0], snippet: null }]);
    // Only in the messages, accents typed or not: the piece of the message that holds them.
    const found = await searchThreads(db, studentId, "co so du lieu");
    expect(found.map((result) => result.thread.id)).toEqual(["t-mid", "t-old"]);
    expect(found[0]!.snippet).toBe("Học kỳ tới bạn nên học: Cơ sở dữ liệu nâng cao Kiểm thử phần mềm");
    expect(found[1]!.snippet).toContain("cơ sở dữ liệu");
    // Words split between the title and an answer still find it; a word nowhere finds nothing.
    expect((await searchThreads(db, studentId, "tốt nghiệp 132")).map((result) => result.thread.id)).toEqual(["t-new"]);
    expect(await searchThreads(db, studentId, "đồ án")).toEqual([]);
    // Too short to look for: no query at all.
    db.query.mockClear();
    expect(await searchThreads(db, studentId, "a")).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("searches what the list shows: an advisor only the conversations they started, the student's own messages only", async () => {
    const db = fakeDb();
    await searchThreads(db, studentId, "sql", advisorId);
    const [threadsSql, threadsParams] = db.query.mock.calls[0]!;
    expect(threadsSql).toContain("FROM stu_chat_threads");
    expect(threadsParams).toContain(advisorId);
    const [messagesSql, messagesParams] = db.query.mock.calls[1]! as unknown as [string, unknown[]];
    expect(messagesSql).toContain("user_id=$1");
    expect(messagesSql).toContain("role='user' OR status='completed'");
    expect(messagesParams[0]).toBe(studentId);
    expect(messagesParams[1]).toEqual(["t-new", "t-mid", "t-old"]);
  });
});
