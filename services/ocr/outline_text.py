"""The text of a transcript page that was printed as vector outlines (2026-11-13).

A browser page sent to a printer driver ("Microsoft: Print To PDF", Foxit's PDF printer) has no text layer: every
character is a filled path, the outline of its Arial glyph on the driver's 600 DPI grid. Such a page is no scan (on
2026-11-13 all 18 stored transcripts that had gone to OCR were of this kind). Its characters are told apart exactly,
without OCR and without AI:

- a path is a character when its vertices lie on the on-curve points of one Arial glyph (arial_glyphs.json) at one of the
  page's font sizes, within about one device unit, both ways;
- the characters go back into lines and words by their baselines, origins and advance widths;
- the words are written as invisible text (outline_blank.ttf: a box per character, with Arial's advance widths) on a
  new page that holds only the table's rules, so test_ocr.native_rows reads it as it reads a browser's "Save as PDF";
  the result marks (pictures) are then read from the page itself, cell by cell (marked_rows).

Nothing is guessed. A path in the table that is no known glyph, or that could be two characters, leaves the page to OCR
as before. The one pair Arial draws alike, capital I and small l (a plain bar), is settled by the letters of its word
and, where they leave a doubt, by where the bar stands between its neighbours (_settle_bars).
arial_glyphs.json holds, per character and style, the advance, the bounding box and the on-curve points of the glyph in
font units: enough to tell glyphs apart, not to draw them.
"""
from collections import defaultdict
import json
from pathlib import Path
import unicodedata

HERE = Path(__file__).resolve().parent
REFERENCE = HERE / 'arial_glyphs.json'
BLANK_FONT = HERE / 'outline_blank.ttf'
# Printer resolutions, coarsest first: the grid the vertices of a path stand on (points per device unit = 72 / dpi).
DEVICE_DPI = (150, 200, 300, 360, 400, 600, 720, 1200, 2400)
# How far a vertex may lie from a glyph's point when the path has no device grid (points).
EXACT_TOLERANCE = 0.03
# A filled rectangle longer than this (points) and thin is a table rule; the widest rectangle glyph (an underscore) is shorter.
RULE_LENGTH = 12.0
RULE_WIDTH = 3.0
# Larger paths are pictures (a logo), not characters.
GLYPH_LIMIT = 60.0
# Pages with fewer glyph paths are not outline text (a scan with a few vector marks, a blank page).
MIN_GLYPHS = 20
MAX_CONTENT_BYTES = 8_000_000
BOLD = {'b', 'z'}
UPRIGHT = {'r', 'b'}
# Characters Arial draws with one outline: the one a transcript prints.
# (soft hyphen and hyphens: '-'; Eth: D with stroke; figure dash: en dash; low quote: comma; modifier accents: ` and acute)
PREFERRED = {'\u00ad': '-', '\u2010': '-', '\u2011': '-', '\u00d0': '\u0110', '\u2012': '\u2013', '\u201a': ',', '\u02cb': '`', '\u02ca': '\u00b4'}
BARS = ('I', 'l')
VOWELS = set('aăâeêioôơuưyàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ')


class OutlineError(RuntimeError):
    """The page is not outline text this module can read exactly: read it another way."""


_reference = None


def reference():
    """(units per em, templates, {contours: (indexes, widths, heights, numbers of points)}, {style: space advance}). A
    template is one character of one style: its advance, box and on-curve points in font units (y up)."""
    global _reference
    if _reference is None:
        import numpy as np
        data = json.loads(REFERENCE.read_text(encoding='utf-8'))
        templates, groups = [], defaultdict(list)
        for style, entries in data['fonts'].items():
            for entry in entries:
                box = entry['b']
                groups[entry['k']].append(len(templates))
                templates.append({'style': style, 'char': PREFERRED.get(entry['c'], entry['c']), 'advance': entry['a'], 'box': box,
                                  'points': np.array(entry['p'], dtype=np.float64).reshape(-1, 2),
                                  'width': box[2] - box[0], 'height': box[3] - box[1]})
        tables = {contours: (np.array(indexes), np.array([templates[i]['width'] for i in indexes], dtype=np.float64),
                             np.array([templates[i]['height'] for i in indexes], dtype=np.float64),
                             np.array([len(templates[i]['points']) for i in indexes]))
                  for contours, indexes in groups.items()}
        _reference = (data['upm'], templates, tables, data['space'])
    return _reference


def page_paths(page):
    """(glyph paths, table rules) of a page. A glyph path: its vertices from the top left corner of its box (points, y
    down), contours, box and whether it is made of rectangles only. A rule: (x0, y0, x1, y1) of a long thin filled rectangle."""
    import numpy as np
    glyphs, rules = [], []
    for drawing in page.get_drawings():
        if drawing['type'] not in ('f', 'fs'):
            continue
        points, contours, last, rectangles = [], 0, None, True
        for item in drawing['items']:
            kind = item[0]
            if kind == 're':
                r = item[1]
                points += [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                contours += 1
                last = None
            elif kind == 'qu':
                q = item[1]
                points += [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
                contours += 1
                last, rectangles = None, False
            elif kind in ('l', 'c'):
                rectangles = False
                start, end = item[1], item[-1]
                if last is None or abs(start.x - last.x) > 1e-3 or abs(start.y - last.y) > 1e-3:
                    contours += 1
                    points.append((start.x, start.y))
                points.append((end.x, end.y))
                last = end
        if not points:
            continue
        rect = drawing['rect']
        longer = max(rect.width, rect.height)
        if rectangles and longer > RULE_LENGTH:
            # Table rules, one or several to a path (a driver writes the right border of a row and the left border of
            # the next as one path); a wide filled rectangle is a background, not a character.
            for item in drawing['items']:
                r = item[1]
                if max(r.width, r.height) > RULE_LENGTH and min(r.width, r.height) <= RULE_WIDTH:
                    rules.append((r.x0, r.y0, r.x1, r.y1))
            continue
        if longer > GLYPH_LIMIT:
            continue
        first = points[0]
        unique = sorted({(round(x - rect.x0, 3), round(y - rect.y0, 3)) for x, y in points})
        glyphs.append({'points': unique, 'local': np.array(unique, dtype=np.float64),
                       'steps': [abs(v - first[i]) for point in points[1:] for i, v in enumerate(point)],
                       'contours': contours, 'rectangles': rectangles,
                       'x0': rect.x0, 'y0': rect.y0, 'x1': rect.x1, 'y1': rect.y1, 'w': rect.width, 'h': rect.height})
    return glyphs, rules


def device_unit(glyphs):
    """Points per device unit of the printer driver: the coarsest grid most paths of the page stand on, measured from
    each path's first vertex; 0.0 when the paths are on no grid (exact outlines). Most, not all: a part of the page the
    browser scaled (a logo's caption, the header and footer of the print) is off the grid and is not the table."""
    import numpy as np
    sample = glyphs[::max(1, len(glyphs) // 500)]
    steps = np.array([step for g in sample for step in g['steps']], dtype=np.float64)
    steps = steps[steps > 1e-4]
    if len(steps) < 50:
        return 0.0
    for dpi in DEVICE_DPI:
        unit = 72.0 / dpi
        off = np.abs(steps / unit - np.round(steps / unit))
        if (off < 0.1).mean() >= 0.85:
            return unit
    return 0.0


_placed = {}


def _place(index, template, scale):
    """The template's points at `scale` points per font unit, from the top left corner of its box, y down."""
    key = (index, scale)
    placed = _placed.get(key)
    if placed is None:
        import numpy as np
        box, points = template['box'], template['points']
        placed = np.empty_like(points)
        placed[:, 0] = (points[:, 0] - box[0]) * scale
        placed[:, 1] = (box[3] - points[:, 1]) * scale
        _placed[key] = placed
    return placed


def _fit(vertices, placed, tolerance):
    """(distance, x shift, y shift) of a path's vertices from a placed template, both from the top left corner of their
    boxes, once the shift between them is taken out; None when they are not the same outline. Every vertex must lie on a
    point of the glyph and every point of the glyph on a vertex."""
    difference = vertices[:, None, :] - placed[None, :, :]
    squares = (difference * difference).sum(axis=2)
    shift = (vertices - placed[squares.argmin(axis=1)]).mean(axis=0)
    if abs(shift[0]) > 2 * tolerance or abs(shift[1]) > 2 * tolerance:
        return None
    difference = difference - shift
    squares = (difference * difference).sum(axis=2)
    worst = max(squares.min(axis=1).max(), squares.min(axis=0).max())
    return (float(worst) ** 0.5, float(shift[0]), float(shift[1])) if worst <= tolerance * tolerance else None


def _limits(glyph, unit):
    """(how much smaller, how much larger the path's box may be than the glyph's, vertex tolerance), in points. A driver
    grows a rectangle outwards to whole device units (up to one per side); other vertices are rounded to the nearest."""
    if glyph['rectangles'] and unit:
        return 0.3 * unit + 0.01, 2.1 * unit + 0.01, 1.55 * unit
    tolerance = max(EXACT_TOLERANCE, 1.08 * unit)
    return tolerance + 0.04, tolerance + 0.04, tolerance


def font_sizes(glyphs, unit, sample=90, least=5):
    """The font sizes of the page as scales (points per font unit). A detailed glyph (ten vertices or more) that is one
    character only gives one reading of its size; the driver's rounding spreads the readings of one size over about
    ±2.5 %, so readings closer than 3 % to their neighbour are one size (its mean), kept when `least` glyphs or more of
    the `sample` looked at have it."""
    import numpy as np
    _, templates, tables, _ = reference()
    readings = []
    detailed = [g for g in glyphs if len(g['points']) >= 10 and g['h'] >= 4 and not g['rectangles']]
    for glyph in detailed[::max(1, len(detailed) // sample)]:
        table = tables.get(glyph['contours'])
        if table is None:
            continue
        indexes, width, height, counts = table
        _, larger, tolerance = _limits(glyph, unit)
        scale = np.where(height >= width, glyph['h'] / np.maximum(height, 1), glyph['w'] / np.maximum(width, 1))
        fits = ((np.abs(counts - len(glyph['points'])) <= 1)
                & (np.abs(scale * width - glyph['w']) <= larger) & (np.abs(scale * height - glyph['h']) <= larger))
        found = {}
        for position in np.nonzero(fits)[0]:
            template = templates[indexes[position]]
            if _fit(glyph['local'], _place(int(indexes[position]), template, float(scale[position])), tolerance):
                found.setdefault(template['char'], float(scale[position]))
        if len(found) == 1:
            readings.append(next(iter(found.values())))
    _placed.clear()  # the readings' scales are not the page's sizes
    readings.sort()
    clusters, current = [], []
    for reading in readings:
        if current and reading > current[-1] * 1.03:
            clusters.append(current)
            current = []
        current.append(reading)
    if current:
        clusters.append(current)
    return [sum(cluster) / len(cluster) for cluster in clusters if len(cluster) >= least]


def candidates(glyph, sizes, unit):
    """[{char, style, scale, x (origin), y (baseline), advance, distance}]: what the path can be at the page's sizes, its
    origin and baseline measured from the top left corner of the path's box."""
    import numpy as np
    _, templates, tables, _ = reference()
    table = tables.get(glyph['contours'])
    if table is None:
        return []
    indexes, width, height, counts = table
    smaller, larger, tolerance = _limits(glyph, unit)
    # A path has the vertices of its glyph, one for one (a driver that merges two of them: one less).
    same = np.abs(counts - len(glyph['points'])) <= 1
    found = []
    for scale in sizes:
        dw, dh = glyph['w'] - scale * width, glyph['h'] - scale * height
        fits = same & (dw >= -smaller) & (dw <= larger) & (dh >= -smaller) & (dh <= larger)
        for position in np.nonzero(fits)[0]:
            index = int(indexes[position])
            template = templates[index]
            fit = _fit(glyph['local'], _place(index, template, scale), tolerance)
            if fit is None:
                continue
            distance, dx, dy = fit
            box = template['box']
            found.append({'char': template['char'], 'style': template['style'], 'scale': scale,
                          'x': dx - box[0] * scale, 'y': dy + box[3] * scale,
                          'advance': template['advance'] * scale, 'distance': distance})
    return found


def _rank(char):
    """Lower is likelier in a Vietnamese transcript: ASCII, Vietnamese letters, other characters, combining marks."""
    code = ord(char)
    if code < 0x7f:
        return 0
    if 0x1ea0 <= code <= 0x1ef9 or char in 'ĂăÂâĐđÊêÔôƠơƯưÀàÁáÃãÈèÉéÌìÍíĨĩÒòÓóÕõÙùÚúŨũÝý':
        return 1
    return 3 if unicodedata.combining(char) else 2


def decode(glyphs, sizes, unit):
    """(decoded glyphs, undecided paths). A path that fits several characters takes the one on the baseline and at the
    size of the sure characters around it; `unsure` marks a choice between different characters that the line did not
    settle (a bar's I or l aside: phrases settles those). A path that fits no character is returned undecided."""
    cache, options = {}, []
    for glyph in glyphs:
        key = (glyph['contours'], glyph['rectangles'], glyph['local'].round(2).tobytes())
        hit = cache.get(key)
        if hit is None:
            hit = cache[key] = candidates(glyph, sizes, unit)
        options.append([{**c, 'x': c['x'] + glyph['x0'], 'y': c['y'] + glyph['y0']} for c in hit])
    # Sure glyphs: every candidate is the same character on the same baseline at the same size.
    anchors = defaultdict(list)  # (scale, baseline in quarter points) -> [origin x]
    for choice in options:
        if choice and len({(c['char'], round(c['y'] * 4), c['scale']) for c in choice}) == 1:
            anchors[(choice[0]['scale'], round(choice[0]['y'] * 4))].append(choice[0]['x'])

    def on_line(candidate):
        """How many sure characters share the candidate's baseline and size within 60 points to either side."""
        base = round(candidate['y'] * 4)
        return sum(1 for offset in (-1, 0, 1) for x in anchors.get((candidate['scale'], base + offset), ()) if abs(x - candidate['x']) < 60)

    decoded, undecided = [], []
    for glyph, choice in zip(glyphs, options):
        if not choice:
            undecided.append(glyph)
            continue
        order = lambda c: (-min(on_line(c), 3), _rank(c['char']), c['style'] not in UPRIGHT, c['distance'])  # noqa: E731
        best = min(choice, key=order)
        support, rank = min(on_line(best), 3), _rank(best['char'])
        # Another character the line supports as much as the best one: the path could be either.
        rivals = {c['char'] for c in choice if c['char'] != best['char'] and c['style'] in UPRIGHT
                  and min(on_line(c), 3) == support and _rank(c['char']) == rank}
        bars = {c['char']: c for c in choice if c['char'] in BARS and c['scale'] == best['scale'] and c['style'] == best['style']}
        is_bar = best['char'] in BARS and len(bars) == 2
        decoded.append({**best, 'bold': best['style'] in BOLD, 'bars': bars if is_bar else None,
                        'unsure': bool(rivals - set(BARS)) if is_bar else bool(rivals),
                        'box': (glyph['x0'], glyph['y0'], glyph['x1'], glyph['y1'])})
    return decoded, undecided


def _words(line):
    """The line's glyphs in words: a gap wider than a third of a space parts two words."""
    words, current = [], []
    for glyph in line:
        if current and glyph['x'] - (current[-1]['x'] + current[-1]['advance']) > 0.35 * 569 * glyph['scale']:
            words.append(current)
            current = []
        current.append(glyph)
    if current:
        words.append(current)
    return words


def _bar_by_letters(word, index):
    """A bar as the letters of its word tell it: (I or l, whether the letters leave no doubt). In a word without small
    letters (a course code, IT, II) it is an I; after a small letter an l (Excel); starting a word before a vowel an l
    (lập, luật, loại) and before a consonant an I (Internet); the first of several bars starting a word an I
    (Illustrator); after a capital and before small letters an l (Algorithm, Flutter), before a lone s an I (APIs)."""
    letters = [g['char'] if not g.get('bars') else '|' for g in word]
    others = [c for c in letters if c != '|' and c.isalpha()]
    if not any(c.islower() for c in others):
        return 'I', True
    before = next((c for c in reversed(letters[:index]) if c != '|'), '')
    after = [c for c in letters[index + 1:]]
    following = next((c for c in after if c != '|'), '')
    bars_before = sum(1 for c in reversed(letters[:index]) if c == '|') if all(c == '|' for c in letters[:index]) else None
    if before.islower():
        return 'l', True
    if not before.isalpha() and not before.isdigit():  # the bar starts the word (or follows a bracket, a dash)
        run = 1 + next((i for i, c in enumerate(after) if c != '|'), len(after)) + (bars_before or 0)
        if run >= 2:
            return ('I' if not bars_before else 'l'), False
        if following.islower():
            if following in VOWELS:
                return ('I' if ''.join(after[:2]) == 'oT' or ''.join(after[:3]) == 'aaS' else 'l'), False
            return 'I', False
        return 'I', False
    if before.isdigit():
        return 'I', False
    # after a capital letter
    small = next((i for i, c in enumerate(after) if not (c.islower() or c == '|')), len(after))
    if small >= 2 or (small == 1 and after[0] != 's'):
        return 'l', False
    return 'I', False


def _settle_bars(line, unit, exact):
    """A plain bar is a capital I or a small l: Arial draws both as one rectangle. The letters of the word decide
    (_bar_by_letters). Where they leave a doubt, regular Arial tells the two apart by where the bar stands between its
    neighbours (side bearing and advance differ by a quarter of a space), on a page whose characters stand exactly where
    Arial's widths put them (`exact`: a browser that rounds every advance to whole pixels does not) and only when one
    reading fits and the other does not. Bold Arial gives both bars the same metrics: the letters alone decide."""
    def misfit(glyph, option, before, after):
        space = 569 * glyph['scale']
        worst, known = 0.0, 0
        for gap in (None if before is None else option['x'] - (before['x'] + before['advance']),
                    None if after is None else after['x'] - (option['x'] + option['advance'])):
            if gap is not None and -0.4 * space < gap < 1.6 * space:
                worst = max(worst, min(abs(gap), abs(gap - space)))
                known += 1
        return worst if known else None

    for _ in range(2):  # twice: a bar next to a bar is placed by the first pass
        for word in _words(line):
            for index, glyph in enumerate(word):
                if not glyph.get('bars'):
                    continue
                choice, sure = _bar_by_letters(word, index)
                if not sure and exact and unit and not glyph['bold']:
                    position = line.index(glyph)
                    before = line[position - 1] if position else None
                    after = line[position + 1] if position + 1 < len(line) else None
                    errors = {char: misfit(glyph, option, before, after) for char, option in glyph['bars'].items()}
                    if None not in errors.values():
                        fits = [char for char, error in errors.items() if error <= 0.75 * unit]
                        if len(fits) == 1 and max(errors.values()) >= 1.5 * unit:
                            choice = fits[0]
                option = glyph['bars'][choice]
                glyph.update(char=choice, x=option['x'], advance=option['advance'])


def text_lines(decoded):
    """[[glyph, …] left to right] per baseline, top to bottom."""
    lines = {}
    for glyph in sorted(decoded, key=lambda g: g['y']):
        key = round(glyph['y'] * 4)
        home = next((k for k in (key, key - 1, key + 1) if k in lines), key)
        lines.setdefault(home, []).append(glyph)
    return [sorted(line, key=lambda g: g['x']) for _, line in sorted(lines.items())]


def exact_spacing(lines, unit):
    """Whether the page's characters stand where Arial's advance widths put them: the gap between two characters of a
    word (bars aside) is under half a device unit for most of them."""
    gaps = []
    for line in lines:
        for word in _words(line):
            for first, second in zip(word, word[1:]):
                if not first.get('bars') and not second.get('bars'):
                    gaps.append(abs(second['x'] - (first['x'] + first['advance'])))
    if len(gaps) < 30 or not unit:
        return False
    gaps.sort()
    return gaps[len(gaps) // 2] <= 0.5 * unit and gaps[int(len(gaps) * 0.9)] <= 1.2 * unit


def attach_marks(lines):
    """The lines without their combining marks (the portal writes "học kỳ" as o + dot below, y + grave), each mark added
    to its letter's `marks`. A renderer that shapes the text draws the mark on its letter: the letter is the one whose
    box holds the middle of the mark. One that does not draws it at the pen, after the letter's advance: the letter is
    the one that ends there. Which of the two the page is shows in its marks: nearly all of them stand at a pen or not."""
    marks = [(line, g) for line in lines for g in line if unicodedata.combining(g['char'])]
    if not marks:
        return lines
    out = [[g for g in line if not unicodedata.combining(g['char'])] for line in lines]

    def at_pen(mark, letters):
        em = mark['scale'] * 2048
        ends = [(abs(g['x'] + g['advance'] - mark['x']), g) for g in letters]
        return min(ends, key=lambda pair: pair[0]) if ends else (em, None)

    by_line = {id(line): letters for line, letters in zip(lines, out)}
    pens = [at_pen(mark, by_line[id(line)]) for line, mark in marks]
    unshaped = sum(1 for (distance, _), (_, mark) in zip(pens, marks) if distance <= 0.02 * mark['scale'] * 2048) >= 0.9 * len(marks)
    for (distance, letter), (line, mark) in zip(pens, marks):
        letters = by_line[id(line)]
        if not unshaped or letter is None:
            middle = (mark['box'][0] + mark['box'][2]) / 2
            slack = 0.08 * mark['scale'] * 2048
            under = [g for g in letters if g['box'][0] - slack <= middle <= g['box'][2] + slack]
            letter = min(under or letters, key=lambda g: abs((g['box'][0] + g['box'][2]) / 2 - middle), default=None)
        if letter is not None:
            letter['marks'] = letter.get('marks', '') + mark['char']
    return out


def phrases(decoded, unit):
    """[{x, y (baseline), size (points), text}]: the runs of words of each line. A gap wider than a third of a space is a
    space; one wider than two spaces, or another font size, starts a new phrase (another table cell)."""
    upm = reference()[0]
    out = []
    lines = attach_marks(text_lines(decoded))
    exact = exact_spacing(lines, unit)
    for line in lines:
        _settle_bars(line, unit, exact)
        line.sort(key=lambda g: g['x'])
        current = None
        for glyph in line:
            space = 569 * glyph['scale']
            gap = None if current is None else glyph['x'] - current['end']
            if current is None or gap > 1.8 * space or gap < -1.0 * space or glyph['scale'] != current['scale']:
                current = {'x': glyph['x'], 'y': glyph['y'], 'scale': glyph['scale'], 'size': glyph['scale'] * upm, 'text': '', 'end': glyph['x']}
                out.append(current)
            elif gap > 0.35 * space:
                current['text'] += ' '
            current['text'] += glyph['char'] + glyph.get('marks', '')
            current['end'] = glyph['x'] + glyph['advance']
    for phrase in out:
        phrase['text'] = unicodedata.normalize('NFC', phrase['text'])
    return out


def read_page(page):
    """{phrases, rules, decoded, undecided, unit, sizes} of an outline page. OutlineError when it is not one."""
    if page.rotation:
        raise OutlineError('rotated_page')
    # A transcript page of outlines has about 1.5 MB of drawing commands; a page of many times that is a drawing.
    if len(page.read_contents()) > MAX_CONTENT_BYTES:
        raise OutlineError('too_many_paths')
    glyphs, rules = page_paths(page)
    if len(glyphs) < MIN_GLYPHS:
        raise OutlineError('no_outline_text')
    unit = device_unit(glyphs)
    sizes = font_sizes(glyphs, unit)
    if not sizes:
        raise OutlineError('unknown_font')
    decoded, undecided = decode(glyphs, sizes, unit)
    if undecided:
        # A size only a few characters have (a heading): looked for among the paths the page's main sizes left over.
        rare = [size for size in font_sizes(undecided, unit, sample=len(undecided), least=3) if all(abs(size - known) > 0.03 * known for known in sizes)]
        if rare:
            more, undecided = decode(undecided, rare, unit)
            decoded, sizes = decoded + more, sizes + rare
    # A path thinner than any stroke of the page's smallest type is no character: the sliver of a rule a page break cut.
    hairline = 0.03 * min(sizes) * reference()[0]
    undecided = [g for g in undecided if min(g['w'], g['h']) >= hairline]
    return {'phrases': phrases(decoded, unit), 'rules': rules, 'decoded': decoded, 'undecided': undecided, 'unit': unit, 'sizes': sizes}


def write_text(page, phrases, font):
    """Writes the phrases on the page as invisible text, each at its origin on its baseline."""
    import pymupdf
    writer = pymupdf.TextWriter(page.rect)
    for phrase in phrases:
        if phrase['text'].strip():
            writer.append((phrase['x'], phrase['y']), phrase['text'], font=font, fontsize=phrase['size'])
    writer.write_text(page, render_mode=3)


def table_rows(sheet):
    """[(table row, its cell texts)] of the sheet's tables, top to bottom: the rows test_ocr.native_rows reads, in its order."""
    out = []
    for table in sorted(sheet.find_tables().tables, key=lambda t: t.bbox[1]):
        out.extend(zip(table.rows, table.extract()))
    return out


def _folded(value):
    return ''.join(c for c in unicodedata.normalize('NFD', ' '.join((value or '').split())) if not unicodedata.combining(c)).lower().replace('đ', 'd')


def in_doubt(rows, points):
    """Whether a path in doubt lies in the transcript table: in a row from the column header ("Mã môn học") down, or in
    any table row on a page without that header (the table goes on from the page before), the result column aside (its
    marks are pictures). Rows above the header are the portal's own boxes (a full-page print: radio buttons, filters)."""
    headers = [row.bbox[1] for row, cells in rows if 'ma mon' in _folded(' '.join(cell or '' for cell in cells))]
    top = min(headers) if headers else None
    for x, y in points:
        for row, _ in rows:
            x0, y0, x1, y1 = row.bbox
            if not (x0 <= x <= x1 and y0 <= y <= y1) or (top is not None and y1 <= top + 0.5):
                continue
            cells = [cell for cell in row.cells if cell is not None]
            if len(cells) == 8 and x >= cells[-1][0] - 0.5:
                continue
            return True
    return False


def cell_mark(patch):
    """The mark pictured in a result cell (an RGB array): ✓ or ✗ by its colour (ppocr_table.result_mark: green, red) and,
    on a print without colours, by its shape: the portal's cross is its own mirror image, its tick is not and leaves the
    top left corner empty. ? for a picture that is neither, '' for an empty cell. Colour and shape that disagree: ?."""
    from ppocr_table import CROSS, TICK, UNKNOWN_MARK, result_mark
    coloured = result_mark(patch)
    ink = patch.min(axis=2) < 200
    if int(ink.sum()) < 40:
        return coloured
    import numpy as np
    ys, xs = np.nonzero(ink)
    crop = ink[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    height, width = crop.shape
    shape = None
    if min(height, width) >= 12:
        mirrored = crop[:, ::-1]
        overlap = float((crop & mirrored).sum()) / max(1, int((crop | mirrored).sum()))
        if overlap >= 0.75:
            shape = CROSS
        elif overlap <= 0.4 and float(crop[:height // 2, :width // 2].mean()) <= 0.3:
            shape = TICK
    if coloured in (TICK, CROSS):
        return coloured if shape in (None, coloured) else UNKNOWN_MARK
    return shape or UNKNOWN_MARK


def marked_rows(page, rows, dpi=300):
    """The cell texts of the rows, each course row's empty result cell filled with the mark pictured in that cell on the
    page itself (cell_mark). The cells are the text page's own, so no band has to be found on a picture of the page; the
    result column is rendered once."""
    import numpy as np
    import pymupdf
    texts = [list(cells) for _, cells in rows]
    wanted = [(text, pymupdf.Rect(row.cells[-1]) + (1.5, 1.5, -1.5, -1.5)) for (row, _), text in zip(rows, texts)
              if len(text) == 8 and len(row.cells) == 8 and row.cells[-1] is not None and not (text[7] or '').strip() and (text[0] or '').strip().isdigit()]
    wanted = [(text, clip) for text, clip in wanted if not clip.is_empty]
    if not wanted:
        return texts
    column = pymupdf.Rect(min(c.x0 for _, c in wanted), min(c.y0 for _, c in wanted), max(c.x1 for _, c in wanted), max(c.y1 for _, c in wanted))
    pix = page.get_pixmap(dpi=dpi, clip=column, alpha=False)
    image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
    zoom = dpi / 72
    for text, clip in wanted:
        left, top = int(round((clip.x0 - column.x0) * zoom)), int(round((clip.y0 - column.y0) * zoom))
        right, bottom = int(round((clip.x1 - column.x0) * zoom)), int(round((clip.y1 - column.y0) * zoom))
        patch = image[max(0, top):bottom, max(0, left):right]
        if patch.size:
            text[7] = cell_mark(patch)
    return texts


def text_pages(document, indexes):
    """(the document of text pages, {page index: (its text page, its table rows)}) for the pages of `indexes` that are
    outline text read exactly. A text page holds the page's table rules and its characters as invisible text; the rows
    are the cell texts test_ocr.native_rows would extract from it, with the result marks of the page itself
    (marked_rows). A page with a path in its table that is no known character, or with a character the line did not
    settle, is left out (in_doubt)."""
    import pymupdf
    font = pymupdf.Font(fontfile=str(BLANK_FONT))
    clean = pymupdf.open()
    found = {}
    for index in indexes:
        page = document[index]
        try:
            read = read_page(page)
        except OutlineError:
            continue
        sheet = clean.new_page(width=page.rect.width, height=page.rect.height)
        if read['rules']:
            # Each rule a path of its own, as a browser's "Save as PDF" writes them (find_tables joins touching paths).
            shape = sheet.new_shape()
            for rule in read['rules']:
                shape.draw_rect(pymupdf.Rect(rule))
                shape.finish(color=None, fill=(0, 0, 0), width=0)
            shape.commit()
        # The table finder needs the text to see a table at all, so the text goes on the sheet first.
        write_text(sheet, read['phrases'], font)
        rows = table_rows(sheet)
        doubtful = [((g['x0'] + g['x1']) / 2, (g['y0'] + g['y1']) / 2) for g in read['undecided']]
        doubtful += [((g['box'][0] + g['box'][2]) / 2, (g['box'][1] + g['box'][3]) / 2) for g in read['decoded'] if g['unsure']]
        if doubtful and in_doubt(rows, doubtful):
            continue
        found[index] = (sheet.number, marked_rows(page, rows))
    return clean, {index: (clean[number], rows) for index, (number, rows) in found.items()}
