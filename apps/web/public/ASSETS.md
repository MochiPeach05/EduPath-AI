# Public images

## Public information page imagery

`vlu-information-campus.jpg` is the Van Lang campus courtyard photo supplied by the user on 2026-10-03 (`codex-clipboard-381cd392-22f9-4fb1-9add-9544896136ce.png`). It is stored locally as a JPEG at quality 88 for the policy and terms banner, with its original 2048 × 1365 dimensions preserved.

The privacy and terms text is written for EduPath AI; it is not copied from the reference site's policy.

## Sizes for the web (2026-11-04)

The logo, the favicon and the campus photo were reduced to what the pages draw: they were 1.7 MB of the 2.1 MB the landing page downloaded, now about 0.15 MB on a desktop screen. Same artwork, resampled with Pillow (Lanczos, premultiplied alpha for the transparent images).

| File | Size | Bytes | Used by |
| --- | --- | --- | --- |
| `edupath-logo.png` | 420 × 140 | 38 368 | Fallback of `EduPathBrand.tsx` for a browser without WebP |
| `edupath-logo-420.webp` | 420 × 140 | 19 244 | `EduPathBrand.tsx`, screens up to 2x (the mark is at most 210 CSS px wide) |
| `edupath-logo-630.webp` | 630 × 210 | 32 558 | `EduPathBrand.tsx`, 3x phones |
| `edupath-favicon.png` | 96 × 96 | 11 403 | `index.html` icon (the mark centred on a square, transparent canvas) |
| `vlu-campus.jpg` | 1600 × 1067 | 482 644 | Login page and admin sidebar backgrounds (CSS), fallback of the landing photos; progressive JPEG, quality 75 |
| `vlu-campus-800.webp` | 800 × 533 | 110 264 | Landing hero and campus story (`<picture>`, WebP quality 70) |
| `vlu-campus-1200.webp` | 1200 × 800 | 239 318 | The same on 2x screens and phones |
| `edupath-og.png` | 1200 × 630 | 118 824 | Link previews (`og:image` in `index.html`): the logo on white and a brand-red band (#b51639) with "Đánh giá năng lực · Lộ trình học tập · Định hướng nghề nghiệp" in Segoe UI Semibold |

The originals were `edupath-logo.png` 2172 × 724 (526 173 bytes), `edupath-favicon.png` 505 × 457 (174 231 bytes) and `vlu-campus.jpg` 2100 × 1400 (1 036 723 bytes); they are in the git history. `og:image` needs an absolute address: `https://edupath-ai-q28n.onrender.com/edupath-og.png`, to change with the domain.
