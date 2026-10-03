# style-experience-matrix

Screenshot matrix for the Experience System. Each core experience is captured on
three pages, plus a grayscale twin of every shot.

```
<style>--<page>.png        1180x780, dark theme
<style>--<page>.gray.png   the same frame with a grayscale filter applied live
```

**Why the grayscale twin exists.** The acceptance standard for this round is
structural, not chromatic: if two experiences are still clearly distinguishable
from a black-and-white frame, they are genuinely different. If a difference
disappears when the colour is removed, that experience was a reskin.

Regenerate with:

```pwsh
# needs a real dev server on :1420 (never `vite preview`)
node node_modules\vite\bin\vite.js --port 1420 --strictPort
node tools/style-matrix.mjs
```

The tool refuses to certify a matrix in which two requested experiences share a
grammar signature — `[shell, navigation, detail, card, composition, density,
motion]` — because a shared signature is exactly the "all styles look alike"
complaint in measurable form. It also fails on any console error.

Environment knobs: `BASE_URL`, `STYLES` (comma list), `PAGES`, `GRAYSCALE=0`.

## Coverage

16 experiences × 3 pages × 2 (colour + grayscale) = 96 files.

| Experience | Tier | Shell | Navigation | Card | Composition | Density | Motion |
|---|---|---|---|---|---|---|---|
| `phantom-comic` | experience | topbar | topbar | poster | poster-wall | spacious | expressive |
| `japanese-editorial` | experience | editorial | sidebar | index-entry | magazine-index | spacious | reduced |
| `retro-mac` | experience | windowed | menu-bar | window | finder-list | compact | normal |
| `dos-utility` | experience | dual-pane | keyboard-menu | terminal-line | character-list | compact | reduced |
| `spatial-glass` | experience | canvas | dock | floating-surface | floating-panels | spacious | expressive |
| `blueprint` | experience | topbar | command-bar | tile | drafting-index | compact | reduced |
| `newspaper-editorial` | experience | editorial | topbar | editorial-block | news-columns | compact | reduced |
| `industrial-console` | experience | sidebar | command-bar | flat-row | ledger | compact | reduced |
| `nordic-frost` | experience | command-centered | command-bar | borderless-group | roadmap | spacious | reduced |
| `cyber-neon` | composition | topbar | command-bar | floating-surface | solid-grid | normal | expressive |
| `bauhaus` | composition | sidebar | sidebar | tile | solid-grid | normal | normal |
| `swiss-dark` | composition | stacked | tab-strip | sticker | ledger | compact | reduced |
| `swiss-editorial` | composition | editorial | sidebar | index-entry | magazine-index | spacious | reduced |
| `soft-product-minimal` | composition | sidebar | sidebar | flat-row | ledger | normal | reduced |
| `terminal-crt` | composition | sidebar | sidebar | terminal-line | character-list | compact | reduced |
| `neo-brutalism` | composition | sidebar | sidebar | panel | solid-grid | normal | reduced |

The four registry entries not captured are Tier-1/2 token themes
(`default`, `academic-lab`, `monochrome-research`, `y2k-digital`): their
difference is palette and type scale, which a page screenshot shows poorly and a
swatch grid shows correctly. They still appear in the Style Gallery with their
own specimen.

## Pages

- `--overview` — the environment report (capability rows, hardware limits)
- `--resources` — the resource explorer (the densest card grid, so the card
  grammar and the composition grammar are both visible here)
- `--style` — the style gallery (specimens of every experience at once, which is
  where the gallery's own presentation grammar shows)
