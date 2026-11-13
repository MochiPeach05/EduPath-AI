"""Builds what outline_text.py reads and what its test uses. Not run by the server: needs fontTools and Windows' Arial.

    pip install fonttools
    python outline_build.py glyphs arial_glyphs.json          the glyph reference
    python outline_build.py font arial_glyphs.json outline_blank.ttf    the font of the invisible text layer
    python outline_build.py simulate text.pdf outline.pdf     a text-layer PDF set in Arial as a printer driver writes it

arial_glyphs.json: per character and style (r regular, b bold, i italic, z bold italic) the advance, the bounding box,
the number of contours and the ON-CURVE points of the glyph (the implied ones between two control points too), in font
units. The control points are left out: the reference tells glyphs apart, it cannot redraw them.

outline_blank.ttf: one BOX per character (the rectangle of its bounding box in Arial, no letter shape) with Arial's
regular advance widths. The text layer written with it is invisible; the boxes give each character the place and size
it has in print, which PyMuPDF's table finder reads from glyph outlines (an empty glyph has no box and its text falls
out of every cell).

simulate: every character becomes a filled path, the glyph's outline with its vertices on a 600 DPI grid, a rectangle
glyph grown outwards to whole device units, as "Microsoft: Print To PDF" writes them (measured on real files,
2026-11-13); the page's rules and pictures are kept, the text is gone. fixtures/outline_transcript.pdf is
fixtures/outline_transcript.html printed by Chrome (--headless --no-pdf-header-footer --print-to-pdf) and simulated.
"""
import json
import math
import sys

FONTS = {'r': r'C:\Windows\Fonts\arial.ttf', 'b': r'C:\Windows\Fonts\arialbd.ttf', 'i': r'C:\Windows\Fonts\ariali.ttf',
         'z': r'C:\Windows\Fonts\arialbi.ttf'}
# Latin with Vietnamese, combining tone marks, general punctuation, a few symbols.
RANGES = [(0x21, 0x7E), (0xA1, 0xFF), (0x100, 0x17F), (0x1A0, 0x1A1), (0x1AF, 0x1B0), (0x2C6, 0x2DD), (0x300, 0x303), (0x309, 0x309),
          (0x323, 0x323), (0x1EA0, 0x1EF9), (0x2010, 0x2026), (0x2030, 0x2030), (0x2032, 0x2033), (0x2039, 0x203A), (0x20AB, 0x20AC),
          (0x2190, 0x2193), (0x2212, 0x2212), (0x25A0, 0x25A1), (0x25CF, 0x25CF), (0x2713, 0x2717)]
UNIT = 0.12  # points per device unit at 600 DPI


def contours_of(glyphs, name):
    """[{'start': point, 'segments': [('l', point) | ('q', control, point), …]}] of a glyph, every contour closed."""
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    pen = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(pen)
    contours, current = [], None
    for op, args in pen.value:
        if op == 'moveTo':
            current = {'start': args[0], 'segments': []}
            contours.append(current)
        elif op == 'lineTo':
            current['segments'].append(('l', args[0]))
        elif op == 'qCurveTo':
            points = list(args)
            if points[-1] is None:  # a contour of control points only: its on-curve points are all implied
                offs = points[:-1]
                ons = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(offs, offs[1:] + offs[:1])]
                current = {'start': ons[-1], 'segments': [('q', off, on) for off, on in zip(offs, ons)]}
                contours.append(current)
                continue
            offs, end = points[:-1], points[-1]
            for index, off in enumerate(offs):
                on = ((off[0] + offs[index + 1][0]) / 2, (off[1] + offs[index + 1][1]) / 2) if index + 1 < len(offs) else end
                current['segments'].append(('q', off, on))
    for contour in contours:
        last = contour['segments'][-1][-1] if contour['segments'] else contour['start']
        if last != contour['start']:
            contour['segments'].append(('l', contour['start']))
    return contours


def build_glyphs(target):
    from fontTools.ttLib import TTFont
    out = {'upm': 2048, 'fonts': {}, 'space': {}}
    for style, path in FONTS.items():
        font = TTFont(path)
        cmap, glyphs, metrics = font.getBestCmap(), font.getGlyphSet(), font['hmtx'].metrics
        out['upm'] = font['head'].unitsPerEm
        entries = []
        for low, high in RANGES:
            for code in range(low, high + 1):
                name = cmap.get(code)
                if not name:
                    continue
                contours = contours_of(glyphs, name)
                points = sorted({(round(p[0], 1), round(p[1], 1)) for c in contours for p in [c['start']] + [s[-1] for s in c['segments']]})
                if not points:
                    continue
                xs, ys = [p[0] for p in points], [p[1] for p in points]
                entries.append({'c': chr(code), 'a': metrics[name][0], 'k': len(contours), 'b': [min(xs), min(ys), max(xs), max(ys)],
                                'p': [v for p in points for v in p]})
        out['fonts'][style] = entries
        out['space'][style] = metrics[cmap[0x20]][0]
        print(style, len(entries), 'glyphs', font['name'].getDebugName(5))
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(',', ':'))


def build_font(reference, target):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib.tables._g_l_y_f import Glyph
    data = json.load(open(reference, encoding='utf-8'))
    advances, boxes = {' ': data['space']['r']}, {}
    for style in ('r', 'b', 'i', 'z'):
        for entry in data['fonts'][style]:
            if entry['c'] not in advances:
                advances[entry['c']], boxes[entry['c']] = entry['a'], entry['b']
    order = ['.notdef'] + [f'u{ord(c):04X}' for c in sorted(advances)]

    def box_glyph(box):
        x0, y0, x1, y1 = (int(round(v)) for v in box)
        pen = TTGlyphPen(None)
        pen.moveTo((x0, y0))
        pen.lineTo((x0, max(y1, y0 + 1)))
        pen.lineTo((max(x1, x0 + 1), max(y1, y0 + 1)))
        pen.lineTo((max(x1, x0 + 1), y0))
        pen.closePath()
        return pen.glyph()

    glyphs = {name: (box_glyph(boxes[chr(int(name[1:], 16))]) if name != '.notdef' and chr(int(name[1:], 16)) in boxes else Glyph()) for name in order}
    builder = FontBuilder(data['upm'], isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({ord(c): f'u{ord(c):04X}' for c in advances})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: ((advances[chr(int(name[1:], 16))] if name != '.notdef' else 1000),
                                           (glyphs[name].xMin if getattr(glyphs[name], 'numberOfContours', 0) else 0)) for name in order})
    builder.setupHorizontalHeader(ascent=1854, descent=-434)
    builder.setupNameTable({'familyName': 'EduPath Outline Blank', 'styleName': 'Regular'})
    builder.setupOS2(sTypoAscender=1491, sTypoDescender=-431, usWinAscent=1854, usWinDescent=434)
    builder.setupPost()
    builder.save(target)
    print(len(order), 'glyphs')


def simulate(source_path, target_path):
    import pymupdf
    from fontTools.ttLib import TTFont
    fonts, outlines = {}, {}

    def outline(char, bold):
        key = (char, bold)
        if key not in outlines:
            if bold not in fonts:
                font = TTFont(FONTS['b' if bold else 'r'])
                fonts[bold] = (font.getBestCmap(), font.getGlyphSet())
            cmap, glyphs = fonts[bold]
            name = cmap.get(ord(char))
            outlines[key] = None if name is None else contours_of(glyphs, name)
        return outlines[key]

    def rectangle(contour):
        points = [contour['start']] + [segment[-1] for segment in contour['segments']]
        if any(segment[0] != 'l' for segment in contour['segments']) or len(set(points)) != 4:
            return None
        xs, ys = sorted({p[0] for p in points}), sorted({p[1] for p in points})
        return (xs[0], ys[0], xs[1], ys[1]) if len(xs) == 2 and len(ys) == 2 else None

    grid = lambda v: round(v / UNIT) * UNIT  # noqa: E731
    with pymupdf.open(source_path) as source:
        target = pymupdf.open()
        for page in source:
            sheet = target.new_page(width=page.rect.width, height=page.rect.height)
            shape = sheet.new_shape()
            for drawing in page.get_drawings():
                if drawing['type'] == 'f' and all(item[0] == 're' for item in drawing['items']):
                    for item in drawing['items']:
                        r = item[1]
                        shape.draw_rect(pymupdf.Rect(grid(r.x0), grid(r.y0), grid(r.x0) + max(UNIT, grid(r.width)), grid(r.y0) + max(UNIT, grid(r.height))))
                        shape.finish(color=None, fill=drawing.get('fill') or (0, 0, 0), width=0)
            for block in page.get_text('rawdict')['blocks']:
                for line in block.get('lines', []):
                    for span in line['spans']:
                        bold = 'Bold' in span['font'] or bool(span['flags'] & 16)
                        scale = span['size'] / 2048
                        for char in span['chars']:
                            if not char['c'].strip():
                                continue
                            contours = outline(char['c'], bold)
                            if contours is None:
                                raise ValueError(f"no Arial glyph for U+{ord(char['c']):04X}")
                            ox, oy = char['origin']
                            place = lambda p: (ox + p[0] * scale, oy - p[1] * scale)  # noqa: E731
                            rects = [rectangle(contour) for contour in contours]
                            if all(rects):
                                for x0, y0, x1, y1 in rects:
                                    (ax, ay), (bx, by) = place((x0, y1)), place((x1, y0))
                                    shape.draw_rect(pymupdf.Rect(math.floor(ax / UNIT) * UNIT, math.floor(ay / UNIT) * UNIT,
                                                                 math.ceil(bx / UNIT) * UNIT, math.ceil(by / UNIT) * UNIT))
                            else:
                                for contour in contours:
                                    position, exact = tuple(grid(v) for v in place(contour['start'])), contour['start']
                                    for segment in contour['segments']:
                                        end = tuple(grid(v) for v in place(segment[-1]))
                                        if segment[0] == 'l':
                                            shape.draw_line(position, end)
                                        else:
                                            control, on = segment[1], segment[2]
                                            first = (exact[0] + 2 / 3 * (control[0] - exact[0]), exact[1] + 2 / 3 * (control[1] - exact[1]))
                                            second = (on[0] + 2 / 3 * (control[0] - on[0]), on[1] + 2 / 3 * (control[1] - on[1]))
                                            shape.draw_bezier(position, tuple(grid(v) for v in place(first)), tuple(grid(v) for v in place(second)), end)
                                        position, exact = end, segment[-1]
                            shape.finish(color=None, fill=(0, 0, 0), width=0, closePath=False)
            shape.commit()
            for info in page.get_image_info():
                # A picture as the page shows it (its transparency painted white), without the page's text.
                box = pymupdf.Rect(info['bbox'])
                if not box.is_empty and box.width <= 100 and box.height <= 100:
                    sheet.insert_image(box, pixmap=page.get_pixmap(clip=box, dpi=600, alpha=False))
        target.set_metadata({'producer': 'Microsoft: Print To PDF (simulated by outline_build.py)'})
        target.save(target_path, deflate=True, garbage=3)
        print(len(target), 'pages')


if __name__ == '__main__':
    command, arguments = (sys.argv[1] if len(sys.argv) > 1 else ''), sys.argv[2:]
    if command == 'glyphs' and len(arguments) == 1:
        build_glyphs(*arguments)
    elif command == 'font' and len(arguments) == 2:
        build_font(*arguments)
    elif command == 'simulate' and len(arguments) == 2:
        simulate(*arguments)
    else:
        raise SystemExit(__doc__)
