"""Checks of gemma_ocr.RowBuilder and its rows through test_ocr.parse_pages, on synthetic items only (no network).

Run: python -I -m unittest test_gemma_ocr  (from services/ocr)
"""
import unittest

import gemma_ocr
from test_ocr import parse_pages, parse_semesters


def course(stt, code, name='Môn thử', credits='3', score10='8.0', score4='3.5', letter='B+', result='passed'):
    return {'kind': 'course', 'stt': stt, 'code': code, 'name': name, 'credits': credits, 'score10': score10,
            'score4': score4, 'letter': letter, 'result': result}


TERM1 = {'kind': 'term', 'year': '2023-2024', 'semester': 1}
SUMMARY1 = {'kind': 'summary', 'fields': {'so_tin_chi_dat_hoc_ky': '6', 'diem_tb_hoc_ky_he_4': '3.50'}}
SUMMARY1_REST = {'kind': 'summary', 'fields': {'xep_loai_hoc_ky': 'Giỏi', 'diem_tb_hoc_ky_he_4': '3.50'}}


class RowBuilderTest(unittest.TestCase):
    def test_overlapping_strips_keep_each_row_once_and_merge_the_summary_box(self):
        # Strip 1 ends with course 2 and half the summary box; strip 2 starts with them again (the overlap).
        strip1 = [{'kind': 'header', 'text': 'STT Mã môn Tên môn'}, TERM1, course('1', '71ITBS10103'), course('2', '71ITBS10203'), SUMMARY1]
        strip2 = [course('2', '71ITBS10203'), SUMMARY1_REST, {'kind': 'term', 'year': '2023 - 2024', 'semester': '2'},
                  course('1', '71ITBS10303', letter='F', score10='3.0', score4='0.0', result='failed')]
        builder = gemma_ocr.RowBuilder()
        rows = builder.rows(strip1 + strip2)
        self.assertEqual([row[0].split('\n')[0] for row in rows], [
            'Năm học 2023-2024 - HK1', '1', '2', '- Số tín chỉ đạt học kỳ: 6', 'Năm học 2023-2024 - HK2', '1'])
        self.assertEqual(rows[3][0], '- Số tín chỉ đạt học kỳ: 6\n- Điểm TB học kỳ (Hệ 4): 3.50\n- Xếp loại học tập HK: Giỏi')
        self.assertEqual(rows[1], ['1', '71ITBS10103', 'Môn thử', '3', '8.0', '3.5', 'B+', '✓'])
        self.assertEqual(rows[5][7], '✗')
        self.assertEqual(builder.headers, ['STT Mã môn Tên môn'])

    def test_rows_parse_like_the_text_layer(self):
        rows = gemma_ocr.RowBuilder().rows([TERM1, course('1', '71ITBS10103'), course('2', '71ITBS10203'), SUMMARY1, SUMMARY1_REST])
        courses, summaries, unparsed = parse_pages([{'page': 1, 'method': 'gemma', 'warnings': [], 'rows': rows}], {})
        self.assertEqual(unparsed, [])
        self.assertEqual([(c['academic_year'], c['semester'], c['course_code'], c['score_4'], c['result']) for c in courses],
                         [('2023-2024', 'HK01', '71ITBS10103', 3.5, 'passed'), ('2023-2024', 'HK01', '71ITBS10203', 3.5, 'passed')])
        semester = parse_semesters(summaries, courses)[0]
        self.assertEqual((semester['semester_credits_passed'], semester['semester_gpa_4'], semester['semester_rank']), (6, 3.5, 'Giỏi'))
        self.assertFalse(semester['needs_review'])

    def test_a_made_up_row_breaks_the_printed_term_totals(self):
        # The box says 6 credits passed at 3,50; an extra row Gemma invented makes the term disagree with it.
        rows = gemma_ocr.RowBuilder().rows([TERM1, course('1', '71ITBS10103'), course('2', '71ITBS10203'),
                                            course('3', '71ITBS10403', letter='C', score4='2.0'), SUMMARY1])
        courses, summaries, _ = parse_pages([{'page': 1, 'method': 'gemma', 'warnings': [], 'rows': rows}], {})
        semester = parse_semesters(summaries, courses)[0]
        self.assertIn('semester_gpa_4_mismatch', semester['issues'])
        self.assertIn('semester_credits_passed_mismatch', semester['issues'])

    def test_drops_empty_rows_dashes_unknown_terms_and_other_sections(self):
        rows = gemma_ocr.RowBuilder().rows([
            {'kind': 'term', 'year': None, 'text': 'Học kỳ', 'semester': None}, {'kind': 'course', 'stt': '1'},
            {'kind': 'section', 'text': 'Ghi chú'}, {'kind': 'section', 'text': 'Điểm bảo lưu'},
            course('1', 'DIT0070', score10='-', score4='—', letter='MT', result=None)])
        self.assertEqual(rows, [['Điểm bảo lưu'] + [''] * 7, ['1', 'DIT0070', 'Môn thử', '3', '', '', 'MT', '']])

    def test_reads_the_json_of_an_answer_in_a_fence_or_with_words_around(self):
        self.assertEqual(gemma_ocr.json_text('```json\n{"items": []}\n```'), '{"items": []}')
        self.assertEqual(gemma_ocr.json_text('Đây là kết quả: {"items": [1]} xong'), '{"items": [1]}')
        with self.assertRaises(gemma_ocr.GemmaOcrError):
            gemma_ocr.json_text('không có JSON')


if __name__ == '__main__':
    unittest.main()
