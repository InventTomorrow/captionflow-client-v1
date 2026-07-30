# Hero Word — caption template spec

Progressive word-reveal caption with an AI-picked **hero** and **support** word.

```
0.0s   Hi
0.8s   Hi how
1.6s   Hi how are
2.4s   Hi how are YOU?
```

Selected in the editor's template picker as **Hero Word** (`template: 'heroWord'`).

## The contract

There is exactly **one** implementation. The live preview and the burned-in
export are two renderers driven by the same numbers, and they are expected to
produce the same pixels — same face, same size, same position, same alignment,
same line breaks.

| Where | File |
| --- | --- |
| Preset (what the picker applies) | [`client/src/lib/captionTemplates.ts`](../lib/captionTemplates.ts) → `HERO_WORD_TEMPLATE` |
| Preview markup | [`CaptionOverlay.tsx`](./CaptionOverlay.tsx) → `CaptionWords`, `template === 'heroWord'` |
| Preview styling | [`client/src/index.css`](../index.css) → `.caption-overlay.tpl-heroWord` |
| Export (ASS/libass) | [`server/src/services/export.service.ts`](../../../server/src/services/export.service.ts) → `HERO_WORD_TIERS`, `heroWordDialogue` |
| Hero/support picking | [`server/src/services/emphasis.service.ts`](../../../server/src/services/emphasis.service.ts) |

**If you change a number, change it on both sides.** `HERO_WORD_TIERS` and
`.tpl-heroWord` are the two halves of one definition.

## Word tiers

Sizes are multiples of `style.fontSize`, which is authored against a 1080-tall
frame and scaled by `frameHeight / 1080` in both renderers.

| Tier | Size | Face | Color | Case |
| --- | --- | --- | --- | --- |
| `hero` | 1.55× | Montserrat 900 (`Montserrat Black`) | `style.highlightColor` (default `#FF2D9A`) | UPPERCASE |
| `support` | 1.55× | Playfair Display 400 *italic* | `style.color` — **not** colored, **not** bold | as written |
| `normal` | 0.72× | Montserrat 700 (`Montserrat`) | `style.color` | as written |

Exactly one hero and one support per caption; everything else is normal.

Each family has exactly **one** face in the export fontsdir and it already
carries the right weight/slant, so the ASS tags never ask libass for `\b1` or
`\i1` — that would stack a synthetic bold/oblique on top of a real one.

The three faces must exist in `server/fonts/`:

```
Montserrat-Black.ttf        → family "Montserrat Black"   (hero)
Montserrat-Bold.ttf         → family "Montserrat"         (normal)
PlayfairDisplay-Italic.ttf  → family "Playfair Display"   (support)
```

If any is missing, `isolateHeroWordFonts` logs a warning and the export falls
back to the ordinary single-font path rather than burning a wrong typeface.

## Who picks hero and support

The emphasis agent (`pickHeroWords`, gpt-4.1-mini) runs once during
transcription/rebuild, for **every** project regardless of template, and stores
a per-caption `emphasis` array aligned with `text.split(/\s+/)`:

- `'hero'` → the single most impactful word
- `'small'` → the support word
- `'auto'` → normal

It never picks filler/function words (including Roman-Urdu particles), and a
deterministic longest-content-word fallback covers a model failure. Editing a
word's role in the Phrases panel overrides the agent — manual roles win.

Both renderers resolve roles through the same rule (`resolveHeroSupportIdx` /
`heroWordTiers`), so a caption with no stored roles still gets one hero and one
support instead of falling back to flat text.

## Layout

Plain **centered inline text**, deliberately not flexbox — that is how libass
lays a caption out:

- words are `inline-block` on a shared baseline (`vertical-align: baseline`)
- the separator is a real space at the **base** size in the normal face, so the
  gap never changes with the tiers around it — the export writes the same
  `{\fnMontserrat\fs<base>} `
- line breaks happen at spaces; a trailing space hangs instead of pushing the
  line off-center
- the **hero AND support words each always get a forced break before and
  after them**, landing alone on their own centered line — words before,
  between, and after them still wrap normally among themselves. Adjacent
  isolated words (e.g. support immediately followed by hero) share a single
  break between them, never a blank line. Preview: a `<br/>` on each side of
  every isolated word (`CaptionWords`, `template === 'heroWord'`). Export:
  `heroWordWrapGroups` splits the word list at every hero/support index and
  wraps each remaining run independently, always giving each isolated word
  its own `\N`-delimited group.
- `line-height: 1.2` ≈ Montserrat's ascent+descent, which is what libass uses to
  space `\N` lines
- line width caps at 90% of the canvas width in both renderers

libass cannot measure text for us and `\pos` disables its own wrapping, so the
export computes breaks itself in `heroWordWrapGroups`, measuring each word at
its own tier via `HERO_WORD_TIERS[...].charW`.

## Reveal

`displayMode: 'paintOn'`, pinned by `stackedDisplayMode()` on both sides — the
editor cannot switch this template to karaoke/word, which would flatten the
per-word sizing.

**The whole phrase is always laid out.** Words that have not been spoken yet are
transparent, not absent. That is what makes the block stable: no word ever moves
once it lands.

- Preview: every word mounts on frame one; `behavior === 'paint'` animates
  opacity (plus a layout-neutral CSS `scale` pop).
- Export: one Dialogue event per word, each drawing the full tiered block with
  `\alpha&HFF&` on the not-yet-spoken words. The word that just landed fades in
  with `\t(0,90,\alpha&H00&)`.

Steps are **gapless** (`heroWordSteps`, unlike the shared `exclusiveWordBounds`
which leaves a 1cs hole): every step draws the same block, so a hole would blink
the caption for a frame on each new word.

One deliberate difference: the export fades a new word in rather than popping
it. ASS `\fscx/\fscy` changes a glyph's advance width, so an export-side pop
would resize the line and shove its neighbours around mid-caption. The CSS
`transform` in the preview is layout-neutral, so it can pop safely. Everything
that determines where a word sits is identical; only the 90–180 ms landing
easing differs.
