// One way every admin screen words a failed request (QA 2026-11-04: a 400 read "Không thể kết nối hệ thống", and three
// different catch-all sentences were in use). A screen keeps its own texts for the error codes it knows; anything else is
// worded by what happened: the server did not answer, the input was refused, the session ended, the account may not do
// it, nothing was found, the data changed meanwhile, or the server failed. A 401 also tells the portal, which checks the
// session again (AdminPortal, StudentWorkspace).

/** Sent on window when a request finds the session ended (HTTP 401). */
export const SESSION_EXPIRED_EVENT = "edupath-session-expired";

/** The texts by what happened, for responses without a code the screen knows. */
export const ADMIN_ERROR_TEXTS = {
  network: "Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.",
  invalid: "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.",
  session: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  notFound: "Không tìm thấy dữ liệu. Dữ liệu có thể đã bị xóa; vui lòng tải lại trang.",
  conflict: "Dữ liệu vừa được thay đổi ở nơi khác. Vui lòng tải lại rồi thử lại.",
  tooLarge: "Dữ liệu gửi lên quá lớn. Vui lòng chọn tệp nhỏ hơn.",
  server: "Hệ thống đang bận hoặc gặp lỗi. Vui lòng thử lại sau.",
} as const;

/** Codes every admin API may answer, worded once; a screen's own text for the same code wins. */
const SHARED_CODES: Readonly<Record<string, string>> = {
  authentication_required: ADMIN_ERROR_TEXTS.session,
  insufficient_role: "Bạn không còn quyền thực hiện thao tác này. Hãy đăng xuất và kiểm tra lại tài khoản.",
  read_only_role: "Cố vấn học tập chỉ có quyền xem ở trang quản trị.",
  // A read of the Quản trị viên's functions by the role advisor (API advisors/access.ts ADVISOR_ADMIN_READS).
  admin_only: "Chức năng này chỉ dành cho quản trị viên.",
  invalid_origin: "Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  database_required: "Hệ thống chưa kết nối cơ sở dữ liệu. Vui lòng thử lại sau.",
};

/** Text with Vietnamese letters: a server message an admin can read, not a technical English one. */
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/iu;

type Body = { error?: unknown; message?: unknown; details?: unknown };
const asBody = (value: unknown): Body => (value && typeof value === "object" ? value as Body : {});
/** The API error code of a response body ({ error: "code" }), or null. */
export const errorCodeOf = (body: unknown): string | null => {
  const code = asBody(body).error;
  return typeof code === "string" && code ? code : null;
};
const detailsOf = (body: unknown): string[] => {
  const details = asBody(body).details;
  return Array.isArray(details) ? details.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
};

export type AdminErrorOptions = {
  /** Add the server's detail lines ({ details: [...] }, e.g. which rows of a file are wrong) under the text. */
  details?: boolean;
};

/**
 * The text of a failed response: the screen's text for the response's code, else the shared text of the code, else
 * (400, 422) the server's Vietnamese message, else the text of the status. Status 0 means no answer at all.
 */
export function adminErrorText(status: number, body: unknown, texts: Readonly<Record<string, string>> = {}, options: AdminErrorOptions = {}): string {
  const code = errorCodeOf(body);
  const message = asBody(body).message;
  const text = code && Object.hasOwn(texts, code) ? texts[code]!
    : code && Object.hasOwn(SHARED_CODES, code) ? SHARED_CODES[code]!
      : status === 0 ? ADMIN_ERROR_TEXTS.network
        : status === 401 ? ADMIN_ERROR_TEXTS.session
          : status === 403 ? ADMIN_ERROR_TEXTS.forbidden
            : status === 404 ? ADMIN_ERROR_TEXTS.notFound
              : status === 409 ? ADMIN_ERROR_TEXTS.conflict
                : status === 413 ? ADMIN_ERROR_TEXTS.tooLarge
                  : (status === 400 || status === 422) && typeof message === "string" && VIETNAMESE.test(message) ? message.trim()
                    : status >= 500 || status === 408 || status === 429 ? ADMIN_ERROR_TEXTS.server
                      : ADMIN_ERROR_TEXTS.invalid;
  const details = options.details ? detailsOf(body) : [];
  return details.length ? `${text}\n${details.join("\n")}` : text;
}

/** A failed admin request: the text to show, with the HTTP status (0 = no answer), the API code and the body kept. */
export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly body: Record<string, unknown> = {}) {
    super(message);
    this.name = "AdminRequestError";
  }
}

/**
 * The JSON of a successful response ({} when it is empty); a failed one throws an AdminRequestError worded by
 * adminErrorText, and a 401 also sends SESSION_EXPIRED_EVENT.
 */
export async function readAdminResponse<T>(response: Response, texts: Readonly<Record<string, string>> = {}, options: AdminErrorOptions = {}): Promise<T> {
  if (response.ok) {
    const text = await response.text();
    if (!text.trim()) return {} as T;
    try { return JSON.parse(text) as T; }
    // A page instead of data (a proxy's error page): the server did not answer as it should.
    catch { throw new AdminRequestError(ADMIN_ERROR_TEXTS.server, response.status); }
  }
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  const body = asBody(await response.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminRequestError(adminErrorText(response.status, body, texts, options), response.status, errorCodeOf(body), body);
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError" || (error as { name?: unknown } | null)?.name === "AbortError";

/**
 * fetch with the admin session, read by readAdminResponse. No answer at all (offline, server down) throws an
 * AdminRequestError with status 0 and the network text; a cancelled request is passed on as it is.
 */
export async function adminRequest<T>(url: string, init: RequestInit = {}, texts: Readonly<Record<string, string>> = {}, options: AdminErrorOptions = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: "include", cache: "no-store", ...init }); }
  catch (error) {
    if (isAbort(error)) throw error;
    throw new AdminRequestError(ADMIN_ERROR_TEXTS.network, 0);
  }
  return readAdminResponse<T>(response, texts, options);
}

/** What fetch throws when no answer comes (Chrome, Firefox, Safari, Node). */
const NETWORK_FAILURE = /^(Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|The network connection was lost|The Internet connection appears to be offline|Could not connect to the server)/iu;

/**
 * The text to show for anything an admin request threw: an AdminRequestError's own text, the network text for a fetch
 * that got no answer, a screen's own Error text, else the server text.
 */
export function adminFailureText(error: unknown): string {
  if (error instanceof AdminRequestError) return error.message;
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) return ADMIN_ERROR_TEXTS.network;
  if (error instanceof Error && error.message && !(error instanceof TypeError) && !(error instanceof SyntaxError)) return error.message;
  return ADMIN_ERROR_TEXTS.server;
}
