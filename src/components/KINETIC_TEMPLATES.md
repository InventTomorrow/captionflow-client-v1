# Anime Edit — per-letter caption template

**One template** (`style.template === 'animeEdit'`, "Anime Edit" in the picker)
where every letter is an independently positioned, rotated, sized and coloured
object rather than a word in a line of text.

It has **five internal looks**, and picks one per caption. That is the whole
point: it replaces what an AMV editor does by hand — varying the treatment line
by line so a sequence never reads as one repeated effect. The user chooses the
template once; the engine does the rest. This is the same one-id/many-sub-looks
shape as `mixed`/`mixed2`, which cycle 8 curated sub-styles.

The five looks are **not** separately selectable and are not values of
`style.template`:

| Look | What it does |
| --- | --- |
| `scatteredStack` | Words stacked down the frame at mixed sizes and tilts; vowels flicked to the accent colour |
| `neonDisappear` | Centred phrase, letters revealing left to right inside a neon bloom |
| `letterChaos` | Every letter scattered across the frame at its own size and angle, flying in from off-screen |
| `impactSlam` | Words slam down from above with spring overshoot, then a shake that decays over 400 ms |
| `glitchSplit` | Centred phrase with scheduled RGB chromatic aberration and cyan/red glitch spikes |

## How a look is chosen

`pickKineticLook(wordCount, rng, recent)` — the "editor" in the template:

- **Short lines (≤2 words)** get the punchy treatments (`impactSlam`,
  `letterChaos`). One or two words have room to be thrown around the frame.
- **Long lines (≥6 words)** get the single-baseline treatments
  (`neonDisappear`, `glitchSplit`). Scattering eight words is unreadable.
- **Everything else** draws from a mid bucket weighted toward `scatteredStack`,
  the signature look of the set.
- **Never repeat a look used in the last two captions.** Repetition is what
  makes an edit read as "a filter was applied" rather than "someone made this".
  The candidate list is filtered rather than re-rolled, because a two-entry
  bucket would otherwise keep landing on the excluded look.

The choice is drawn from the caption's own seeded RNG, so it is identical in the
preview and the export, and stable across re-exports.

## The contract

Every other template in this project keeps the preview and the burn-in in sync
by **hand-mirroring constants** — `HERO_WORD_TIERS` against `.tpl-heroWord`,
`MIXED_STYLE_SPECS` against `.cap-mixed-N`. Per-letter layout has far too many
numbers for that to hold, so this template works differently:

> **There is one implementation, and both renderers run it.**
> `lib/kinetic/engine.ts` computes the layout and draws the frames. The browser
> preview calls it on a `<canvas>`; the export calls it on `@napi-rs/canvas`.
> Neither renderer contains any template maths of its own.

| Where | File |
| --- | --- |
| The engine (canonical) | [`client/src/lib/kinetic/engine.ts`](../lib/kinetic/engine.ts) |
| The engine (synced copy) | `server/src/services/kinetic/engine.ts` |
| Browser adapter (fonts, DPR, metrics) | [`client/src/lib/kinetic/browser.ts`](../lib/kinetic/browser.ts) |
| Preview component | [`KineticCaptionLayer.tsx`](./KineticCaptionLayer.tsx) |
| Export renderer | `server/src/services/kineticPng.service.ts` |
| ffmpeg wiring | `server/src/services/export.service.ts` → `renderVideo`, `opts.kineticFrames` |
| Accent word picking | `server/src/services/emphasis.service.ts` |

`client/` and `server/` are separate git repos that deploy independently, so a
repo-root `shared/` folder would ship with neither. The **client copy is
canonical**; `npm run kinetic:sync` (in `server/`) copies it across, and
`npm run test:smoke` fails if the two have drifted.

**Never hand-edit the server copy.** Edit the client copy and re-sync.

## The five rules the engine enforces

1. **Layout is normalised.** Positions are fractions of the frame (`nx`, `ny`,
   `nSize`), never pixels. One composition is correct at a 640×360 preview and
   a 3840×2160 export.
2. **Layout uses real font metrics.** Letter advances come from `measureText()`,
   cached as scale-free ratios. The spec these were built from advanced each
   letter by `fontSize * 0.58`; Bebas Neue is ~0.45 em, so that guess overlaps
   letters the moment the font is anything but the one it was tuned on.
3. **Layout is seeded.** All randomness comes from `seedForCaption()`, hashed
   from the caption's own text and sequence. Preview and export therefore
   generate the *same* scatter with nothing persisted, and re-exporting an
   unedited project reproduces it exactly.
4. **Animation is a pure function of time.** No `Math.random()` in `animate()`,
   no per-frame counters. `renderKineticFrame(t)` twice at the same `t` gives
   byte-identical pixels — which is what makes a frame-stepped export
   trustworthy. Shake and glitch sample deterministic hash noise on a fixed
   clock (24 Hz and 15 Hz), so a 144 Hz browser and a 30 fps export agree.
5. **Every size is relative.** Shadow offsets, glow radii and chroma splits are
   in em, so they scale instead of vanishing at 1080 or swamping the frame at
   360.

## Fonts

The face is **pinned per look** and cannot be changed from the Text panel.
These layouts depend on a condensed display face; letting a user select Caveat
or Noto Nastaliq would break them. Same principle as `KINETIC_FONT_FILES` in
`captionPng.service.ts`.

| Look | Family | File in `server/fonts/` | Weight |
| --- | --- | --- | --- |
| `scatteredStack`, `neonDisappear`, `letterChaos`, `impactSlam` | Bebas Neue | `BebasNeue-Regular.ttf` | 400 |
| `glitchSplit` | Orbitron | `Orbitron-Bold.ttf` | 700 |

Both are already bundled (`BUNDLED_FONT_FILES` + `download-fonts.mjs TARGETS`)
and already `@import`ed in `client/src/index.css`. Because one project intercuts
looks, **both faces must be loaded before the first frame**, and metrics are
cached per face (not per look) so the four Bebas Neue looks measure once.

**Bebas Neue ships one weight.** Asking for 900 makes the browser synthesise a
fake bold by smearing outlines, which is why display type rendered mushy in the
original. `KINETIC_FONTS` pins weight 400 deliberately — do not "fix" it.

### Proving the two sides use the same font

Canvas does **not** trigger a webfont download the way DOM text does. Without a
gate, the first frames rasterise in the fallback face *and the metrics cache is
built from the wrong font* — the "letters overlap or drift apart" bug.

- Preview: `ensureKineticFontReady()` blocks the first draw on
  `document.fonts.load()` + `.check()`, and shows an orange banner over the
  video if the family never arrived.
- Export: `registerKineticFace()` logs at **error** level if the TTF is missing.

Every composition carries `fingerprints` — the measured width of
`HAMBURGEFONTSIV` × 10000, per look. Both sides compute them; **if they differ,
the two are using different fonts and the export will not match.** Current
values: Bebas Neue `58030`, Orbitron `118810`.

## Colour

| Role | Source |
| --- | --- |
| Plain letters | `style.color` |
| Accent letters, hero word | `style.highlightColor` |
| `letterChaos` dim letters | `#8c8c8c` (intrinsic) |
| `impactSlam` last-letter punch | `#f97316` (intrinsic) |
| `glitchSplit` RGB split | `#00f0ff` / `#e11d48` (intrinsic) |

The intrinsic colours follow the `KINETIC_ACCENT` precedent — they are part of
the look, not a user setting.

## Which word gets the accent

**The project's existing AI emphasis drives this.** `pickHeroWords`
(`emphasis.service.ts`) already labels one `hero` word per caption for every
project regardless of template, so these work on any already-transcribed
project with no new schema, no new UI and no new server field.

`kineticHeroWordIndices()` resolves it with the same rule as `emphasisSet()`
(preview) and `kineticHeroIndices()` (PNG export): manual `'hero'` roles win,
otherwise the single longest word. The hero word is scaled by `HERO_SCALE`
(1.25×) and forced to the accent colour.

The source spec had a separate trigger-word system (`FIRE`/`KILL`/`BURN` with
per-word colour, scale and effect). It was deliberately **not** built: it would
have duplicated emphasis with a parallel schema, Zod enum, Mongoose field,
editor UI and export mirror. If it is ever wanted, it layers on top of
`heroWords` without touching the layout engine.

## Reveal and timing

Display mode is pinned to `phrase` by `stackedDisplayMode()` **on both sides** —
the editor cannot switch these to karaoke or word, which would fight the
engine's own per-letter stagger.

One **scene == one caption**. The engine deliberately does no grouping of its
own: this project already groups words into captions (`displayCaptions.ts` on
the client, `regroupForDisplay()` on the server), and grouping again would
double-group.

A caption always lives long enough to finish its own entry animation
(`max(captionDuration, animMs)`), so a short caption never cuts off mid-slam,
then holds 220 ms and fades out over 200 ms.

Long captions are protected by `fitToSafeArea()`, which shrinks and recentres
the whole composition inside a 5% / 7% margin. Text running off frame reads as
"broken" to a user far more often than any animation bug does.

## Export architecture

These are the **third** burn-in renderer in the project, and they had to be:

- **ASS/libass** positions text, but every letter here has its own position,
  rotation, size and colour, animating continuously — thousands of `Dialogue`
  events per caption, and libass still could not do the neon bloom or the
  additive RGB split.
- **`captionPng.service.ts`** renders one static PNG per caption, so nothing
  can move *inside* a caption's window, which is the entire point.

So `kineticPng.service.ts` renders a real frame sequence with the shared engine.

### Why raw frames, not a PNG sequence

Frames are **never encoded and never hit disk**. `canvas.data()` returns the raw
RGBA buffer, which is streamed into ffmpeg's stdin as `rawvideo` from a
pull-based `Readable` — ffmpeg's consumption rate sets the pace, and memory
stays at one frame plus two frames of slack.

PNG-encoding a sequence instead cost 95–160 ms per 1080p frame (and ~830 ms for
`neonDisappear`), i.e. 8–75 minutes for a 3-minute clip, plus tens of GB through
the export disk. Current cost, measured at 1080p, is 5–14 ms per frame to draw;
the export as a whole runs at **0.6–0.8× realtime**, so a 3-minute video takes
about two minutes — in line with the other export paths.

Two things that bite on this path:

- **`-framerate` must precede the input.** It declares what the piped stream
  *is*. `-r` after the input instead resamples a rate ffmpeg already assumed,
  duplicating and dropping frames — visible as stuttering animation.
- **Skia hands back premultiplied alpha; ffmpeg's `rgba` expects straight.**
  Feeding it directly darkens every soft edge (worst on the bloom), so the
  filter chain runs `unpremultiply=inplace=1` before compositing.

### Why the neon bloom is strokes, not `shadowBlur`

`neonDisappear` originally drew two blurred passes per letter. Measured at
1080p, canvas charges a **fixed ~20 ms per glyph for any `shadowBlur` at all** —
essentially flat from radius 8 (401 ms/frame for 20 glyphs) to radius 105
(492 ms/frame). Capping the radius therefore buys nothing; the blur itself is
the cost. Two passes came to ~950 ms per frame, which is ~56 minutes for a
3-minute export **and would have run the live preview at about 1.6 fps.**

The bloom is now six concentric `strokeText` rings (`NEON_HALO`), widest and
faintest first, under a hot near-white core: 13.5 ms/frame, a 49× improvement,
and being plain geometry rather than a filter it is guaranteed to rasterise
identically in the browser and in skia. Six steps rather than three — too few
rings read as visible banding instead of a glow.

Beware when profiling this: **skia is lazy.** `renderKineticFrame` only records
draw operations; rasterisation happens on `canvas.data()` / `toBuffer()`. Timing
the draw call alone reports ~3 ms for a frame that actually costs 628 ms, and
attributes the blur to whatever encodes the buffer afterwards. `_kinetic-diag.ts`
forces rasterisation per frame for this reason.

## Deliberate limitations

These templates own the whole frame, so `EditorPage` swaps `CaptionOverlay` out
for `KineticCaptionLayer` entirely. That means, by design:

- **no click-a-word-to-select**, no per-word colour/size overrides, no
  delete-word-on-video — there are no word elements to click
- **no corner-resize handles on the canvas** — size is adjustable, but through
  the Text panel slider rather than by dragging a corner (see below)
- **`style.fontFamily` and the global `position` are ignored** — the face is
  pinned per look, and placement is per-letter

`style.color` and `style.highlightColor` *are* honoured, and are the two
controls that meaningfully restyle this template.

## Placing a chunk by hand

A caption **can** be dragged to place it. That writes `Caption.offsetX/offsetY`
(% of canvas, centre anchor) through `onChunkStyleCommit` — the identical
per-chunk override the DOM templates use — so it persists to IndexedDB and
travels into the export payload with no new field.

Mechanically:

- The drag moves the **whole caption**, never a single letter: the letters'
  relative arrangement *is* the look.
- It writes `scene.anchorX/anchorY`, which `kineticSceneShift` turns into a
  translation **at draw time**. The seeded layout is never re-run, so the
  scatter does not reshuffle under the cursor mid-drag.
- The anchor is clamped so the caption's bounding box stays **on canvas** —
  deliberately not to the safe area. The safe margin governs automatic
  placement; a manual drag is the user overriding that on purpose, and clamping
  to the safe area left a tall look like `impactSlam` only ~40–59% of vertical
  travel instead of ~34–66%.
- A composition that is nearly frame-height therefore has little room to move.
  That is physical, not a bug: it cannot go further without leaving frame.

Only `'chunk'` scope is wired from the canvas (place this one caption). The
`'all'` scope the DOM overlay offers via its confirm toolbar is not surfaced
here yet — `handleChunkStyleCommit` already supports it if wanted.

## Sizing

Two multipliers, which compose:

| Control | Field | Meaning |
| --- | --- | --- |
| Text panel size slider (24–96) | `style.fontSize` | `fontSize / KINETIC_BASE_FONT_SIZE` (64). 64 = as authored, 96 = 1.5×, 32 = 0.5× |
| Per-chunk override | `Caption.sizeScale` | 100 = normal, composes on top of the slider |

The scale is applied by `scaleAbout()` — the whole composition scales about its
own centre — rather than by passing a multiplier into each look's `build()`.
That keeps every look's internal geometry exactly as authored: advances, wraps
and the scatter all scale together, so larger text never overlaps itself.

Two traps this had to solve, both found by measuring rather than by eye:

1. **A naive fit silently cancels the slider.** Default compositions already
   fill the safe area, so `fitToSafeArea` would shrink any increase straight
   back and the slider would appear dead. The available box therefore grows
   with the requested scale (`requestedScale`), up to the frame.
2. **The frame is not the limit — ink is.** `boundsOf()` measures the GLYPH
   box, but every look paints past it: impactSlam's drop shadow and outline
   stroke, neonDisappear's halo, glitchSplit's chroma split. Letting a grown
   composition fill the frame exactly clipped the bottom row. `KINETIC_PAINT_BLEED`
   (2.5% per edge) is the allowance, and it also bounds the drag clamp.

Growth is capped by the frame, so at maximum both `fontSize: 96` and
`sizeScale: 200` land on the same ceiling — a composition cannot grow past what
fits. Verify with `npx tsx src/scripts/_kinetic-size.ts`.

Verify with `npx tsx src/scripts/_kinetic-offset.ts`, which renders a caption at
several requested centres including out-of-range ones and asserts no letter
leaves the canvas.

## Adding or changing a template

1. Edit **`client/src/lib/kinetic/engine.ts`** only.
2. `cd server && npm run kinetic:sync`.
3. To add a new LOOK: add it to `KINETIC_LOOK_NAMES`, give it an entry in
   `KINETIC_TEMPLATES` and `KINETIC_FONTS`, and put it in a bucket in
   `pickKineticLook` — otherwise it is defined but never chosen.

   The template id `animeEdit` is already registered in the four places that
   need it, and only changes if you rename the template:
   - `CaptionTemplate` union — `client/src/components/CaptionOverlay.tsx`
   - picker preset — `client/src/lib/captionTemplates.ts` (`ANIME_EDIT`)
   - Zod `styleSchema` — `server/src/controllers/project.controller.ts`
     (without it `PATCH /projects/:id/style` 400s and the choice never persists;
     the client swallows that error)
   - Mongoose `style.template` enum — `server/src/models/Project.ts`
4. If it needs a new face, add it to `BUNDLED_FONT_FILES`
   (`export.service.ts`) **and** `TARGETS` (`scripts/download-fonts.mjs`), and
   `@import` it in `client/src/index.css`.
5. Verify, from `server/`:
   - `npx tsx src/scripts/_kinetic-check.ts` — renders every template through
     the real ffmpeg graph and reports realtime factor
   - `npx tsx src/scripts/_kinetic-diag.ts` — per-frame cost (forcing skia to
     rasterise, so a perf regression like the `shadowBlur` one above shows up),
     plus the look chosen per caption, the distribution, and a back-to-back
     repeat count that should always be 0
   - `npx tsx src/scripts/_kinetic-preview.ts` — one frame per caption on a
     dark ground, named by look, for eyeballing
