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
# Each strip reaches 7% of the page into its neighbours, so every row is whole in at least one strip.
OVERLAP = 0.07
# Requests in flight at once (Workers AI takes them in parallel; a 4-page scan is 12 strips).
PARALLEL = 6
RETRY_DELAYS = (3, 10)

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
            'fields': {'type': ['object', 'null'], 'properties': {key: NULLABLE for key, _ in SUMMARY}},
        },
        'required': ['kind'],
    }}},
    'required': ['items'],
}
PROMPT = """Ảnh là một dải ngang của bảng điểm sinh viên Trường Đại học Văn Lang. Liệt kê theo thứ tự từ trên xuống mọi mục nhìn thấy TRỌN VẸN trong ảnh:
- kind "term": dòng tên học kỳ; year là năm học dạng "2023-2024", semester là số của học kỳ (1, 2 hoặc 3).
- kind "course": dòng môn học có số thứ tự; stt (số thứ tự), code (mã học phần), name (tên học phần), credits (số tín chỉ), score10 (điểm hệ 10), score4 (điểm hệ 4), letter (điểm chữ), result: "passed" khi cột Kết quả có dấu tích hoặc chữ Đạt, "failed" khi có dấu X hoặc chữ Không đạt, null khi trống.
- kind "summary": khối tổng kết của học kỳ (các dòng bắt đầu bằng dấu gạch: Số tín chỉ đạt học kỳ, Điểm TB học kỳ (Hệ 4), Điểm TB học kỳ (Hệ 10), Xếp loại học tập HK, Điểm rèn luyện học kỳ, Tổng số tín chỉ đăng ký, Điểm TB học tập (Hệ 4), Điểm TB học tập (Hệ 10), Tổng số tín chỉ tích lũy, Điểm TB tích lũy (Hệ 4), Điểm TB tích lũy (Hệ 10), Xếp loại học tập tích lũy); ghi giá trị của từng dòng vào fields theo đúng tên.
- kind "section": tiêu đề một phần khác của bảng, ví dụ "Điểm bảo lưu"; ghi vào text.
- kind "header": dòng tên các cột của bảng; ghi các tên cột vào text.
Quy tắc:
- Chép đúng từng ký tự như in: mã học phần, tên học phần, điểm (giữ dấu chấm hoặc dấu phẩy như in), điểm chữ (A+, A, B+, B, C+, C, D+, D, F, VT, CT, MT...).
- Không sửa, không đoán, không tự tính. Ô trống hoặc không đọc rõ thì để null.
- Bỏ qua dòng bị cắt dở ở mép trên hoặc mép dưới ảnh, tiêu đề trang, thông tin sinh viên, chữ ký.
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


def table_image(page, dpi=DPI):
    """The page as an RGB array with everything outside the ruled transcript table painted white and cut off, so only the
    table (terms, course rows, summary boxes) ever leaves the server: no title, page header or footer, nor anything
    printed around the table. A scan is straightened first, as for PaddleOCR. No table grid: the page is not sent."""
    import numpy as np
    from ppocr_table import rectify, table_bands
    from test_ocr import is_scanned
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()
    if is_scanned(page):
        image, _ = rectify(image)
    bands, _ = table_bands(image)
    cells = [cell for band in bands for cell in band['cells']]
    if not bands or not cells:
        raise GemmaOcrError('table_not_found')
    height, width = image.shape[:2]
    margin = int(dpi * 0.15)
    top, bottom = max(0, min(b['top'] for b in bands) - margin), min(height, max(b['bottom'] for b in bands) + margin)
    left, right = max(0, min(c[0] for c in cells) - margin), min(width, max(c[1] for c in cells) + margin)
    return np.ascontiguousarray(image[top:bottom, left:right])


def strip_images(page, dpi=DPI, count=STRIPS, overlap=OVERLAP):
    """JPEG images (quality 90: a grey scan strip stays near 300 kB, a PNG would be 2 MB) of overlapping horizontal strips
    of the page's table (table_image), top to bottom: about a third of a page each, fewer for a short table; neighbours
    share 7% of a page so every row is whole in at least one."""
    import cv2
    image = table_image(page, dpi)
    height = image.shape[0]
    page_height = page.rect.height * dpi / 72
    count = max(1, min(count, round(height / (page_height / count) + 0.2)))
    step, reach = height / count, int(overlap * page_height)
    images = []
    for index in range(count):
        top, bottom = max(0, int(index * step) - reach), min(height, int((index + 1) * step) + reach)
        ok, jpeg = cv2.imencode('.jpg', cv2.cvtColor(image[top:bottom], cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise GemmaOcrError('image_failed')
        images.append(jpeg.tobytes())
    return images


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
    jobs = [(index, strip) for index in indexes for strip in strip_images(document[index])]
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        answers = list(pool.map(lambda job: reader(job[1], endpoint) if endpoint else reader(job[1]), jobs))
    pages = {index: [] for index in indexes}
    for (index, _), items in zip(jobs, answers):
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


class RowBuilder:
    """Turns the items of every OCR page, in reading order, into test_ocr rows. The strips overlap, so a row read twice
    is kept once: a course by its number within the term (or by its code when the number is unreadable), the same term
    title in a row once, and summary pieces next to each other merge into one box."""

    def __init__(self):
        self.term = None
        self.seen = {}
        self.headers = []

    def rows(self, items):
        rows = []
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
            elif kind == 'course':
                cells = [text(item.get(key)) for key in ('stt', 'code', 'name', 'credits', 'score10', 'score4', 'letter')]
                cells.append(RESULT_MARKS.get(item.get('result'), ''))
                if not any(cells[1:7]):
                    continue
                key = (self.term, cells[0]) if cells[0].isdigit() else (self.term, '', cells[1])
                if key in self.seen:
                    continue
                self.seen[key] = cells
                rows.append(cells)
            elif kind == 'summary':
                fields = item.get('fields') if isinstance(item.get('fields'), dict) else {}
                values = {key: text(fields.get(key)) for key, _ in SUMMARY}
                previous = rows[-1] if rows and rows[-1][0].startswith('- ') else None
                if previous is not None:
                    known = dict(line[2:].split(': ', 1) for line in previous[0].split('\n'))
                    for key, label in SUMMARY:
                        if values[key] and label not in known:
                            known[label] = values[key]
                    previous[0] = '\n'.join(f'- {label}: {known[label]}' for _, label in SUMMARY if label in known)
                    continue
                lines = [f'- {label}: {values[key]}' for key, label in SUMMARY if values[key]]
                if lines:
                    rows.append(['\n'.join(lines)] + [''] * 7)
            elif kind == 'section':
                title = text(item.get('text'))
                if 'bao luu' in folded(title) and not (rows and rows[-1][0] == title):
                    self.term = None
                    rows.append([title] + [''] * 7)
            elif kind == 'header':
                self.headers.append(text(item.get('text')))
        return rows
