"""Gemma 4 on Cloudflare Workers AI as the OCR of scanned VLU transcripts (user 2026-11-08: "chuyển ocr thành gemma luôn").

A page without a usable text layer is rendered at 200 DPI in three overlapping horizontal strips. Gemma reads each strip
into JSON items (term titles, course rows, summary boxes, section titles, the column header), all strips at once. The items
then become the same eight-cell rows the text layer and PaddleOCR give, so test_ocr.parse_pages and every check after it
(codes, scores, letters, the printed term GPA and credits against the rows) stay as they are.

Runs on the API server (apps/api/src/student/text-layer.ts, worker.py --parse --gemma) with CLOUDFLARE_ACCOUNT_ID and
CLOUDFLARE_API_TOKEN in its environment; GEMMA_OCR_URL / GEMMA_OCR_MODEL point it at another OpenAI-compatible server
(a local Ollama) for tests. Cloudflare keeps no input or output after a request and trains no model on them. Nothing is
printed or logged but counts.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
from difflib import get_close_matches
import json
import os
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MODEL = '@cf/google/gemma-4-26b-a4b-it'
DPI = 200
STRIPS = 3
# Gemma 4 on Workers AI sees every image through about 270 tokens, whatever its size or `detail` (measured 2026-11-08:
# low, auto and high alike, and a strip half as tall costs the same), so a bigger image is shrunk before it is read. A
# strip of at most this many pixels is read at its own resolution: about five table rows at 200 DPI (the user asked for
# the most the OCR can get: "bạn đã tăng lượng token ocr lên tối đa chưa").
IMAGE_PIXELS = 600_000
# Kept for callers; strips no longer overlap (they end on the table's borders, strip_cuts).
OVERLAP = 0.0
# Requests in flight at once (Workers AI takes them in parallel; a 4-page scan is 12 strips).
PARALLEL = 6
RETRY_DELAYS = (3, 10)
# What the strips of one PDF cost (requests and tokens as Workers AI counts them), added to the result's ocr_settings so
# the day's use of the free allowance can be followed. Never any text.
USAGE = {'requests': 0, 'prompt_tokens': 0, 'completion_tokens': 0}
_USAGE_LOCK = __import__('threading').Lock()

# The summary box fields, with the labels test_ocr.SUMMARY_FIELDS knows.
SUMMARY = [
    ('so_tin_chi_dat_hoc_ky', 'Số tín chỉ đạt học kỳ'),
    ('diem_tb_hoc_ky_he_4', 'Điểm TB học kỳ (Hệ 4)'),
    ('diem_tb_hoc_ky_he_10', 'Điểm TB học kỳ (Hệ 10)'),
    ('xep_loai_hoc_ky', 'Xếp loại học tập HK'),
    ('diem_ren_luyen_hoc_ky', 'Điểm rèn luyện học kỳ'),
    ('tong_so_tin_chi_dang_ky', 'Tổng số tín chỉ đăng ký'),
    ('diem_tb_hoc_tap_he_4', 'Điểm TB học tập (Hệ 4)'),
    ('diem_tb_hoc_tap_he_10', 'Điểm TB học tập (Hệ 10)'),
    ('tong_so_tin_chi_tich_luy', 'Tổng số tín chỉ tích lũy'),
    ('diem_tb_tich_luy_he_4', 'Điểm TB tích lũy (Hệ 4)'),
    ('diem_tb_tich_luy_he_10', 'Điểm TB tích lũy (Hệ 10)'),
    ('xep_loai_tich_luy', 'Xếp loại học tập tích lũy'),
]
NULLABLE = {'type': ['string', 'null']}
SCHEMA = {
    'type': 'object',
    'properties': {'items': {'type': 'array', 'items': {
        'type': 'object',
        'properties': {
            'kind': {'type': 'string', 'enum': ['term', 'course', 'summary', 'section', 'header']},
            'text': NULLABLE, 'year': NULLABLE, 'semester': {'type': ['integer', 'null']},
            'stt': NULLABLE, 'code': NULLABLE, 'name': NULLABLE, 'credits': NULLABLE, 'score10': NULLABLE,
            'score4': NULLABLE, 'letter': NULLABLE, 'result': {'type': ['string', 'null'], 'enum': ['passed', 'failed', None]},
            'lines': {'type': ['array', 'null'], 'items': {'type': 'string'}},
        },
        'required': ['kind'],
    }}},
    'required': ['items'],
}
PROMPT = """Ảnh là một dải ngang của bảng điểm sinh viên Trường Đại học Văn Lang. Liệt kê theo thứ tự từ trên xuống mọi mục nhìn thấy TRỌN VẸN trong ảnh:
- kind "term": dòng tên học kỳ; year là năm học dạng "2023-2024", semester là số của học kỳ (1, 2 hoặc 3).
- kind "course": dòng môn học có số thứ tự; stt (số thứ tự), code (mã học phần), name (tên học phần), credits (số tín chỉ), score10 (điểm hệ 10), score4 (điểm hệ 4), letter (điểm chữ), result: "passed" khi cột Kết quả có dấu tích hoặc chữ Đạt, "failed" khi có dấu X hoặc chữ Không đạt, null khi trống.
- kind "summary": khối tổng kết cuối mỗi học kỳ, thường gồm HAI ô đặt cạnh nhau: ô bên trái (Số tín chỉ đạt học kỳ, Điểm TB học kỳ (Hệ 4), Xếp loại học tập HK, Điểm rèn luyện học kỳ...) và ô bên phải (Tổng số tín chỉ đăng ký, Điểm TB học tập (Hệ 4), Tổng số tín chỉ tích lũy, Điểm TB tích lũy (Hệ 4), Xếp loại học tập tích lũy...). Ghi vào lines MỌI dòng của CẢ HAI ô, mỗi dòng một chuỗi "Nhãn: giá trị" chép nguyên văn như in (bỏ dấu gạch đầu dòng). Không dùng các trường của dòng môn học (stt, code, name, score4...) cho khối tổng kết.
- kind "section": tiêu đề một phần khác của bảng, ví dụ "Điểm bảo lưu"; ghi vào text.
- kind "header": CHỈ dòng tên các cột (STT, Mã môn học, Tên môn học...); ghi các tên cột vào text. Không bao giờ chép dòng môn học vào header: mỗi dòng môn học là một mục "course" riêng.
Quy tắc:
- Chép đúng từng ký tự như in: mã học phần, tên học phần, điểm (giữ dấu chấm hoặc dấu phẩy như in), điểm chữ (A+, A, B+, B, C+, C, D+, D, F, VT, CT, MT...).
- Không sửa, không đoán, không tự tính. Ô trống hoặc không đọc rõ thì để null.
- Ảnh được cắt đúng theo đường kẻ của bảng nên không có dòng nào bị cắt: chép MỌI dòng, kể cả dòng đầu tiên và dòng cuối cùng của ảnh.
- Bỏ qua tiêu đề trang, thông tin sinh viên, chữ ký.
- Không thêm dòng nào không có trong ảnh. Ảnh không có mục nào thì trả về {"items": []}.
Chỉ trả về JSON {"items": [...]}."""


class GemmaOcrError(RuntimeError):
    """Gemma could not read a page (no answer, refused, out of the day's quota, or not JSON)."""


def settings():
    """(url, model, headers) of the chat endpoint: Cloudflare Workers AI, or GEMMA_OCR_URL for tests."""
    url = os.environ.get('GEMMA_OCR_URL', '').rstrip('/')
    if url:
        return f'{url}/chat/completions', os.environ.get('GEMMA_OCR_MODEL', MODEL), {'Content-Type': 'application/json'}
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '').strip().lower()
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
    if not re.fullmatch(r'[0-9a-f]{32}', account) or not token:
        raise GemmaOcrError('cloudflare_not_configured')
    return (f'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions', MODEL,
            {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})


def deskew(image, limit=1.5, step=0.1):
    """The image turned by the angle (within ±limit degrees) that makes its ink rows sharpest: the horizontal profile of
    a straight table has the highest peaks. For pages rectify() leaves as they are (a short table, whose rulings are
    too short to fit; user test 2026-11-08: the last page of a scan tilted by half a degree had no table grid)."""
    import cv2
    import numpy as np
    small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_RGB2GRAY), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    ink = (small < 180).astype(np.float32)
    height, width = ink.shape

    def sharpness(angle):
        turned = cv2.warpAffine(ink, cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0), (width, height),
                                flags=cv2.INTER_NEAREST, borderValue=0)
        return float((turned.sum(axis=1) ** 2).sum())

    # Ties (thin lines barely change their rows for a few hundredths of a degree) go to the smallest turn.
    best = max(np.arange(-limit, limit + step / 2, step), key=lambda angle: (sharpness(angle), -abs(angle)))
    best = max(np.arange(best - step, best + step + 0.001, step / 5), key=lambda angle: (sharpness(angle), -abs(angle)))
    if abs(best) < 0.05:  # under 1,5 px over a page width: nothing to turn
        return image
    full_height, full_width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((full_width / 2, full_height / 2), float(best), 1.0)
    return cv2.warpAffine(image, matrix, (full_width, full_height), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def table_image(page, dpi=DPI):
    """The page as an RGB array cut down to the ruled transcript table, so only the table (terms, course rows, summary
    boxes) ever leaves the server: no title, page header or footer, nor anything printed around the table; and the
    table's horizontal borders in that array (where a strip may end without cutting a row). A scan is straightened
    first, as for PaddleOCR. No table grid: the page is not sent."""
    import numpy as np
    from ppocr_table import rectify, table_bands
    from test_ocr import is_scanned
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()
    scanned = is_scanned(page)
    if scanned:
        image, _ = rectify(image)
    bands, _ = table_bands(image)
    if not bands and scanned:
        image = deskew(image)
        bands, _ = table_bands(image)
    cells = [cell for band in bands for cell in band['cells']]
    if not bands or not cells:
        raise GemmaOcrError('table_not_found')
    height, width = image.shape[:2]
    margin = int(dpi * 0.15)
    top, bottom = max(0, min(b['top'] for b in bands) - margin), min(height, max(b['bottom'] for b in bands) + margin)
    left, right = max(0, min(c[0] for c in cells) - margin), min(width, max(c[1] for c in cells) + margin)
    borders = sorted({edge - top for band in bands for edge in (band['top'], band['bottom']) if top < edge < bottom})
    # Low bands of eight cells: the course rows (and the column header), to check that Gemma read every one of them. A
    # summary box can show eight cells where the column rulings run through it, but it is three times as tall.
    rows = [((band['top'] + band['bottom']) / 2 - top) for band in bands
            if len(band['cells']) == 8 and band['bottom'] - band['top'] < dpi * 0.75]
    return np.ascontiguousarray(image[top:bottom, left:right]), borders, rows


def strip_cuts(height, borders, target):
    """[(top, bottom)] strips of about `target` pixels that start and end on the table's borders, so no row is ever cut
    or read twice (user test 2026-11-08: overlapping strips put a row of one term under the next). A row taller than
    the target is a strip of its own; a short rest joins the strip before it."""
    edges = sorted({0, height, *[y for y in borders if 0 < y < height]})
    cuts, start = [], 0
    while start < height:
        inside = [y for y in edges if start < y <= start + target]
        end = max(inside) if inside else min(y for y in edges if y > start)
        if height - end < target * 0.3:
            end = height
        cuts.append((start, end))
        start = end
    return cuts


def strip_jobs(page, dpi=DPI, pixels=IMAGE_PIXELS):
    """[(JPEG, eight-cell rows in it)] of the page's table (table_image) in strips cut on the table's borders, each small
    enough (IMAGE_PIXELS with its white margin) that Gemma reads it at full resolution (quality 90). The first strip of
    a page may hold the column header among its eight-cell rows."""
    import cv2
    image, borders, rows = table_image(page, dpi)
    pad = int(dpi * 0.1)
    target = max(dpi * 0.5, pixels / image.shape[1] - 2 * pad)
    jobs = []
    for top, bottom in strip_cuts(image.shape[0], borders, target):
        strip = cv2.copyMakeBorder(image[top:bottom], pad, pad, 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        ok, jpeg = cv2.imencode('.jpg', cv2.cvtColor(strip, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise GemmaOcrError('image_failed')
        jobs.append((jpeg.tobytes(), sum(1 for y in rows if top <= y < bottom)))
    return jobs


def strip_images(page, dpi=DPI, pixels=IMAGE_PIXELS):
    """The JPEG strips of strip_jobs."""
    return [jpeg for jpeg, _ in strip_jobs(page, dpi, pixels)]


# A strip whose answer has fewer course rows than its eight-cell rows is read again, at most this many more times; the
# answer with the most course rows is kept (user test 2026-11-08: Gemma once wrote a strip's five rows as one header).
RETRIES = 2


def read_checked(read, jpeg, rows, first):
    """Gemma's items for a strip, read again while they miss a course row (the first strip of a page may hold the
    column header, one eight-cell row that is no course)."""
    best = None
    for _ in range(RETRIES + 1):
        items = read(jpeg)
        courses = sum(1 for item in items if item.get('kind') == 'course')
        if best is None or courses > best[0]:
            best = (courses, items)
        if courses >= rows - (1 if first else 0):
            break
    return best[1]


def json_text(content):
    """The JSON object of an answer, also when it came in a ```json fence or with words around it."""
    text = (content or '').strip()
    fenced = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end < start:
        raise GemmaOcrError('not_json')
    return text[start:end + 1]


def read_strip(image_jpeg, endpoint=None):
    """Gemma's items for one strip image. Busy, 5xx and network failures are asked again twice."""
    url, model, headers = endpoint or settings()
    body = {
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': PROMPT},
            {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(image_jpeg).decode(), 'detail': 'high'}},
        ]}],
        'max_completion_tokens': 6144,
        'temperature': 0,
        'chat_template_kwargs': {'enable_thinking': False},
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'transcript_strip', 'schema': SCHEMA}},
    }
    data = json.dumps(body).encode()
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            with urlopen(Request(url, data=data, headers=headers, method='POST'), timeout=240) as response:
                answer = json.loads(response.read())
            break
        except HTTPError as error:
            text = error.read()[:4000].decode('utf-8', 'replace')
            if '4006' in text:
                raise GemmaOcrError('daily_limit') from None
            if error.code in (408, 429) or error.code >= 500 or '3040' in text:
                if attempt < len(RETRY_DELAYS):
                    time.sleep(RETRY_DELAYS[attempt])
                    continue
            raise GemmaOcrError(f'http_{error.code}') from None
        except (URLError, TimeoutError, OSError):
            if attempt < len(RETRY_DELAYS):
                time.sleep(RETRY_DELAYS[attempt])
                continue
            raise GemmaOcrError('unreachable') from None
    usage = answer.get('usage') or {}
    with _USAGE_LOCK:
        USAGE['requests'] += 1
        for key in ('prompt_tokens', 'completion_tokens'):
            USAGE[key] += int(usage.get(key) or 0)
    choice = (answer.get('choices') or [{}])[0]
    if choice.get('finish_reason') == 'length':
        raise GemmaOcrError('truncated')
    content = (choice.get('message') or {}).get('content')
    try:
        items = json.loads(json_text(content)).get('items')
    except (ValueError, AttributeError):
        raise GemmaOcrError('not_json') from None
    if not isinstance(items, list):
        raise GemmaOcrError('not_json')
    return [item for item in items if isinstance(item, dict)]


def read_pages(document, indexes, reader=read_strip):
    """{page index: [items of its strips, in order]} for the pages that need OCR, every strip read in parallel."""
    endpoint = settings() if reader is read_strip else None
    read = (lambda jpeg: reader(jpeg, endpoint)) if endpoint else reader
    jobs = [(index, jpeg, rows, number == 0) for index in indexes for number, (jpeg, rows) in enumerate(strip_jobs(document[index]))]
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        answers = list(pool.map(lambda job: read_checked(read, job[1], job[2], job[3]), jobs))
    pages = {index: [] for index in indexes}
    for (index, *_), items in zip(jobs, answers):
        pages[index].extend(items)
    return pages


def text(value):
    """A printed value as a cell: NFC, single spaces; a lone dash (an empty cell) is empty."""
    value = ' '.join(unicodedata.normalize('NFC', '' if value is None else str(value)).split())
    return '' if value in ('-', '–', '—') else value


def folded(value):
    return ''.join(c for c in unicodedata.normalize('NFD', text(value)) if not unicodedata.combining(c)).lower().replace('đ', 'd')


def year_text(value):
    match = re.search(r'(\d{4})\s*[-–]\s*(\d{4})', text(value))
    return f'{match[1]}-{match[2]}' if match else None


RESULT_MARKS = {'passed': '✓', 'failed': '✗'}
# Characters a reader mixes up in a course code: a digit in the letters part, or a letter in the digits part.
LOOKALIKES = {'0': 'O', 'O': '0', '1': 'I', 'I': '1', '5': 'S', 'S': '5', '8': 'B', 'B': '8', '2': 'Z', 'Z': '2', '6': 'G', 'G': '6'}


def fixed_code(code):
    """A code that does not have the VLU form, with the one look-alike character that gives it the form when exactly one
    such change does ('71P0LE10022' → '71POLE10022', user test 2026-11-08); else the code as read."""
    from test_ocr import CODE
    if not code or CODE.fullmatch(code):
        return code
    candidates = {code[:i] + LOOKALIKES[c] + code[i + 1:] for i, c in enumerate(code) if c in LOOKALIKES}
    valid = [candidate for candidate in candidates if CODE.fullmatch(candidate)]
    return valid[0] if len(valid) == 1 else code
LABELS = {folded(label): label for _, label in SUMMARY}


def summary_label(raw):
    """The summary label test_ocr knows that a printed label is (exactly, or within a few misread letters), else None."""
    key = folded(raw).strip(' -:')
    if key in LABELS:
        return LABELS[key]
    close = get_close_matches(key, list(LABELS), n=1, cutoff=0.8)
    return LABELS[close[0]] if close else None


def summary_values(item):
    """{known label: printed value} of a summary item: its lines "Nhãn: giá trị" (a label Gemma wrote twice, "Nhãn: Nhãn:
    giá trị", counts once), and the older keyed fields. Lines of no known label are left out (never guessed)."""
    values = {}
    fields = item.get('fields') if isinstance(item.get('fields'), dict) else {}
    pieces = [f'{label}: {fields.get(key)}' for key, label in SUMMARY if text(fields.get(key))]
    pieces += [line for line in (item.get('lines') or []) if isinstance(line, str)]
    # Gemma also writes the box as one text, a line per field.
    pieces += str(item.get('text') or '').splitlines()
    for piece in pieces:
        label, colon, value = text(piece).lstrip('- ').partition(':')
        known = summary_label(label) if colon else None
        if not known:
            continue
        value = value.strip()
        again, colon2, rest = value.partition(':')
        if colon2 and summary_label(again) == known:
            value = rest.strip()
        if value and known not in values:
            values[known] = value
    return values


def next_term(term):
    """The term after ('2025-2026', 3): ('2026-2027', 1); VLU years have three terms."""
    year, semester = term
    if semester < 3:
        return year, semester + 1
    first = int(year[:4]) + 1
    return f'{first}-{first + 1}', 1


class RowBuilder:
    """Turns the items of every OCR page, in reading order, into test_ocr rows: the same term title in a row once, a
    course row Gemma wrote twice once (same number and code within the term), summary pieces next to each other merged
    into one box. A term whose title Gemma did not read (course rows right after a summary box, or numbers starting
    again at 1) becomes the term after the current one, and its page says term_title_inferred so the student checks it;
    a row whose number repeats with another code is kept (the server marks it), never dropped."""

    def __init__(self):
        self.term = None
        self.seen = {}
        self.headers = []
        self.last = None
        self.last_number = None
        self.page_warnings = []

    def rows(self, items):
        rows = []
        self.page_warnings = []
        for item in items:
            kind = item.get('kind')
            if kind == 'term':
                year, semester = year_text(item.get('year') or item.get('text')), item.get('semester')
                if not isinstance(semester, int) or isinstance(semester, bool):
                    found = re.search(r'(?:hk|hoc ky)\s*0?(\d)\b', folded(f"{semester or ''} {item.get('text') or ''}")) or re.fullmatch(r'0?(\d)', text(semester))
                    semester = int(found[1]) if found else None
                if not year or semester is None or not 1 <= semester <= 4:
                    continue
                if self.term != (year, semester):
                    self.term = (year, semester)
                    rows.append([f'Năm học {year} - HK{semester}'] + [''] * 7)
                self.last, self.last_number = 'term', None
            elif kind == 'course':
                cells = [text(item.get(key)) for key in ('stt', 'code', 'name', 'credits', 'score10', 'score4', 'letter')]
                cells[1] = fixed_code(cells[1].replace(' ', ''))
                cells.append(RESULT_MARKS.get(item.get('result'), ''))
                if not any(cells[1:7]):
                    continue
                restarted = cells[0] == '1' and self.last == 'course' and self.last_number not in (None, '1')
                if self.term and (self.last == 'summary' or restarted):
                    self.term = next_term(self.term)
                    rows.append([f'Năm học {self.term[0]} - HK{self.term[1]}'] + [''] * 7)
                    if 'term_title_inferred' not in self.page_warnings:
                        self.page_warnings.append('term_title_inferred')
                key = (self.term, cells[0]) if cells[0].isdigit() else (self.term, '', cells[1])
                if self.seen.get(key, [None, None])[1] == cells[1]:
                    continue
                self.seen.setdefault(key, cells)
                rows.append(cells)
                self.last, self.last_number = 'course', cells[0]
            elif kind == 'summary':
                values = summary_values(item)
                previous = rows[-1] if rows and rows[-1][0].startswith('- ') else None
                if previous is not None:
                    known = dict(line[2:].split(': ', 1) for line in previous[0].split('\n'))
                    for label, value in values.items():
                        known.setdefault(label, value)
                    previous[0] = '\n'.join(f'- {label}: {known[label]}' for _, label in SUMMARY if label in known)
                    continue
                lines = [f'- {label}: {values[label]}' for _, label in SUMMARY if label in values]
                if lines:
                    rows.append(['\n'.join(lines)] + [''] * 7)
                    self.last = 'summary'
            elif kind == 'section':
                title = text(item.get('text'))
                if 'bao luu' in folded(title) and not (rows and rows[-1][0] == title):
                    self.term = None
                    rows.append([title] + [''] * 7)
                    self.last, self.last_number = 'section', None
            elif kind == 'header':
                self.headers.append(text(item.get('text')))
        return rows
