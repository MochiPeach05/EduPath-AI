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

    def test_an_unknown_mark_is_refused_and_logged_as_printed(self):
        import worker

        result = self.result([self.HEADER, ["1", "DIT0070", "Cơ sở dữ liệu", "3", "", "", "P", "Đạt"]])
        self.assertEqual(worker.server_error(result), "invalid_ocr_result")
        count, values = worker.schema_problems(result)
        self.assertEqual((dict(count), values), ({"letter_grade": 1}, {"letter_grade": {"P"}}))

    def test_a_flagged_row_is_refused_as_unreadable_grades(self):
        import worker

        rows = [self.HEADER, ["1", "DIT0070", "Cơ sở dữ liệu", "3", "7,8x", "3.00", "B", "Đạt"]]
        self.assertEqual(worker.server_error(self.result(rows)), "unreadable_grades")

    def test_a_row_before_any_term_is_refused_as_invalid(self):
        import worker

        count, values = worker.schema_problems(self.result([["1", "DIT0070", "Cơ sở dữ liệu", "3", "7.8", "3.00", "B", "Đạt"]]))
        self.assertEqual(values, {"section": {"unknown"}})

    def test_masked_values_keep_only_the_form(self):
        import worker

        self.assertEqual(worker.mask("71ITBS1O103"), "99AAAA9A999")
        self.assertEqual(worker.mask("Lê Văn 9,5"), "Aa Aaa 9,9")


if __name__ == "__main__":
    import unittest

    unittest.main()
