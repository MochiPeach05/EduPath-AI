"""Unit tests for Paddle device selection, the text-first OCR route and the row rules of the adapter."""
from collections import Counter
import builtins
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ppocr_table import resolve_device


def fake_paddle(compiled=True, count=1, count_error=None):
    device_count = Mock(return_value=count)
    if count_error is not None:
        device_count.side_effect = count_error
    return SimpleNamespace(
        is_compiled_with_cuda=Mock(return_value=compiled),
        device=SimpleNamespace(cuda=SimpleNamespace(device_count=device_count)),
    )


class ResolveDeviceTests(TestCase):
    def test_auto_selects_gpu_when_cuda_and_device_are_available(self):
        paddle = fake_paddle(compiled=True, count=1)
        with patch.dict(sys.modules, {"paddle": paddle}):
            self.assertEqual(resolve_device("auto"), "gpu:0")
        paddle.is_compiled_with_cuda.assert_called_once_with()
        paddle.device.cuda.device_count.assert_called_once_with()

    def test_auto_uses_cpu_when_cuda_is_not_compiled_or_device_is_missing(self):
        for paddle in (fake_paddle(compiled=False, count=1), fake_paddle(compiled=True, count=0)):
            with self.subTest(paddle=paddle), patch.dict(sys.modules, {"paddle": paddle}):
                self.assertEqual(resolve_device("auto"), "cpu")

    def test_auto_falls_back_to_cpu_when_cuda_probe_raises(self):
        paddle = fake_paddle(compiled=True, count_error=OSError("driver unavailable"))
        with patch.dict(sys.modules, {"paddle": paddle}):
            self.assertEqual(resolve_device("auto"), "cpu")

    def test_explicit_devices_return_without_importing_paddle(self):
        original_import = builtins.__import__

        def reject_paddle(name, *args, **kwargs):
            if name == "paddle":
                raise AssertionError("explicit device selection imported paddle")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=reject_paddle):
            self.assertEqual(resolve_device("cpu"), "cpu")
            self.assertEqual(resolve_device("gpu:0"), "gpu:0")


class NativeRouteTests(TestCase):
    def test_usable_native_text_does_not_initialize_ocr(self):
        import test_ocr

        class Page:
            number = 0

            @staticmethod
            def get_image_info():
                return []

        class Document:
            is_pdf = True

            def __iter__(self):
                return iter([Page()])

        models = {}
        with patch.object(test_ocr, "native_rows", return_value=([], True, Counter())):
            with patch.object(
                test_ocr, "_ppocr_page", side_effect=AssertionError("OCR should remain lazy")
            ) as ocr_page:
                result = test_ocr.extract_transcript(
                    Document(),
                    "synthetic.pdf",
                    test_ocr.Options(mode="auto", device="auto"),
                    models=models,
                    log=lambda _message: None,
                )

        self.assertEqual([page["method"] for page in result["pages"]], ["pdf_text"])
        ocr_page.assert_not_called()
        self.assertEqual(models, {})


class AdapterRuleTests(TestCase):
    """Synthetic rows in the VLU eight-column layout (no student data)."""

    @staticmethod
    def page(rows, number=1):
        return {"page": number, "method": "pdf_text", "warnings": [], "rows": rows}

    def test_absent_vt_is_a_failed_attempt_without_a_score(self):
        import test_ocr

        rows = [
            ["Năm học: 2023-2024 - Học kỳ: HK01"],
            ["1", "71ENG110013", "Anh văn 1 (AV1)", "3", "VT", "VT", "VT", "✗"],
            ["2", "71ITBS10103", "Nhập môn công nghệ thông tin", "3", "6.0", "2.40", "C", "✓"],
        ]
        courses, _summaries, unparsed = test_ocr.parse_pages([self.page(rows)], {})
        absent = courses[0]
        self.assertEqual(unparsed, [])
        self.assertEqual(absent["issues"], [])
        self.assertEqual((absent["score_10"], absent["score_4"], absent["letter_grade"], absent["result"]), (None, None, "VT", "failed"))
        # A VT row with a number in the other score column is still flagged.
        mixed = test_ocr.parse_pages([self.page([rows[0], ["1", "71ENG110013", "Anh văn 1 (AV1)", "3", "VT", "2.40", "VT", "✗"]])], {})[0][0]
        self.assertEqual(mixed["issues"], ["incomplete_scores"])

    def test_vt_counts_zero_in_the_semester_gpa_check(self):
        import test_ocr

        rows = [
            ["Năm học: 2023-2024 - Học kỳ: HK01"],
            ["1", "71ENG110013", "Anh văn 1 (AV1)", "3", "VT", "VT", "VT", "✗"],
            ["2", "71ITBS10103", "Nhập môn công nghệ thông tin", "3", "6.0", "2.40", "C", "✓"],
            ["3", "71PEBB10032", "Bóng rổ", "2", "VT", "VT", "VT", "✗"],
            ["- Số tín chỉ đạt học kỳ: 3\n- Điểm TB học kỳ (Hệ 4): 1.20", "- Tổng số tín chỉ tích lũy: 3"],
        ]
        courses, summaries, _unparsed = test_ocr.parse_pages([self.page(rows)], {})
        [semester] = test_ocr.parse_semesters(summaries, courses)
        self.assertEqual(semester["computed_from_courses"]["semester_gpa_4"], 1.2)
        self.assertEqual(semester["issues"], [])

    def test_barred_ct_is_a_failed_attempt_without_a_score_counting_zero(self):
        import test_ocr

        # CT (cấm thi, user 2026-10-26) is read like VT: the semester GPA (0 × 3 + 2.72 × 3 + 2.52 × 3) / 9 = 1.75.
        rows = [
            ["Năm học: 2023-2024 - Học kỳ: HK01"],
            ["1", "71ENG310033", "Anh văn 3 (AV3)", "3", "CT", "CT", "CT", "✗"],
            ["2", "71ITSE30503", "Lập trình ứng dụng web", "3", "6.8", "2.72", "C+", "✓"],
            ["3", "71ITSE41003", "Nhập môn công nghệ phần mềm", "3", "6.3", "2.52", "C", "✓"],
            ["- Số tín chỉ đạt học kỳ: 6\n- Điểm TB học kỳ (Hệ 4): 1.75", "- Tổng số tín chỉ tích lũy: 6"],
        ]
        courses, summaries, unparsed = test_ocr.parse_pages([self.page(rows)], {})
        barred = courses[0]
        self.assertEqual(unparsed, [])
        self.assertEqual(barred["issues"], [])
        self.assertEqual((barred["score_10"], barred["score_4"], barred["letter_grade"], barred["result"]), (None, None, "CT", "failed"))
        [semester] = test_ocr.parse_semesters(summaries, courses)
        self.assertEqual(semester["computed_from_courses"]["semester_gpa_4"], 1.75)
        self.assertEqual(semester["issues"], [])

    def test_a_passing_mark_on_vt_conflicts_with_the_grade(self):
        import test_ocr

        rows = [["Năm học: 2023-2024 - Học kỳ: HK01"], ["1", "71PEBB10032", "Bóng rổ", "2", "VT", "VT", "VT", "✓"]]
        self.assertEqual(test_ocr.parse_pages([self.page(rows)], {})[0][0]["issues"], ["result_conflicts_with_grade"])

    def test_a_running_term_is_not_ranked(self):
        import test_ocr

        issues = []
        self.assertEqual(test_ocr.summary_value("KXL", "rank", None, issues, "semester_rank"), "kxl")
        self.assertEqual(issues, [])

    def test_a_digital_page_with_only_the_summary_box_is_read_as_text(self):
        import test_ocr

        class Table:
            bbox = (0, 0, 1, 1)

            @staticmethod
            def extract():
                return [["- Số tín chỉ đạt học kỳ:\n- Xếp loại học tập HK: KXL", "- Tổng số tín chỉ tích lũy: 109"]]

        class SummaryPage:
            rect = SimpleNamespace(width=595, height=842)

            def __init__(self, scanned):
                self.scanned = scanned

            @staticmethod
            def get_text():
                return "- Số tín chỉ đạt học kỳ:\n- Tổng số tín chỉ tích lũy: 109\n"

            @staticmethod
            def find_tables():
                return SimpleNamespace(tables=[Table()])

        with patch.object(test_ocr, "is_scanned", side_effect=lambda page: page.scanned):
            self.assertTrue(test_ocr.native_rows(SummaryPage(scanned=False))[1])
            # A scan with a text layer but no course codes still goes to OCR.
            self.assertFalse(test_ocr.native_rows(SummaryPage(scanned=True))[1])


class OldCourseCodeTests(TestCase):
    """K26 courses and the GDTC courses of K27/K28 carry the old code format (synthetic rows, no student data)."""

    def test_old_codes_are_course_rows_and_condition_courses_leave_the_gpa_check(self):
        import test_ocr

        rows = [
            ["Năm học: 2020-2021 - Học kỳ: HK01", None, None, None, None, None, None, None],
            ["1", "DIT0010", "Nhập môn lập trình", "3", "7.6", "3.00", "B", "Đạt"],
            ["2", "DGT0010", "Giáo dục thể chất 1 (*)", "1", "8.0", "3.50", "B+", "Đạt"],
            ["3", "71ITBS10103", "Nhập môn công nghệ thông tin", "3", "6.4", "2.00", "C", "Đạt"],
            ["- Số tín chỉ đạt học kỳ: 6\n- Điểm TB học kỳ (Hệ 4): 2.50", None, None, None, "- Tổng số tín chỉ tích lũy: 6", None, None, None],
        ]
        courses, summaries, unparsed = test_ocr.parse_pages([AdapterRuleTests.page(rows)], {})
        self.assertEqual(unparsed, [])
        self.assertEqual([(c["course_code"], c["issues"]) for c in courses], [("DIT0010", []), ("DGT0010", []), ("71ITBS10103", [])])
        # GDTC (DGT…) stays out of the semester GPA, as 71PE… does: (3 × 3.00 + 3 × 2.00) / 6 = 2.50.
        [semester] = test_ocr.parse_semesters(summaries, courses)
        self.assertEqual(semester["computed_from_courses"], {"semester_gpa_4": 2.5, "semester_credits_passed": 6})
        self.assertEqual(semester["issues"], [])

    def test_a_page_with_old_codes_counts_them_against_its_table_rows(self):
        import test_ocr

        rows = [["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"],
                ["2", "DGT0020", "Giáo dục thể chất 2 (*)", "1", "8.2", "3.50", "B+", "Đạt"]]

        class Table:
            bbox = (0, 0, 1, 1)

            @staticmethod
            def extract():
                return [list(row) for row in rows]

        class Page:
            @staticmethod
            def get_text():
                return "".join(" ".join(row) + "\n" for row in rows)

            @staticmethod
            def find_tables():
                return SimpleNamespace(tables=[Table()])

        with patch.object(test_ocr, "is_scanned", return_value=False):
            _rows, usable, expected = test_ocr.native_rows(Page())
        self.assertTrue(usable)
        self.assertEqual(expected, Counter({"DIT0070": 1, "DGT0020": 1}))


class CurriculumViewTests(TestCase):
    """The portal's "Xem điểm theo CTĐT" table is refused (user 2026-11-05); synthetic text only, no student data."""

    CTDT_HEADER = ["STT", "Mã học phần", "Tên học phần", "Số tín chỉ", "Môn\ntương\nđương", "Điểm", "Điểm chữ", "Kết quả"]
    SV_HEADER = ["STT", "Mã môn học", "Tên môn học", "Tín chỉ", "Điểm hệ 10", "Điểm hệ 4", "Điểm chữ", "Kết quả"]

    @staticmethod
    def document(text):
        class Page:
            number = 0

            @staticmethod
            def get_text():
                return text

            @staticmethod
            def get_image_info():
                return []

        class Document:
            is_pdf = True

            def __iter__(self):
                return iter([Page()])

        return Document()

    def test_the_text_layer_of_the_curriculum_view_is_refused(self):
        import test_ocr

        text = "Kết quả học tập\n" + "\n".join(self.CTDT_HEADER) + "\n2023-2024 / HK01\nBắt Buộc\n1\n71ITBS10103"
        with self.assertRaises(test_ocr.CurriculumViewError) as raised:
            test_ocr.extract_transcript(self.document(text), "synthetic.pdf", test_ocr.Options(mode="auto"), log=lambda _m: None)
        self.assertEqual(str(raised.exception), "curriculum_view")

    def test_a_scan_of_the_curriculum_view_is_refused_from_its_ocr_rows(self):
        import test_ocr

        rows = [self.CTDT_HEADER, ["1", "71ITBS10103", "Nhập môn công nghệ thông tin", "3", "", "3.20", "B+", ""]]
        with patch.object(test_ocr, "native_rows", return_value=([], False, Counter())), \
                patch.object(test_ocr, "_ppocr_page", return_value=(rows, [])):
            with self.assertRaises(test_ocr.CurriculumViewError):
                test_ocr.extract_transcript(self.document(""), "synthetic.pdf", test_ocr.Options(mode="auto"), log=lambda _m: None)

    def test_the_transcript_view_is_read_even_when_its_page_shows_the_radio_buttons(self):
        import test_ocr

        text = "Xem điểm SV\nXem điểm theo CTĐT\n" + "\n".join(self.SV_HEADER)
        self.assertFalse(test_ocr.is_curriculum_view([text]))
        rows = [self.SV_HEADER, ["Năm học: 2020-2021 - Học kỳ: HK01"], ["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"]]
        with patch.object(test_ocr, "native_rows", return_value=(rows, True, Counter())), \
                patch.object(test_ocr, "attach_result_marks", side_effect=lambda _page, found: found):
            result = test_ocr.extract_transcript(self.document(text), "synthetic.pdf", test_ocr.Options(mode="auto"), log=lambda _m: None)
        self.assertEqual(result["course_count"], 1)

    def test_the_worker_passes_the_refusal_to_the_server(self):
        import worker

        self.assertIn("curriculum_view", worker.PARSE_ERRORS)


class ServerRuleTests(TestCase):
    """worker.server_error follows apps/api/src/student/ocr-adapter.ts (synthetic rows, no student data)."""

    @staticmethod
    def result(rows):
        import test_ocr

        courses, summaries, unparsed = test_ocr.parse_pages([AdapterRuleTests.page(rows)], {})
        return {"schema_version": "1.1", "adapter": "vlu_8_columns", "course_count": len(courses), "needs_review": False,
                "pages": [{"page": 1, "method": "pdf_text", "warnings": []}], "courses": courses,
                "semesters": test_ocr.parse_semesters(summaries, courses), "summaries": summaries, "unparsed_rows": unparsed}

    HEADER = ["Năm học: 2020-2021 - Học kỳ: HK01"]

    def test_old_codes_import(self):
        import worker

        rows = [self.HEADER, ["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"]]
        self.assertIsNone(worker.server_error(self.result(rows)))

    def test_an_unknown_mark_is_kept_for_review(self):
        import worker

        result = self.result([self.HEADER, ["1", "DIT0070", "Cơ sở dữ liệu", "3", "", "", "P", "Đạt"]])
        self.assertIsNone(worker.server_error(result))
        self.assertEqual(result["courses"][0]["issues"], ["unrecognized_letter_grade"])

    def test_a_new_code_or_a_cell_that_is_not_a_number_is_kept_for_review(self):
        import worker

        rows = [self.HEADER, ["1", "DIT00701", "Môn mã mới", "3", "7,8x", "3.00", "B", "Đạt"]]
        result = self.result(rows)
        self.assertIsNone(worker.server_error(result))
        self.assertEqual(result["courses"][0]["issues"], ["invalid_course_code", "invalid_score_10", "incomplete_scores"])

    def test_a_row_before_any_term_is_kept(self):
        import worker

        result = self.result([["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"]])
        self.assertEqual((dict(worker.schema_problems(result)[0]), worker.server_error(result)), ({}, None))

    def test_a_broken_contract_or_no_course_row_is_refused(self):
        import worker

        result = self.result([self.HEADER, ["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"]])
        self.assertEqual(worker.server_error({**result, "course_count": 2}), "invalid_ocr_result")
        self.assertEqual(worker.server_error({**result, "courses": [{**result["courses"][0], "ordinal": "1"}]}), "invalid_ocr_result")
        self.assertEqual(worker.server_error({**result, "courses": [], "course_count": 0}), "unsupported_layout")

    def test_masked_values_keep_only_the_form(self):
        import worker

        self.assertEqual(worker.mask("71ITBS1O103"), "99AAAA9A999")
        self.assertEqual(worker.mask("Lê Văn 9,5"), "Aa Aaa 9,9")


COLUMNS = [89, 151, 325, 645, 759, 838, 915, 1044, 1155]  # the eight VLU columns at 150 DPI


def ruled_page(borders, verticals, columns=COLUMNS, height=1754, width=1241):
    """A white RGB page with full-width borders and column rulings from verticals[0] to verticals[1] (synthetic)."""
    import numpy as np

    image = np.full((height, width, 3), 255, np.uint8)
    for y in borders:
        image[y - 1:y + 1, columns[0]:columns[-1] + 1] = 90
    for x in columns:
        image[verticals[0]:verticals[1], x - 1:x + 1] = 90
    return image


def line(cell, top, bottom, text, columns=COLUMNS):
    """A recognised text line inside a column (synthetic)."""
    return {"box": [columns[cell] + 5, top, columns[cell + 1] - 5, bottom], "text": text, "score": 0.99}


class PageBreakBandTests(TestCase):
    """Rows a page break leaves without a closing border (synthetic rulings, no student data)."""

    BORDERS = [300, 350, 400, 450]

    def test_the_last_row_of_a_page_without_a_bottom_border_is_a_band(self):
        from ppocr_table import table_bands

        bands, warnings = table_bands(ruled_page(self.BORDERS, (300, 506)))
        self.assertEqual(warnings, [])
        self.assertEqual([(b["top"], b["bottom"], len(b["cells"])) for b in bands][-1], (450, 506, 8))
        self.assertEqual(len(bands), 4)

    def test_ruling_stubs_at_a_page_edge_are_no_row(self):
        from ppocr_table import table_bands

        # The cut leaves ~7 px of rulings above the first border and below the last one.
        bands, _ = table_bands(ruled_page([60, 110, 160], (53, 167)))
        self.assertEqual([(b["top"], b["bottom"]) for b in bands], [(60, 110), (110, 160)])

    def test_the_first_row_of_a_page_without_a_top_border_is_a_band_near_the_top_only(self):
        from ppocr_table import table_bands

        bands, _ = table_bands(ruled_page([120, 170, 220], (60, 220)))
        self.assertEqual([(b["top"], b["bottom"], len(b["cells"])) for b in bands][0], (60, 120, 8))
        # Rulings above a first border lower on the page belong to another box: no band.
        bands, _ = table_bands(ruled_page([900, 950, 1000], (700, 1000)))
        self.assertEqual([(b["top"], b["bottom"]) for b in bands], [(900, 950), (950, 1000)])

    def test_the_final_box_with_a_border_too_light_to_find_is_a_band(self):
        from ppocr_table import table_bands

        image = ruled_page(self.BORDERS, (300, 450))
        image[450:600, 758:760] = 90  # the summary box: one ruling between its halves, no bottom border
        bands, _ = table_bands(image)
        self.assertEqual([(b["top"], b["bottom"], len(b["cells"])) for b in bands][-1], (450, 600, 2))

    def test_the_text_of_an_open_row_is_read_and_the_page_number_below_is_not(self):
        from ppocr_table import rows_from_lines

        lines = [line(0, 410, 440, "7"), line(1, 410, 440, "71NAD310032"), line(2, 410, 440, "GDQP3: Quân sự chung"),
                 line(0, 465, 495, "8"), line(1, 465, 495, "71NAD410044"), line(2, 458, 478, "GDQP4: Kỹ thuật chiến đấu bộ binh"),
                 line(2, 482, 502, "và chiến thuật"), line(3, 465, 495, "4"), line(6, 465, 495, "B+"),
                 {"box": [1120, 1700, 1160, 1720], "text": "1/2", "score": 0.99}]
        rows, _warnings, read = rows_from_lines(ruled_page(self.BORDERS, (300, 506)), lines)
        self.assertEqual(rows[-1][:4], ["8", "71NAD410044", "GDQP4: Kỹ thuật chiến đấu bộ binh\nvà chiến thuật", "4"])
        self.assertEqual(read[-1]["cell"], "outside_table")

    def test_a_line_centred_on_a_ruling_goes_to_the_band_holding_most_of_it(self):
        from ppocr_table import rows_from_lines

        # Centre exactly on the border at 350, half the box in each row: it is kept, in the first of the two.
        lines = [line(1, 320, 345, "71ENG110013"), line(2, 320, 380, "Anh văn 1"), line(1, 360, 390, "71ITBS10103")]
        rows, _warnings, _read = rows_from_lines(ruled_page(self.BORDERS, (300, 450)), lines)
        self.assertEqual([row[1:3] for row in rows], [["71ENG110013", "Anh văn 1"], ["71ITBS10103", ""]])


class PageBreakRowTests(TestCase):
    """Course rows cut or repeated by a page break (synthetic rows, no student data)."""

    TERM = ["Năm học: 2024-2025 - Học kỳ: HK03"]

    @staticmethod
    def pages(*rows):
        return [AdapterRuleTests.page(list(page_rows), number) for number, page_rows in enumerate(rows, 1)]

    def test_the_rest_of_a_cut_row_joins_the_row_above_the_break(self):
        import test_ocr

        pages = self.pages(
            [self.TERM, ["8", "71NAD410044", "GDQP4: Kỹ thuật chiến đấu bộ binh", "4", "8", "3.20", "B+", "✓"]],
            [["", "", "và chiến thuật", "", "", "", "", ""], ["9", "71POLE10022", "Kinh tế chính trị Mác-Lênin", "2", "6.5", "2.60", "C+", "✓"]])
        courses, _summaries, unparsed = test_ocr.parse_pages(pages, {})
        self.assertEqual(unparsed, [])
        self.assertEqual([(c["ordinal"], c["course_code"], c["course_name"], c["issues"]) for c in courses], [
            (8, "71NAD410044", "GDQP4: Kỹ thuật chiến đấu bộ binh và chiến thuật", []),
            (9, "71POLE10022", "Kinh tế chính trị Mác-Lênin", [])])

    def test_the_first_line_of_a_cut_row_joins_the_row_below_the_break(self):
        import test_ocr

        pages = self.pages([self.TERM, ["", "", "GDQP4: Kỹ thuật chiến đấu bộ binh", "", "", "", "", ""]],
                           [["8", "71NAD410044", "và chiến thuật", "4", "8", "3.20", "B+", "✓"]])
        courses, _summaries, unparsed = test_ocr.parse_pages(pages, {})
        self.assertEqual(unparsed, [])
        self.assertEqual([(c["course_name"], c["source_page"]) for c in courses], [("GDQP4: Kỹ thuật chiến đấu bộ binh và chiến thuật", 2)])

    def test_a_row_printed_again_after_the_break_is_kept_once(self):
        import test_ocr

        row = ["8", "71NAD410044", "GDQP4: Kỹ thuật chiến đấu bộ binh và chiến thuật", "4", "8", "3.20", "B+", "✓"]
        pages = self.pages([self.TERM, row[:4] + ["", "", "", ""]], [row, ["9", "71POLE10022", "Kinh tế chính trị Mác-Lênin", "2", "6.5", "2.60", "C+", "✓"]])
        courses, _summaries, _unparsed = test_ocr.parse_pages(pages, {})
        self.assertEqual([(c["ordinal"], c["letter_grade"]) for c in courses], [(8, "B+"), (9, "C+")])

    def test_summary_lines_and_titles_at_a_break_stay_as_they_are(self):
        import test_ocr

        pages = self.pages([self.TERM, ["1", "71ENG310033", "Anh văn 3 (AV3)", "3", "5.4", "2.16", "D", "✓"]],
                           [["- Số tín chỉ đạt học kỳ: 3", "- Tổng số tín chỉ tích lũy: 3"], ["Năm học: 2025-2026 - Học kỳ: HK01"]])
        courses, summaries, unparsed = test_ocr.parse_pages(pages, {})
        self.assertEqual((len(courses), len(summaries), unparsed), (1, 1, []))


class SummaryLineTests(TestCase):
    """Summary boxes printed with fields run together (synthetic values, no student data)."""

    def test_fields_on_one_line_a_label_over_two_lines_and_dashes_apart_are_split(self):
        import test_ocr

        self.assertEqual(test_ocr.summary_lines("- Số tín chỉ đạt học kỳ: 14\n- Điểm TB học kỳ (Hệ 4): 2.46 - Xếp loại học tập\nHK: Trung bình - Điểm rèn luyện học kỳ:"),
                         "- Số tín chỉ đạt học kỳ: 14\n- Điểm TB học kỳ (Hệ 4): 2.46\n- Xếp loại học tập HK: Trung bình\n- Điểm rèn luyện học kỳ:")
        self.assertEqual(test_ocr.summary_lines("Số tín chỉ đạt học kỳ: 9\n-\nĐiểm TB học kỳ (Hệ 4): 1.90 - Xếp loại học tập HK: Yếu\nĐiểm rèn luyện học kỳ:"),
                         "- Số tín chỉ đạt học kỳ: 9\n- Điểm TB học kỳ (Hệ 4): 1.90\n- Xếp loại học tập HK: Yếu\n- Điểm rèn luyện học kỳ:")
        # A value wrapped to the next line stays with its label; a box printed one field per line is unchanged.
        self.assertEqual(test_ocr.summary_lines("- Xếp loại học tập tích lũy: Trung\nbình"), "- Xếp loại học tập tích lũy: Trung bình")
        box = "- Tổng số tín chỉ đăng ký: 42\n- Điểm TB học tập (Hệ 4): 2.49"
        self.assertEqual(test_ocr.summary_lines(box), box)

    def test_a_run_together_box_checks_against_its_courses(self):
        import test_ocr

        rows = [["Năm học: 2024-2025 - Học kỳ: HK03"],
                ["1", "71ENG310033", "Anh văn 3 (AV3)", "3", "5.4", "2.00", "D", "✓"],
                ["2", "71ITSE30303", "Cấu trúc dữ liệu và giải thuật", "3", "6.7", "3.00", "C+", "✓"],
                ["Số tín chỉ đạt học kỳ: 6\nĐiểm TB học kỳ (Hệ 4): 2.50 - Xếp loại học tập\nHK: Trung bình - Điểm rèn luyện học kỳ:",
                 "- Tổng số tín chỉ tích lũy: 6"]]
        courses, summaries, _unparsed = test_ocr.parse_pages([AdapterRuleTests.page(rows)], {})
        [semester] = test_ocr.parse_semesters(summaries, courses)
        self.assertEqual(semester["issues"], [])
        self.assertEqual((semester["semester_gpa_4"], semester["semester_rank"]), (2.5, "Trung bình"))
        self.assertIn("- Xếp loại học tập HK: Trung bình", summaries[0]["raw_cells"][0].split("\n"))


if __name__ == "__main__":
    import unittest

    unittest.main()
