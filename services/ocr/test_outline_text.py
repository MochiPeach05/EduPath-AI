"""Checks of outline_text.py on fixtures/outline_transcript.pdf: a made-up transcript (fixtures/outline_transcript.html)
as a printer driver writes it, every character a vector outline, no text layer (outline_build.py simulate). No network.

Run: python -m unittest test_outline_text  (from services/ocr; needs PyMuPDF, numpy and OpenCV)
"""
from pathlib import Path
import unittest

import numpy as np
import pymupdf

import outline_text
from test_ocr import OcrRequired, Options, extract_transcript

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'outline_transcript.pdf'
COURSES = [
    # section, year, term, number, code, name, credits, hệ 10, hệ 4, letter, result
    ('credit_transfer', None, None, 1, '71ENG710080', 'Đánh giá năng lực tiếng Anh đầu ra', 0, None, None, 'MT', None),
    ('semester', '2023-2024', 'HK01', 1, '71ITBS10103', 'Nhập môn công nghệ thông tin', 3, 8.6, 3.44, 'A', 'passed'),
    ('semester', '2023-2024', 'HK01', 2, '71ITBS10203', 'Cơ sở lập trình', 3, 6.2, 2.48, 'C', 'passed'),
    ('semester', '2023-2024', 'HK01', 3, '71ENG110013', 'Anh văn 1 (AV1)', 3, 2.6, 1.04, 'F', 'failed'),
    ('semester', '2023-2024', 'HK01', 4, '71NAD110013', 'GDQP1: Đường lối QP và AN của ĐCSVN', 3, 7.8, 3.12, 'B', 'passed'),
    ('semester', '2023-2024', 'HK01', 5, '71ITIL20103', 'Internet vạn vật (IoT) và trí tuệ nhân tạo (AI)', 3, 9.0, 3.6, 'A+', 'passed'),
    ('semester', '2023-2024', 'HK02', 1, '71ITSE30403', 'Thiết kế đồ họa với Adobe Illustrator', 3, 7.0, 2.8, 'B', 'passed'),
    ('semester', '2023-2024', 'HK02', 2, '71ITDS30203', 'Giải thuật (Algorithm) và các APIs', 3, 5.0, 2.0, 'D+', 'passed'),
    ('semester', '2023-2024', 'HK02', 3, '71LAWG10012', 'Pháp luật đại cương', 2, None, None, 'VT', 'failed'),
    ('semester', '2023-2024', 'HK02', 4, 'DIT0070', 'Tiếng Anh IELTS II', 3, 8.0, 3.2, 'B+', 'passed'),
    ('semester', '2023-2024', 'HK02', 5, '71SSK110023', 'Kỹ năng làm việc nhóm với Excel', 3, 6.9, 2.76, 'C+', 'passed'),
    ('semester', '2024-2025', 'HK01', 1, '71ITAI40103', 'Học máy và ứng dụng', 3, None, None, None, None),
]


def read(document):
    return extract_transcript(document, 'outline.pdf', Options(ocr_enabled=False), log=lambda _: None)


def word(text):
    """The glyphs of a word as _bar_by_letters takes them: I and l are bars still to be told apart."""
    return [{'char': c, 'bars': {'I': {}, 'l': {}} if c in 'Il' else None} for c in text]


class OutlinePageTest(unittest.TestCase):
    def test_the_page_has_no_text_layer_and_is_no_scan(self):
        with pymupdf.open(FIXTURE) as document:
            page = document[0]
            self.assertEqual(page.get_text().strip(), '')
            self.assertEqual(page.get_fonts(), [])
            self.assertGreater(len(page.get_drawings()), 1000)

    def test_a_printed_transcript_is_read_exactly_without_ocr(self):
        # Options(ocr_enabled=False) is the API's text-only pass: a page that needed OCR would raise OcrRequired.
        with pymupdf.open(FIXTURE) as document:
            result = read(document)
        self.assertEqual([(p['method'], p['warnings']) for p in result['pages']], [('pdf_outline', [])])
        self.assertIsNone(result['ocr_settings'])
        self.assertFalse(result['needs_review'])
        self.assertEqual(result['unparsed_rows'], [])
        self.assertEqual([(c['section'], c['academic_year'], c['semester'], c['ordinal'], c['course_code'], c['course_name'], c['credits'],
                           c['score_10'], c['score_4'], c['letter_grade'], c['result']) for c in result['courses']], COURSES)
        self.assertEqual([c['issues'] for c in result['courses']], [[] for _ in COURSES])

    def test_the_summary_boxes_are_read_and_agree_with_the_rows(self):
        with pymupdf.open(FIXTURE) as document:
            terms = read(document)['semesters']
        first, second, running = terms
        self.assertEqual((first['academic_year'], first['semester'], first['semester_credits_passed'], first['semester_gpa_4'], first['semester_gpa_10'],
                          first['semester_rank'], first['conduct_score'], first['registered_credits_total'], first['cumulative_gpa_4'], first['cumulative_rank']),
                         ('2023-2024', 'HK01', 9, 2.64, 6.6, 'Khá', 85, 12, 3.17, 'Khá'))
        self.assertEqual((second['semester'], second['semester_credits_passed'], second['semester_gpa_4'], second['semester_rank'], second['conduct_score'],
                          second['cumulative_credits']), ('HK02', 12, 2.31, 'Trung bình', 78, 21))
        self.assertEqual((running['academic_year'], running['semester_rank_code'], running['registered_credits_total']), ('2024-2025', 'unranked', 29))
        # The printed term GPA and credits equal what the rows give: no reading of a score or a credit is off.
        self.assertEqual([term['issues'] for term in terms], [[], [], []])

    def test_every_path_of_the_page_is_a_character_on_a_600_dpi_grid(self):
        with pymupdf.open(FIXTURE) as document:
            page = outline_text.read_page(document[0])
        self.assertAlmostEqual(page['unit'], 0.12)
        self.assertEqual(page['undecided'], [])
        self.assertEqual([g for g in page['decoded'] if g['unsure']], [])
        # The table's 13 px and the heading's 14 px.
        self.assertEqual([round(size * 2048, 1) for size in page['sizes']], [9.8, 10.5])
        texts = {phrase['text'] for phrase in page['phrases']}
        self.assertTrue({'71ITIL20103', 'DIT0070', 'Năm học: 2023-2024 - Học kỳ: HK02', '- Xếp loại học tập HK: Trung bình', 'Mã môn học'} <= texts)

    def test_an_unknown_shape_in_the_table_leaves_the_page_to_ocr(self):
        # A path that is no Arial glyph, inside a course name: the page is not guessed at.
        with pymupdf.open(FIXTURE) as document:
            page = document[0]
            page.draw_polyline([(250, 205), (256, 198), (259, 207), (253, 203)], color=None, fill=(0, 0, 0), closePath=True)
            self.assertEqual(outline_text.text_pages(document, [0])[1], {})
            with self.assertRaises(OcrRequired):
                read(document)

    def test_an_unknown_shape_outside_the_table_does_not_matter(self):
        # The header and footer a browser prints are in another font; a logo is a picture.
        with pymupdf.open(FIXTURE) as document:
            page = document[0]
            page.draw_polyline([(300, 12), (306, 5), (309, 14), (303, 10)], color=None, fill=(0, 0, 0), closePath=True)
            self.assertEqual([p['method'] for p in read(document)['pages']], ['pdf_outline'])

    def test_a_page_without_outlines_is_not_read_here(self):
        document = pymupdf.open()
        page = document.new_page()
        page.insert_image(page.rect, pixmap=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 80), False))
        with self.assertRaises(outline_text.OutlineError):
            outline_text.read_page(page)
        self.assertEqual(outline_text.text_pages(document, [0])[1], {})


class BarTest(unittest.TestCase):
    def test_the_letters_of_the_word_tell_a_capital_i_from_a_small_l(self):
        cases = {'71ITBS10103': 'I', 'DIT0070': 'I', 'II': 'II', 'AI': 'I', 'IELTS': 'I', 'lập': 'l', 'luật': 'l', 'loại': 'l', 'Excel': 'l',
                 'việc': None, 'Internet': 'I', 'Illustrator': 'Ill', 'Algorithm': 'l', 'Flutter': 'l', 'APIs': 'I', '(IoT)': 'I', 'I': 'I'}
        for text, expected in cases.items():
            glyphs = word(text)
            got = ''.join(outline_text._bar_by_letters(glyphs, index)[0] for index, glyph in enumerate(glyphs) if glyph['bars'])
            self.assertEqual(got, expected or '', text)

    def test_a_word_of_capitals_and_a_small_letter_before_the_bar_leave_no_doubt(self):
        self.assertEqual(outline_text._bar_by_letters(word('71ITBS10103'), 2), ('I', True))
        self.assertEqual(outline_text._bar_by_letters(word('Excel'), 4), ('l', True))
        self.assertEqual(outline_text._bar_by_letters(word('lập'), 0), ('l', False))


class MarkTest(unittest.TestCase):
    @staticmethod
    def picture(passed, colour):
        import cv2
        image = np.full((60, 120, 3), 255, np.uint8)
        lines = [((40, 32), (52, 46)), ((52, 46), (78, 14))] if passed else [((42, 12), (78, 48)), ((78, 12), (42, 48))]
        for start, end in lines:
            cv2.line(image, start, end, colour, 7, cv2.LINE_AA)
        return image

    def test_a_mark_is_read_by_its_colour(self):
        self.assertEqual(outline_text.cell_mark(self.picture(True, (0, 150, 0))), '✓')
        self.assertEqual(outline_text.cell_mark(self.picture(False, (205, 0, 0))), '✗')

    def test_a_mark_printed_without_colours_is_read_by_its_shape(self):
        # A black and white print (2026-11-13: one stored transcript): the tick and the cross are grey.
        self.assertEqual(outline_text.cell_mark(self.picture(True, (120, 120, 120))), '✓')
        self.assertEqual(outline_text.cell_mark(self.picture(False, (120, 120, 120))), '✗')

    def test_colour_and_shape_that_disagree_and_other_pictures_are_unknown(self):
        self.assertEqual(outline_text.cell_mark(self.picture(False, (0, 150, 0))), '?')
        blot = np.full((60, 120, 3), 255, np.uint8)
        blot[10:50, 30:60] = 90
        blot[10:30, 60:90] = 90
        self.assertEqual(outline_text.cell_mark(blot), '?')
        self.assertEqual(outline_text.cell_mark(np.full((60, 120, 3), 255, np.uint8)), '')


if __name__ == '__main__':
    unittest.main()
