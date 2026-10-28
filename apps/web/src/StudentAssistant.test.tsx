import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentAssistant, {
  ANSWER_POLL_MS, AssistantView, DeleteConfirm, OFFLINE_NOTICE, STARTER_QUESTIONS, assistantApi, assistantErrorMessage, newestFirst, threadTimeLabel, watchAnswer,
  type AssistantViewProps,
} from "./StudentAssistant";
import type { AssistantMessage, AssistantThread } from "./assistant-types";

// Synthetic conversations only (no student data).
const now = new Date("2026-10-28T05:00:00.000Z"); // 12:00 in Vietnam
const thread = (id: string, title: string, updatedAt: string): AssistantThread => ({ id, title, createdAt: updatedAt, updatedAt });
const threads = [
  thread("t1", "Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?", "2026-10-28T02:40:00.000Z"),
  thread("t2", "Học kỳ tới mình nên học những môn nào?", "2026-10-27T03:00:00.000Z"),
];
const message = (id: string, role: AssistantMessage["role"], content: string, extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id, threadId: "t1", role, content, status: "completed", errorCode: null, sources: [], feedback: null,
  createdAt: "2026-10-28T02:40:00.000Z", completedAt: role === "assistant" ? "2026-10-28T02:40:30.000Z" : null, ...extra,
});
const question = message("q1", "user", "Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?");
const answer = message("a1", "assistant", "So với nghề mục tiêu, bạn còn thiếu [1]:\n- **Kiểm thử phần mềm** [2]\n- Điện toán đám mây, tự học ở https://example.edu/cloud [3]", {
  sources: [
    { n: 1, kind: "assessment", title: "Kết quả Đánh giá năng lực", link: "#competency" },
    { n: 2, kind: "skill", title: "Khoảng trống kỹ năng", link: "#skill-gap" },
    { n: 3, kind: "resource", title: "Khóa học điện toán đám mây", link: "https://example.edu/cloud" },
    { n: 4, kind: "guide", title: "Quy chế đào tạo", link: null },
  ],
  feedback: 1,
});

const view = (props: Partial<AssistantViewProps> = {}) => renderToStaticMarkup(<AssistantView
  threads={threads} listError="" onReloadList={() => undefined} workerOnline selectedId={null} messages={null} loadError=""
  onReloadConversation={() => undefined} onSelect={() => undefined} onSend={async () => true} sending={false} sendError=""
  onDelete={async () => null} onRetry={async () => true} retrying={null} onRate={() => undefined} actionError={null}
  announcement={{ text: "", n: 0 }} now={now} {...props} />);
const conversation = (messages: AssistantMessage[], props: Partial<AssistantViewProps> = {}) => view({ selectedId: "t1", messages, ...props });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Trợ lý AI page", () => {
  it("opens on a new conversation with the five starter questions, the list loading and the two notes", () => {
    const html = renderToStaticMarkup(<StudentAssistant />);
    expect(html).toContain("Chào bạn, hôm nay bạn muốn hỏi gì?");
    for (const starter of STARTER_QUESTIONS) expect(html).toContain(`<span>${starter.text}</span>`);
    expect(html.match(/class="as-starter"/g)).toHaveLength(5);
    expect(html).toContain("Đang tải các cuộc trò chuyện…");
    expect(html).toContain("Trợ lý AI có thể nhầm. Hãy kiểm tra lại với cố vấn học tập trước khi đăng ký học phần.");
    expect(html).toContain("Câu hỏi và câu trả lời được lưu trong tài khoản của bạn; bạn có thể xóa cuộc trò chuyện bất cứ lúc nào.");
    expect(html).not.toContain(OFFLINE_NOTICE);
  });

  it("lists the conversations newest first with their time, a delete action each and Cuộc trò chuyện mới", () => {
    const html = view({ threads: newestFirst([...threads].reverse()), selectedId: "t1", messages: [question, answer] });
    const list = html.slice(html.indexOf('class="as-thread-list"'), html.indexOf("</ul>", html.indexOf('class="as-thread-list"')));
    expect(list.indexOf(threads[0].title)).toBeGreaterThan(-1);
    expect(list.indexOf(threads[0].title)).toBeLessThan(list.indexOf(threads[1].title));
    expect(list).toContain('<button type="button" class="as-thread-open" aria-current="true">');
    expect(list).toContain('<time class="as-thread-time" dateTime="2026-10-28T02:40:00.000Z">09:40</time>');
    expect(list).toContain(">Hôm qua</time>");
    expect(list.match(/aria-label="Xóa cuộc trò chuyện: /g)).toHaveLength(2);
    expect(html).toContain("Cuộc trò chuyện mới</button>");
    // Below 900px the same conversations are a selector above the chat.
    expect(html).toContain('<option value="t2">Học kỳ tới mình nên học những môn nào? · Hôm qua</option>');
  });

  it("shows a finished answer with its bullets, citations, source chips and feedback", () => {
    const html = conversation([question, answer]);
    expect(html).toContain('<li class="as-question"><span class="sr-only">Bạn hỏi: </span>Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?</li>');
    expect(html).toContain("<ul><li><strong>Kiểm thử phần mềm</strong> <sup class=\"as-cite\"><button");
    expect(html).toContain('aria-label="Xem nguồn 2: Khoảng trống kỹ năng">2</button>');
    expect(html).toContain('<a href="https://example.edu/cloud" target="_blank" rel="noopener noreferrer">https://example.edu/cloud');
    // A page of the portal opens in place (like the nav), a resource in a new tab, a source without a link is text.
    expect(html).toContain('<a class="as-source" href="#skill-gap"><span class="as-source-n">2</span><span class="as-source-title">Khoảng trống kỹ năng</span></a>');
    expect(html).toMatch(/<a class="as-source" href="https:\/\/example.edu\/cloud" target="_blank" rel="noopener noreferrer"><span class="as-source-n">3<\/span>/);
    expect(html).toContain('<span class="as-source" tabindex="-1"><span class="as-source-n">4</span><span class="as-source-title">Quy chế đào tạo</span></span>');
    expect(html).toContain('aria-pressed="true" aria-label="Câu trả lời hữu ích"');
    expect(html).toContain('aria-pressed="false" aria-label="Câu trả lời chưa hữu ích"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("shows the typing indicator before any text, then the text as it grows, and blocks the next question meanwhile", () => {
    const waiting = conversation([question, message("a1", "assistant", "", { status: "queued", completedAt: null })]);
    expect(waiting).toContain("Trợ lý đang soạn câu trả lời…");
    expect(waiting).toContain('aria-busy="true"');
    expect(waiting).toContain("Bạn có thể gửi câu hỏi tiếp theo khi trợ lý trả lời xong.");
    expect(waiting).toMatch(/<button type="submit" class="sw-primary as-send" disabled="">/);
    const writing = conversation([question, message("a1", "assistant", "Bạn còn thiếu **Kiểm thử** [1]", { status: "processing", completedAt: null })]);
    expect(writing).toContain("Bạn còn thiếu <strong>Kiểm thử</strong> <sup class=\"as-cite\">[1]</sup>");
    expect(writing).toContain('class="as-dots"');
    expect(writing).not.toContain("Trợ lý đang soạn câu trả lời…");
    expect(writing).not.toContain("as-feedback");
  });

  it("offers Thử lại for a failed answer and a short note for a stopped one", () => {
    const failed = conversation([question, message("a1", "assistant", "", { status: "failed", errorCode: "ai_timeout", completedAt: null })]);
    expect(failed).toContain("Chưa trả lời được câu hỏi này.");
    expect(failed).toMatch(/<button type="button" class="sw-outline as-small"><svg[^>]*>.*<\/svg>Thử lại<\/button>/);
    expect(failed).not.toContain("as-feedback");
    expect(conversation([question, message("a1", "assistant", "", { status: "cancelled" })])).toContain("Câu trả lời này đã dừng trước khi hoàn tất.");
    expect(conversation([question, message("a1", "assistant", "", { status: "failed" })], { retrying: "a1" })).toContain("Đang gửi lại…");
  });

  it("says calmly that the AI is paused when the worker is offline, and that a waiting question is kept", () => {
    const html = conversation([question, message("a1", "assistant", "", { status: "queued", completedAt: null })], { workerOnline: false });
    expect(html).toContain(`<div class="as-offline" role="status">`);
    expect(html).toContain(OFFLINE_NOTICE);
    // The notice says why; the answer itself only that the question waits.
    expect(html).toContain("Câu hỏi đã được lưu và đang chờ trả lời.");
    expect(html).not.toContain("Trợ lý đang soạn câu trả lời…");
    expect(view({ workerOnline: false })).toContain(OFFLINE_NOTICE);
  });

  it("shows the errors of sending, of the list and of the conversation in Vietnamese", () => {
    expect(view({ sendError: assistantErrorMessage("too_frequent") })).toContain('<p class="as-send-error" role="alert">Bạn gửi hơi nhanh.');
    const failedList = view({ threads: null, listError: assistantErrorMessage("network") });
    expect(failedList).toContain("Chưa tải được các cuộc trò chuyện. Không kết nối được với máy chủ.");
    const failedThread = view({ selectedId: "t1", messages: null, loadError: assistantErrorMessage("database_required") });
    expect(failedThread).toContain("<strong>Chưa tải được cuộc trò chuyện</strong>");
    expect(view({ selectedId: "t1", messages: null })).toContain("Đang tải cuộc trò chuyện…");
  });

  it("asks in the page before deleting a conversation", () => {
    // Under the conversation in the list (under the selector below 900px), never window.confirm.
    const html = renderToStaticMarkup(<DeleteConfirm onConfirm={async () => null} onCancel={() => undefined} />);
    expect(html).toBe('<div class="as-confirm" role="group" aria-label="Xác nhận xóa cuộc trò chuyện"><p>Xóa cuộc trò chuyện này?</p>'
      + '<div class="as-confirm-actions"><button type="button" class="sw-primary as-small">Xóa</button><button type="button" class="sw-outline as-small">Hủy</button></div></div>');
  });

  it("announces a finished answer once, not every piece of it", () => {
    expect(view()).toContain('<p class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>');
    expect(view({ announcement: { text: "Trợ lý đã trả lời xong câu hỏi của bạn.", n: 1 } }))
      .toContain('<p class="sr-only" role="status" aria-live="polite" aria-atomic="true"><span>Trợ lý đã trả lời xong câu hỏi của bạn.</span></p>');
    // The answer being written is not a live region.
    expect(conversation([question, message("a1", "assistant", "Bạn", { status: "processing" })])).not.toMatch(/aria-live="polite"[^>]*>[^<]*<span>Bạn/);
  });
});

describe("words", () => {
  it("names every error of the contract in plain Vietnamese", () => {
    for (const code of ["empty_message", "message_too_long", "answer_pending", "too_frequent", "queue_full", "network", "thread_not_found", "message_not_found", "database_required"]) {
      expect(assistantErrorMessage(code)).not.toBe(assistantErrorMessage("unknown"));
    }
    expect(assistantErrorMessage("message_too_long")).toBe("Câu hỏi dài hơn 1.000 ký tự. Bạn hãy rút gọn rồi gửi lại.");
    expect(assistantErrorMessage("something_new")).toBe("Chưa xử lý được yêu cầu. Vui lòng thử lại.");
  });

  it("dates a conversation by the day in Vietnam", () => {
    expect(threadTimeLabel("2026-10-28T02:40:00.000Z", now)).toBe("09:40");
    expect(threadTimeLabel("2026-10-27T18:30:00.000Z", now)).toBe("01:30");
    expect(threadTimeLabel("2026-10-27T03:00:00.000Z", now)).toBe("Hôm qua");
    expect(threadTimeLabel("2026-10-20T03:00:00.000Z", now)).toBe("20/10");
    expect(threadTimeLabel("2025-12-30T03:00:00.000Z", now)).toBe("30/12/2025");
    expect(threadTimeLabel("không phải ngày", now)).toBe("");
  });
});

/** A fetch that answers with JSON bodies (a plain object stands in for Response). */
function stubFetch(answer: (url: string, init?: RequestInit) => { status: number; body?: unknown } | Error) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = answer(url, init);
    if (result instanceof Error) throw result;
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requests", () => {
  it("sends the question as JSON with the session cookie", async () => {
    const fetchMock = stubFetch(() => ({ status: 201, body: { thread: threads[0], messages: [question] } }));
    await assistantApi.start("Học kỳ tới mình nên học gì?");
    expect(fetchMock).toHaveBeenCalledWith("/api/student/assistant/threads", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ content: "Học kỳ tới mình nên học gì?" }), headers: { "Content-Type": "application/json" },
    }));
  });

  it("turns the server's error codes and a lost connection into messages", async () => {
    stubFetch(() => ({ status: 409, body: { error: "answer_pending" } }));
    await expect(assistantApi.ask("t1", "Câu hỏi")).rejects.toMatchObject({ code: "answer_pending", message: assistantErrorMessage("answer_pending") });
    stubFetch(() => new TypeError("Failed to fetch"));
    await expect(assistantApi.threads()).rejects.toMatchObject({ code: "network", message: assistantErrorMessage("network") });
    stubFetch(() => ({ status: 200, body: "<html>" }));
    await expect(assistantApi.threads()).rejects.toMatchObject({ code: "unknown" });
  });

  it("tells the workspace when the session has expired", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    stubFetch(() => ({ status: 401, body: { error: "authentication_required" } }));
    await expect(assistantApi.threads()).rejects.toMatchObject({ code: "authentication_required" });
    expect(dispatchEvent.mock.calls[0][0].type).toBe("edupath-session-expired");
  });

  it("accepts 204 for a deleted conversation and posts feedback and retry to the message", async () => {
    const fetchMock = stubFetch((url) => (url.endsWith("/threads/t1") ? { status: 204 } : { status: 200, body: { message: answer } }));
    await expect(assistantApi.remove("t1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    await assistantApi.feedback("a1", null);
    expect(fetchMock.mock.calls[1]).toEqual(["/api/student/assistant/messages/a1/feedback", expect.objectContaining({ method: "POST", body: '{"value":null}' })]);
    await assistantApi.retry("a1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/student/assistant/messages/a1/retry");
  });
});

describe("waiting for an answer", () => {
  const watch = (signal: AbortSignal, updates: string[], onGone = () => undefined) =>
    watchAnswer("a1", { signal, onUpdate: (next) => updates.push(`${next.status}:${next.content}`), onGone, interval: () => ANSWER_POLL_MS });

  it("reads the answer about every second while it waits or is written, and stops once it is final", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const steps: AssistantMessage[] = [
      message("a1", "assistant", "", { status: "queued" }),
      message("a1", "assistant", "Bạn", { status: "processing" }),
      message("a1", "assistant", "Bạn còn thiếu", { status: "processing" }),
      message("a1", "assistant", "Bạn còn thiếu hai kỹ năng.", { status: "completed" }),
    ];
    let read = 0;
    const fetchMock = stubFetch(() => ({ status: 200, body: { message: steps[Math.min(read++, steps.length - 1)] } }));
    const updates: string[] = [];
    watch(new AbortController().signal, updates);
    await vi.advanceTimersByTimeAsync(ANSWER_POLL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/student/assistant/messages/a1", expect.objectContaining({ credentials: "include", cache: "no-store" }));
    await vi.advanceTimersByTimeAsync(10 * ANSWER_POLL_MS);
    expect(updates).toEqual(["queued:", "processing:Bạn", "processing:Bạn còn thiếu", "completed:Bạn còn thiếu hai kỹ năng."]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops when the conversation changes or the page is left, keeps trying after a lost connection, and reports a deleted answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fail = true;
    const fetchMock = stubFetch(() => (fail ? new TypeError("Failed to fetch") : { status: 200, body: { message: message("a1", "assistant", "", { status: "processing" }) } }));
    const controller = new AbortController();
    const updates: string[] = [];
    watch(controller.signal, updates);
    await vi.advanceTimersByTimeAsync(ANSWER_POLL_MS);
    fail = false;
    await vi.advanceTimersByTimeAsync(ANSWER_POLL_MS);
    expect(updates).toEqual(["processing:"]);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5 * ANSWER_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    stubFetch(() => ({ status: 404, body: { error: "message_not_found" } }));
    const gone = vi.fn();
    watch(new AbortController().signal, [], gone);
    await vi.advanceTimersByTimeAsync(3 * ANSWER_POLL_MS);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
