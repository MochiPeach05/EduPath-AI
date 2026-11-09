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
    def test_strips_in_reading_order_make_one_row_each_and_one_summary_box(self):
        # Strips end on the table's borders: a box read in two pieces (left and right cells) is one box; a course row
        # Gemma wrote twice in a row is kept once; the next term's title starts the next term.
        strip1 = [{'kind': 'header', 'text': 'STT Mã môn Tên môn'}, TERM1, course('1', '71ITBS10103'), course('2', '71ITBS10203'),
                  course('2', '71ITBS10203'), SUMMARY1, SUMMARY1_REST]
        strip2 = [{'kind': 'term', 'year': '2023 - 2024', 'semester': '2'}, course('1', '71ITBS10303', letter='F', score10='3.0', score4='0.0', result='failed')]
        builder = gemma_ocr.RowBuilder()
        rows = builder.rows(strip1 + strip2)
        self.assertEqual([row[0].split('\n')[0] for row in rows], [
            'Năm học 2023-2024 - HK1', '1', '2', '- Số tín chỉ đạt học kỳ: 6', 'Năm học 2023-2024 - HK2', '1'])
        self.assertEqual(rows[3][0], '- Số tín chỉ đạt học kỳ: 6\n- Điểm TB học kỳ (Hệ 4): 3.50\n- Xếp loại học tập HK: Giỏi')
        self.assertEqual(rows[1], ['1', '71ITBS10103', 'Môn thử', '3', '8.0', '3.5', 'B+', '✓'])
        self.assertEqual(rows[5][7], '✗')
        self.assertEqual(builder.headers, ['STT Mã môn Tên môn'])
        self.assertEqual(builder.page_warnings, [])

    def test_a_term_title_gemma_missed_becomes_the_next_term_and_is_flagged(self):
        # After the box of HK3 2025-2026 the rows start again without a title: they belong to HK1 2026-2027.
        builder = gemma_ocr.RowBuilder()
        first = builder.rows([{'kind': 'term', 'year': '2025-2026', 'semester': 3}, course('1', '71ITIS30103'), SUMMARY1])
        self.assertEqual(builder.page_warnings, [])
        second = builder.rows([course('1', '71ITIS30403'), course('2', '71ITIS30503')])
        self.assertEqual([row[0] for row in second], ['Năm học 2026-2027 - HK1', '1', '2'])
        self.assertEqual(builder.page_warnings, ['term_title_inferred'])
        # Numbers starting again at 1 without a box in between: the same.
        builder = gemma_ocr.RowBuilder()
        rows = builder.rows([TERM1, course('1', 'A1'), course('2', 'A2'), course('1', 'B1')])
        self.assertEqual([row[0] for row in rows], ['Năm học 2023-2024 - HK1', '1', '2', 'Năm học 2023-2024 - HK2', '1'])
        self.assertEqual(first[0][0], 'Năm học 2025-2026 - HK3')

    def test_a_repeated_number_with_another_code_is_kept_for_the_server_to_mark(self):
        rows = gemma_ocr.RowBuilder().rows([TERM1, course('1', '71ITBS10103'), course('2', '71ITBS10203'), course('2', '71ITBS99999')])
        self.assertEqual([row[1] for row in rows[1:]], ['71ITBS10103', '71ITBS10203', '71ITBS99999'])

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

    def test_summary_lines_of_both_boxes_by_their_printed_labels(self):
        # Gemma copies each line "Nhãn: giá trị"; a misread letter in a label, a label written twice, an unknown line.
        item = {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ: 18', 'Điểm TB hoc ky (Hệ 4): 2.33', 'Xếp loại học tập HK: Xếp loại học tập HK: Yếu',
                                            'Tổng số tín chỉ tích lũy: 54', 'Ghi chú: không rõ'], 'name': 'Số tín chỉ đạt học kỳ: 99'}
        rows = gemma_ocr.RowBuilder().rows([TERM1, item])
        self.assertEqual(rows[1][0].split('\n'), ['- Số tín chỉ đạt học kỳ: 18', '- Điểm TB học kỳ (Hệ 4): 2.33',
                                                  '- Xếp loại học tập HK: Yếu', '- Tổng số tín chỉ tích lũy: 54'])

    def test_deskew_straightens_a_table_tilted_by_half_a_degree(self):
        import cv2
        import numpy as np
        page = np.full((1200, 1600, 3), 255, np.uint8)
        for y in range(100, 1100, 50):
            cv2.line(page, (100, y), (1500, y), (0, 0, 0), 2)
        tilted = cv2.warpAffine(page, cv2.getRotationMatrix2D((800, 600), 0.6, 1.0), (1600, 1200), borderValue=(255, 255, 255))
        def peak(image):
            ink = (cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) < 128).sum(axis=1)
            return int(ink.max())
        self.assertGreater(peak(gemma_ocr.deskew(tilted)), 2 * peak(tilted))
        self.assertIs(gemma_ocr.deskew(page), page)

    def test_a_strip_missing_course_rows_is_read_again_and_the_fullest_answer_kept(self):
        answers = [[{'kind': 'header', 'text': '1 71ITBS10103 ... 2 71ITBS10203 ...'}],
                   [course('1', '71ITBS10103')], [course('1', '71ITBS10103'), course('2', '71ITBS10203')]]
        calls = []
        def read(jpeg):
            calls.append(jpeg)
            return answers[len(calls) - 1]
        items = gemma_ocr.read_checked(read, b'jpeg', rows=2, first=False)
        self.assertEqual(len(calls), 3)
        self.assertEqual([item['code'] for item in items], ['71ITBS10103', '71ITBS10203'])
        # The first strip of a page may count the column header as an eight-cell row: one course row less is enough.
        calls.clear()
        answers[:] = [[course('1', '71ITBS10103')]]
        gemma_ocr.read_checked(read, b'jpeg', rows=2, first=True)
        self.assertEqual(len(calls), 1)

    def test_a_code_with_one_look_alike_character_gets_its_form_back(self):
        self.assertEqual(gemma_ocr.fixed_code('71P0LE10022'), '71POLE10022')
        self.assertEqual(gemma_ocr.fixed_code('71ITBS1O103'), '71ITBS10103')
        self.assertEqual(gemma_ocr.fixed_code('D1T0070'), 'DIT0070')
        # Right already, or no single change makes it right: left as read (the server marks it).
        self.assertEqual(gemma_ocr.fixed_code('71ITBS10103'), '71ITBS10103')
        self.assertEqual(gemma_ocr.fixed_code('ABC'), 'ABC')
        rows = gemma_ocr.RowBuilder().rows([TERM1, course('1', '71P0LE 10022')])
        self.assertEqual(rows[1][1], '71POLE10022')

    def test_a_reader_that_cannot_take_the_work_now_is_busy_not_a_bad_pdf(self):
        import worker
        for reason in ('daily_limit', 'unreachable', 'http_401', 'http_429', 'http_503', 'cloudflare_not_configured'):
            self.assertEqual(worker.gemma_error(reason), 'ocr_busy')
        for reason in ('table_not_found', 'not_json', 'truncated', 'http_400', 'image_failed'):
            self.assertEqual(worker.gemma_error(reason), 'ocr_failed')

    def test_a_page_without_a_table_is_skipped_with_a_warning_and_only_no_table_at_all_fails(self):
        import unittest.mock as mock
        jobs = {0: [(b'a', 1, 0, 1)], 1: gemma_ocr.GemmaOcrError('table_not_found'), 2: [(b'c', 1, 0, 0)]}

        def strip_jobs(page):
            value = jobs[page]
            if isinstance(value, Exception):
                raise value
            return value
        reads = {b'a': [TERM1, course('1', '71ITBS10103')], b'c': [course('2', '71ITBS10203')]}
        with mock.patch.object(gemma_ocr, 'strip_jobs', strip_jobs):
            pages = gemma_ocr.read_pages({0: 0, 1: 1, 2: 2}, [0, 1, 2], reader=lambda jpeg: reads[jpeg])
            self.assertEqual(pages[1], [{'kind': 'warning', 'text': 'table_not_found'}])
            builder = gemma_ocr.RowBuilder()
            builder.rows(pages[0])
            self.assertEqual(builder.rows(pages[1]), [])
            self.assertEqual(builder.page_warnings, ['table_not_found'])
            self.assertEqual(builder.rows(pages[2])[0][1], '71ITBS10203')
            with self.assertRaises(gemma_ocr.GemmaOcrError):
                gemma_ocr.read_pages({1: 1}, [1], reader=lambda jpeg: [])

    def test_a_summary_box_read_with_too_few_lines_is_read_again(self):
        half = {'kind': 'summary', 'lines': ['Tổng số tín chỉ đăng ký: 100', 'Điểm TB học tập (Hệ 4): 3.0', 'Tổng số tín chỉ tích lũy: 54',
                                             'Điểm TB tích lũy (Hệ 4): 3.1', 'Xếp loại học tập tích lũy: Khá']}
        whole = {'kind': 'summary', 'lines': half['lines'] + ['Số tín chỉ đạt học kỳ: 18', 'Điểm TB học kỳ (Hệ 4): 2.33',
                                                             'Xếp loại học tập HK: Yếu', 'Điểm rèn luyện học kỳ: 81']}
        answers = [[half], [whole]]
        calls = []
        def read(jpeg):
            calls.append(jpeg)
            return answers[len(calls) - 1]
        items = gemma_ocr.read_checked(read, b'jpeg', rows=0, first=False, boxes=1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(gemma_ocr.summary_values(items[0])), 9)

    def test_a_strip_missing_a_term_title_is_read_again(self):
        answers = [[course('1', '71ITBS10103')], [{'kind': 'term', 'year': '2024-2025', 'semester': 1}, course('1', '71ITBS10103')]]
        calls = []
        def read(jpeg):
            calls.append(jpeg)
            return answers[len(calls) - 1]
        items = gemma_ocr.read_checked(read, b'jpeg', rows=1, first=False, boxes=0, titles=1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(items[0]['kind'], 'term')

    def test_a_label_printed_without_a_value_is_read_but_has_no_value(self):
        # The box of a term still running: labels with empty cells, which Gemma writes "null", "" or leaves bare.
        item = {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ: null', 'Điểm TB học kỳ (Hệ 4):', 'Xếp loại học tập HK: KXL',
                                             'Điểm rèn luyện học kỳ: None', 'Tổng số tín chỉ đăng ký: 18']}
        self.assertEqual(gemma_ocr.summary_values(item), {'Xếp loại học tập HK': 'KXL', 'Tổng số tín chỉ đăng ký': '18'})
        self.assertEqual(len(gemma_ocr.summary_pairs(item)), 5)
        rows = gemma_ocr.RowBuilder().rows([TERM1, item])
        _, summaries, _ = parse_pages([{'page': 1, 'method': 'gemma', 'warnings': [], 'rows': rows}], {})
        semester = parse_semesters(summaries, [])[0]
        self.assertEqual((semester['semester_rank'], semester.get('semester_credits_passed'), semester.get('conduct_score')), ('Không xếp loại', None, None))
        self.assertEqual(semester['issues'], [])

    def test_each_summary_box_is_read_again_alone_and_settled_by_majority(self):
        strip = [TERM1, course('1', '71ITBS10103'),
                 {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ: null', 'Xếp loại học tập HK: null', 'Điểm rèn luyện học kỳ: null']},
                 {'kind': 'summary', 'lines': ['Tổng số tín chỉ đăng ký: 18', 'Điểm TB tích lũy (Hệ 4): 3,10']}]
        box = {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ:', 'Xếp loại học tập HK: KXL', 'Điểm rèn luyện học kỳ:',
                                            'Tổng số tín chỉ đăng ký: 18', 'Điểm TB tích lũy (Hệ 4): 3.10']}
        reads = []
        def read_box(jpeg):
            reads.append(jpeg)
            return box
        items = gemma_ocr.check_boxes(strip, [(b'box', b'larger')], read_box)
        # "KXL" against "null": the larger image decides (it says KXL); 3,10 and 3.10 are the same value.
        self.assertEqual(reads, [b'box', b'larger'])
        self.assertEqual([item['kind'] for item in items], ['term', 'course', 'summary'])
        self.assertEqual(gemma_ocr.summary_values(items[2]), {'Xếp loại học tập HK': 'KXL', 'Tổng số tín chỉ đăng ký': '18',
                                                              'Điểm TB tích lũy (Hệ 4)': '3.10'})
        # Both readings agree: the box is read once more only.
        reads.clear()
        same = gemma_ocr.check_boxes([TERM1, box], [(b'box', b'larger')], read_box)
        self.assertEqual(reads, [b'box'])
        self.assertEqual(gemma_ocr.summary_values(same[1]), gemma_ocr.summary_values(box))

    def test_a_summary_value_with_no_majority_keeps_the_box_reading_and_flags_the_page(self):
        strip = [{'kind': 'summary', 'lines': ['Điểm TB học kỳ (Hệ 4): 3.18']}]
        answers = {b'box': {'kind': 'summary', 'lines': ['Điểm TB học kỳ (Hệ 4): 3.16']},
                   b'larger': {'kind': 'summary', 'lines': ['Điểm TB học kỳ (Hệ 4): 3.13']}}
        items = gemma_ocr.check_boxes(strip, [(b'box', b'larger')], lambda jpeg: answers[jpeg])
        self.assertEqual(gemma_ocr.summary_values(items[0]), {'Điểm TB học kỳ (Hệ 4)': '3.16'})
        self.assertEqual(items[1], {'kind': 'warning', 'text': 'summary_unsure'})
        # The strip and the larger image agree: their value wins over the box's.
        answers[b'larger'] = strip[0]
        items = gemma_ocr.check_boxes(strip, [(b'box', b'larger')], lambda jpeg: answers[jpeg])
        self.assertEqual(items, [{'kind': 'summary', 'lines': ['Điểm TB học kỳ (Hệ 4): 3.18']}])

    def test_boxes_that_do_not_pair_with_their_images_are_left_as_read_and_flagged(self):
        strip = [TERM1, SUMMARY1, course('1', '71ITBS10103'), SUMMARY1_REST]
        items = gemma_ocr.check_boxes(strip, [(b'box', b'larger')], lambda jpeg: self.fail('no box read expected'))
        self.assertEqual(items, strip + [{'kind': 'warning', 'text': 'summary_unchecked'}])
        builder = gemma_ocr.RowBuilder()
        builder.rows(items)
        self.assertIn('summary_unchecked', builder.page_warnings)
        # A box reading that fails leaves that box as read, flagged, and never fails the transcript.
        def fails(jpeg):
            raise gemma_ocr.GemmaOcrError('not_json')
        self.assertEqual(gemma_ocr.check_boxes([SUMMARY1], [(b'box', b'larger')], fails), [SUMMARY1, {'kind': 'warning', 'text': 'summary_unchecked'}])

    def test_read_checked_sends_the_box_images_of_its_strip(self):
        box = {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ: 6', 'Điểm TB học kỳ (Hệ 4): 3.50']}
        items = gemma_ocr.read_checked(lambda jpeg: [TERM1, box], b'strip', rows=0, first=False, crops=[(b'box', b'larger')],
                                       read_box=lambda jpeg: box)
        self.assertEqual(gemma_ocr.summary_values(items[1]), gemma_ocr.summary_values(box))

    def test_box_images_are_the_box_alone_and_a_larger_copy(self):
        import cv2
        import numpy as np
        table = np.full((900, 1500, 3), 255, np.uint8)
        cv2.putText(table, 'So tin chi dat hoc ky: 18', (40, 460), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
        image, larger = gemma_ocr.box_images(table, (400, 560))
        decode = lambda jpeg: cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)  # noqa: E731
        small, big = decode(image), decode(larger)
        self.assertEqual(small.shape[1], 1500 + 2 * 20)
        self.assertEqual(small.shape[0], 160 + 2 * 6 + 2 * 20)
        self.assertEqual(big.shape[0], round((160 + 2 * 6) * gemma_ocr.BOX_SCALE) + 2 * 20)
        self.assertLess(big.shape[0] * big.shape[1], gemma_ocr.IMAGE_PIXELS)

    def test_a_dc_row_is_a_fail_without_a_score_like_vt_and_ct(self):
        # User 2026-11-09: DC counts as a fail, the transcript keeps the mark; 0 in the printed term GPA like F.
        rows = gemma_ocr.RowBuilder().rows([TERM1, course('1', '71ENG210023', score10='DC', score4='DC', letter='DC', result='failed'),
                                            course('2', '71ITBS10103', score10='7.2', score4='2.88', letter='B'),
                                            {'kind': 'summary', 'lines': ['Số tín chỉ đạt học kỳ: 3', 'Điểm TB học kỳ (Hệ 4): 1.44']}])
        courses, summaries, _ = parse_pages([{'page': 1, 'method': 'gemma', 'warnings': [], 'rows': rows}], {})
        mark = courses[0]
        self.assertEqual((mark['letter_grade'], mark['score_10'], mark['score_4'], mark['result']), ('DC', None, None, 'failed'))
        self.assertEqual(mark['issues'], [])
        semester = parse_semesters(summaries, courses)[0]
        self.assertEqual(semester['computed_from_courses']['semester_gpa_4'], 1.44)
        self.assertEqual(semester['issues'], [])

    def test_reads_the_json_of_an_answer_in_a_fence_or_with_words_around(self):
        self.assertEqual(gemma_ocr.json_text('```json\n{"items": []}\n```'), '{"items": []}')
        self.assertEqual(gemma_ocr.json_text('Đây là kết quả: {"items": [1]} xong'), '{"items": [1]}')
        with self.assertRaises(gemma_ocr.GemmaOcrError):
            gemma_ocr.json_text('không có JSON')


if __name__ == '__main__':
    unittest.main()
