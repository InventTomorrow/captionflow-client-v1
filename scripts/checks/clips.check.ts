/**
 * Offline checks for the Clips client helpers (pure functions only).
 * Run: npx tsx scripts/checks/clips.check.ts
 */
import type { Caption } from '../../src/stores/captionStore';
import { sliceCaptionsToRange } from '../../src/lib/clips/sliceCaptions';
import { buildExportStyle } from '../../src/lib/export/styleSnapshot';
import { aspectDims, chunks, clipAspect, clipLayout, deferredIn, clipFrameTime, clipStyle, exportFramingFor, thumbKey, cropTrackFor, expectedSource, needsFaceTrack, textInRange } from '../../src/lib/clips/clipMath';
import { coverObjectPosition, cropRect, cropXAt, integerCrop, smoothTrack, type FaceSample } from '../../src/lib/clips/cropTrack';
import { createLatestGate } from '../../src/lib/clips/latestGate';
import { forgetsProject } from '../../src/lib/media/retentionRules';
import { CAPTION_LANGUAGE_OPTIONS, SPOKEN_LANGUAGE_OPTIONS } from '../../src/lib/languageLabel';
import { clipChanges, clipEditBasis, clipProjectCaptions } from '../../src/lib/clips/clipProject';
import { clipClock, clipFontFactor, clipFraming, shiftCaptions } from '../../src/lib/clips/clipClock';
import { feedHeightFor, formatSourceTime, playFallback, reelMountSet, sourceSpan, stepReel } from '../../src/lib/clips/reelFeed';
import { refusedByServer } from '../../src/lib/clips/refused';
import { MIN_REGION, clampRect, coverRatio, defaultFraming, framingKey, layoutRegions, layoutVideoType, panelAspect, readFraming, regionFit, splitOf, withRatio } from '../../src/lib/clips/framing';
import { drawLayout, hasBars, panelDraw, panelsFor } from '../../src/lib/clips/layout';

let passed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── createLatestGate (only the newest feed request may write the list) ──
{
  const g = createLatestGate();
  const first = g.next();
  const second = g.next();
  assert(!g.isCurrent(first), 'an older request is stale once a newer one starts');
  assert(g.isCurrent(second), 'the newest request is current');
}

function cap(seq: number, words: Array<[string, number, number]>, extra: Partial<Caption> = {}): Caption {
  return {
    sequence: seq,
    start: words[0][1],
    end: words[words.length - 1][2],
    text: words.map((w) => w[0]).join(' '),
    words: words.map(([word, start, end]) => ({ word, start, end })),
    ...extra,
  };
}

// ── sliceCaptionsToRange ────────────────────────────────────────────────
{
  // RF5: a caption straddling the clip start keeps only the words inside it.
  const out = sliceCaptionsToRange(
    [cap(1, [['one', 9.0, 9.5], ['two', 9.5, 10.0], ['three', 10.0, 10.5]])],
    10,
    30,
  );
  assert(out.length === 1, 'straddling caption survives as one caption');
  assert(out[0].text === 'three', `only the in-range word is kept, got "${out[0].text}"`);
  assert(near(out[0].start, 0), `caption rebased to 0, got ${out[0].start}`);
  assert(near(out[0].end, 0.5), `caption end rebased, got ${out[0].end}`);
  assert(out[0].words?.length === 1 && near(out[0].words[0].start, 0), 'word times rebased');
  const allTimes = out.flatMap((c) => [c.start, c.end, ...(c.words ?? []).flatMap((w) => [w.start, w.end])]);
  assert(allTimes.every((t) => t >= 0), 'no negative times after slicing');
}
{
  // A caption fully inside the range only shifts by −start.
  const out = sliceCaptionsToRange([cap(4, [['hello', 12, 12.4], ['world', 12.4, 13]])], 10, 30);
  assert(out.length === 1 && out[0].text === 'hello world', 'inner caption kept whole');
  assert(near(out[0].start, 2) && near(out[0].end, 3), 'inner caption shifted by -start');
  assert(near(out[0].words![1].start, 2.4), 'inner words shifted by -start');
  assert(out[0].sequence === 1, 'sequence renumbered from 1');
}
{
  // A caption straddling the clip end is clamped at the range end.
  const out = sliceCaptionsToRange([cap(1, [['last', 29.5, 30.5], ['gone', 30.5, 31]])], 10, 30);
  assert(out.length === 1 && out[0].text === 'last', 'word past the end dropped');
  assert(near(out[0].end, 20), `end clamped to range end, got ${out[0].end}`);
}
{
  // emphasis / wordStyles stay aligned with the kept words.
  const out = sliceCaptionsToRange(
    [
      cap(1, [['a', 9, 9.5], ['b', 9.85, 10.4], ['c', 10.4, 11]], {
        emphasis: ['hero', 'small', 'normal'],
        wordStyles: [{ color: '#f00' }, { scale: 120 }, {}],
      }),
    ],
    10,
    30,
  );
  assert(out[0].text === 'b c', `partially overlapping word is kept, got "${out[0].text}"`);
  assert(out[0].emphasis?.join(',') === 'small,normal', `emphasis aligned, got ${out[0].emphasis}`);
  assert(out[0].wordStyles?.[0].scale === 120, 'wordStyles aligned');
  assert(near(out[0].start, 0), 'clamped word starts at 0');
}
{
  // RF5 at the padded edges: a neighbouring sentence's word that only pokes
  // into the 0.25 s / 0.35 s padding is not shown (word midpoint decides).
  const out = sliceCaptionsToRange(
    [cap(1, [['previous.', 9.4, 9.9]]), cap(2, [['Hook', 10.1, 10.5], ['payoff.', 38.0, 40.0]]), cap(3, [['Next', 40.2, 40.6]])],
    9.85,
    40.35,
  );
  assert(out.map((c) => c.text).join('|') === 'Hook payoff.', `edge words from neighbours dropped, got "${out.map((c) => c.text).join('|')}"`);
}
{
  // Captions entirely outside are dropped; remaining ones renumbered in order.
  const out = sliceCaptionsToRange(
    [cap(1, [['before', 1, 2]]), cap(2, [['in1', 15, 16]]), cap(3, [['after', 40, 41]]), cap(4, [['in2', 20, 21]])],
    10,
    30,
  );
  assert(out.map((c) => c.text).join('|') === 'in1|in2', 'outside captions dropped, order by time');
  assert(out.map((c) => c.sequence).join(',') === '1,2', 'sequence renumbered');
}
{
  // Captions without aligned words fall back to wordTimes() even spreading.
  const noWords: Caption = { sequence: 1, start: 8, end: 12, text: 'w1 w2 w3 w4' };
  const out = sliceCaptionsToRange([noWords], 10, 30);
  assert(out[0].text === 'w3 w4', `spread fallback keeps the later half, got "${out[0].text}"`);
  assert(near(out[0].start, 0) && near(out[0].end, 2), 'spread fallback rebased');
}

// ── cropXAt ─────────────────────────────────────────────────────────────
assert(near(cropXAt([[0, 0.2], [2, 0.6]], 1), 0.4), 'cropXAt interpolates');
assert(near(cropXAt([[0, 0.2], [2, 0.6]], -5), 0.2), 'cropXAt clamps before first key');
assert(near(cropXAt([[0, 0.2], [2, 0.6]], 9), 0.6), 'cropXAt clamps after last key');
assert(near(cropXAt([], 3), 0.5), 'empty track centers');
assert(near(cropXAt([[1, 0.7]], 0), 0.7), 'single key holds');

// ── cropRect ────────────────────────────────────────────────────────────
{
  const r = cropRect(1920, 1080, 1080, 1920, 0.5);
  assert(near(r.width, 607.5) && near(r.height, 1080), `16:9→9:16 width 607.5, got ${r.width}`);
  assert(near(r.left, 656.25) && near(r.top, 0), `centered left 656.25, got ${r.left}`);
  const l = cropRect(1920, 1080, 1080, 1920, 0);
  assert(near(l.left, 0), 'cx=0 clamps to the left edge');
  const rr = cropRect(1920, 1080, 1080, 1920, 1);
  assert(near(rr.left + rr.width, 1920), 'cx=1 clamps to the right edge');
  // RF2: a source already at (or narrower than) the output aspect is not cropped sideways.
  const p = cropRect(1080, 1920, 1080, 1920, 0.9);
  assert(near(p.left, 0) && near(p.top, 0) && near(p.width, 1080) && near(p.height, 1920), 'portrait source keeps the full frame');
  const tall = cropRect(1080, 2400, 1080, 1920, 0.2);
  assert(near(tall.width, 1080) && near(tall.height, 1920) && near(tall.top, 240), 'taller source: full width, height centered');
}

// ── integerCrop (Mediabunny needs whole-pixel crops) ────────────────────
{
  const all = [0, 0.13, 0.5, 0.77, 1].map((cx) => integerCrop(cropRect(1920, 1080, 1080, 1920, cx), 1920, 1080));
  for (const r of all) {
    assert([r.left, r.top, r.width, r.height].every(Number.isInteger), `integer crop, got ${JSON.stringify(r)}`);
    assert(r.left >= 0 && r.top >= 0 && r.left + r.width <= 1920 && r.top + r.height <= 1080, 'integer crop stays inside the source');
    assert(Math.abs(r.width / r.height - 1080 / 1920) < 0.002, 'integer crop keeps the output aspect');
  }
  assert(all[2].left === 656 && all[2].width === 608, `centre crop snaps to 656/608, got ${all[2].left}/${all[2].width}`);
  const odd = integerCrop(cropRect(1279, 719, 1080, 1920, 1), 1279, 719);
  assert(odd.left + odd.width <= 1279, 'right-edge crop never overflows an odd-width source');
}

// ── smoothTrack (face samples → camera path) ────────────────────────────
{
  const at = (track: Array<[number, number]>, t: number) => cropXAt(track, t);
  const series = (fn: (t: number) => FaceSample['faces'], seconds: number): FaceSample[] =>
    Array.from({ length: seconds * 2 + 1 }, (_, i) => ({ t: i / 2, faces: fn(i / 2) }));

  // Jitter inside the dead zone never moves the camera.
  const jitter = smoothTrack(series((t) => [{ cx: (t * 2) % 2 ? 0.52 : 0.5, area: 0.1 }], 6));
  const xs = jitter.map(([, x]) => x);
  assert(Math.max(...xs) - Math.min(...xs) < 1e-9, `dead zone holds still, got ${xs.join(',')}`);

  // A big jump (camera cut / speaker switch) is a hard cut: no pan across empty background,
  // and no anticipation — the camera moves only after the median has seen the new position.
  const jump = smoothTrack(series((t) => [{ cx: t < 1 ? 0.2 : 0.8, area: 0.1 }], 8));
  assert(at(jump, 0) < 0.21 && Math.abs(at(jump, 1) - 0.2) < 1e-9, 'holds the old framing until the cut is seen');
  assert(Math.abs(at(jump, 1.5) - 0.8) < 1e-9, `snaps to the new framing, got ${at(jump, 1.5)}`);
  assert(Math.abs(at(jump, 1.01) - 0.8) < 1e-9, `the cut is instant, not a fast swipe (got ${at(jump, 1.01)} at t=1.01)`);
  assert(Math.abs(at(jump, 6) - 0.8) < 1e-9, 'stays there');

  // A moderate move pans, no faster than maxSpeed (0.18 at 0.35/s ≥ 0.51 s after t=1).
  const drift = smoothTrack(series((t) => [{ cx: t < 1 ? 0.4 : 0.58, area: 0.1 }], 8));
  const reach = drift.find(([, x]) => x > 0.579)?.[0] ?? Infinity;
  assert(reach >= 1 + 0.18 / 0.35 - 1e-6 && reach <= 3, `pans at the speed limit, reached at t=${reach}`);
  for (let i = 1; i < drift.length; i++) {
    const v = Math.abs(drift[i][1] - drift[i - 1][1]) / (drift[i][0] - drift[i - 1][0]);
    assert(v <= 0.35 + 1e-9, `pan speed ${v} at t=${drift[i][0]}`);
  }

  // Frames with no face hold the last framing.
  const gaps = smoothTrack(series((t) => (t <= 1 ? [{ cx: 0.3, area: 0.1 }] : []), 4));
  assert(Math.abs(at(gaps, 3.5) - 0.3) < 1e-9, `gap holds last value, got ${at(gaps, 3.5)}`);

  // Leading frames before the first face use that face's position.
  const late = smoothTrack(series((t) => (t >= 2 ? [{ cx: 0.7, area: 0.1 }] : []), 4));
  assert(Math.abs(at(late, 0) - 0.7) < 1e-9, `backfilled start, got ${at(late, 0)}`);

  // The biggest face wins.
  const two = smoothTrack(series(() => [{ cx: 0.2, area: 0.02 }, { cx: 0.75, area: 0.2 }], 3));
  assert(Math.abs(at(two, 1) - 0.75) < 1e-9, 'largest face is followed');

  // A lone mis-detection is filtered out (median of 5).
  const blip = smoothTrack(series((t) => [{ cx: t === 2 ? 0.95 : 0.4, area: 0.1 }], 5));
  assert(blip.every(([, x]) => Math.abs(x - 0.4) < 1e-9), 'single-frame blip ignored');

  assert(JSON.stringify(smoothTrack([])) === '[[0,0.5]]', 'no samples → centred');
  assert(JSON.stringify(smoothTrack(series(() => [], 3))) === '[[0,0.5]]', 'no faces → centred');
  assert(jitter.length <= 3, `flat stretches are compressed, got ${jitter.length} points`);
}

// ── buildExportStyle (shared by the editor export and clip renders) ──────
{
  const d = buildExportStyle({}, { defaultAspect: '9:16' });
  assert(d.template === 'classic' && d.fontSize === 48 && d.fontWeight === 700 && d.offsetY === 72, 'editor defaults');
  assert(d.aspectRatio === '9:16' && d.displayMode === 'phrase' && d.displayWords === 5, 'aspect/display defaults');
  assert(buildExportStyle({ aspectRatio: 'original' }, { defaultAspect: '9:16' }).aspectRatio === '9:16', '"original" → concrete aspect');
  const hero = buildExportStyle({ template: 'heroWord', highlightColor: '#FFFFFF', fontFamily: 'Inter' }, { defaultAspect: '9:16' });
  assert(hero.displayMode === 'paintOn' && hero.highlightColor === '#FF2D9A' && hero.fontFamily === 'Montserrat', 'Hero Word rules');
  assert(buildExportStyle({ template: 'blockbuster', displayMode: 'karaoke' }, { defaultAspect: '9:16' }).displayMode === 'phrase', 'kinetic forces phrase');
}

// ── clipMath (data-layer helpers) ───────────────────────────────────────
{
  const clip = { _id: 'c1', start: 10, end: 40, crop: { mode: 'auto' as const, x: 0.5, track: [[0, 0.3]] as Array<[number, number]> } };
  assert(Math.abs(clipFrameTime(clip) - 11.5) < 1e-9, 'poster frame 1.5 s in');
  assert(Math.abs(clipFrameTime({ ...clip, end: 12 }) - (10 + 2 / 3)) < 1e-9, 'short clip: a third in');
  assert(thumbKey(clip) !== thumbKey({ ...clip, start: 11 }), 'thumb key changes with the in-point');
  assert(thumbKey(clip) !== thumbKey({ ...clip, crop: { ...clip.crop, mode: 'manual', x: 0.8 } }), 'thumb key changes with framing');
  assert(thumbKey(clip) === thumbKey({ ...clip }), 'thumb key is stable');

  assert(JSON.stringify(cropTrackFor(clip)) === '[[0,0.3]]', 'auto → saved face track');
  assert(JSON.stringify(cropTrackFor({ ...clip, crop: { mode: 'manual', x: 0.8, track: [] } })) === '[[0,0.8]]', 'manual → fixed centre');
  assert(cropTrackFor({ ...clip, crop: { mode: 'none', x: 0.5, track: [] } }) === null, 'none → letterbox (no crop)');
  assert(JSON.stringify(cropTrackFor({ ...clip, crop: { mode: 'auto', x: 0.5, track: [] } })) === '[[0,0.5]]', 'auto without a track yet → centre');

  const base = { template: 'classic', fontFamily: 'Inter', color: '#00FF00', offsetY: 40, aspectRatio: '16:9', behindPerson: true };
  const st = clipStyle(base, { templateKey: 'hero-word' });
  assert(st.aspectRatio === '9:16' && st.behindPerson === false, 'clips are 9:16, never behind-person');
  assert(st.template === 'heroWord' && st.templateKey === 'hero-word', `template preset applied, got ${st.template}`);
  assert(st.offsetY === 40, 'keeps the project caption position');
  const keep = clipStyle(base, { templateKey: null });
  assert(keep.template === 'classic' && keep.color === '#00FF00' && keep.fontFamily === 'Inter', 'no template key → project look');
}

// ── expectedSource ("Locate file" must accept the real original) ─────────
{
  const e = expectedSource({ size: 1_200_000, originalSize: 11_884_111, duration: 91.96, originalDuration: 93.73 });
  assert(e.size === 11_884_111, 'matches the original upload size, not the uploaded audio');
  assert(e.durations.includes(93.73) && e.durations.includes(91.96), `both durations accepted, got ${e.durations}`);
  const bare = expectedSource({ duration: 60 });
  assert(bare.size === 0 && bare.durations.join() === '60', 'missing fields → unknown size');
}

// ── clipStyle with a look made in the captions editor ────────────────────
{
  const base = { template: 'classic', fontFamily: 'Inter', color: '#00FF00', offsetY: 40, aspectRatio: '16:9' };
  const look = { template: 'classic', templateKey: 'clean-phrase', fontFamily: 'Anton', color: '#FF0000', offsetY: 72, behindPerson: true };
  const st = clipStyle(base, { templateKey: 'beat-karaoke', style: look });
  assert(st.fontFamily === 'Anton' && st.color === '#FF0000' && st.offsetY === 72, 'the editor-made look wins over the template');
  assert(st.template === 'classic', `keeps the look's renderer, got ${st.template}`);
  assert(st.aspectRatio === '9:16' && st.behindPerson === false, 'still 9:16 and never behind-person');
  const none = clipStyle(base, { templateKey: null, style: null });
  assert(none.fontFamily === 'Inter', 'style null → project look');
}

// ── the clip preview frames like the render (object-position for a cover crop) ──
{
  assert(coverObjectPosition(1920, 1080, 9, 16, 0.5) === '50.00% 50.00%', 'centred crop');
  assert(coverObjectPosition(1920, 1080, 9, 16, 0) === '0.00% 50.00%', 'left edge');
  assert(coverObjectPosition(1920, 1080, 9, 16, 1) === '100.00% 50.00%', 'right edge');
  assert(coverObjectPosition(1920, 1080, 9, 16, 0.1) === '0.00% 50.00%', 'a face near the edge clamps the window inside the frame');
  assert(coverObjectPosition(1080, 1920, 9, 16, 0.9) === '50.00% 50.00%', 'portrait source: nothing to move');
}

// ── "Open in editor": the clip as its own project ─────────────────────────
{
  const clip = {
    _id: 'c1',
    start: 10,
    end: 40,
    aspect: '9:16' as const,
    templateKey: 'hero-word',
    style: null,
    crop: { mode: 'auto' as const, x: 0.5, track: [[0, 0.4], [2, 0.45]] as Array<[number, number]> },
  };
  const key = clipEditBasis(clip);
  assert(key === clipEditBasis({ ...clip }), 'the basis key is stable');
  for (const [what, changed] of [
    ['in-point', { ...clip, start: 11 }],
    ['out-point', { ...clip, end: 41 }],
    ['format', { ...clip, aspect: '16:9' as const }],
    ['framing', { ...clip, crop: { ...clip.crop, mode: 'manual' as const, x: 0.7 } }],
    ['face track', { ...clip, crop: { ...clip.crop, track: [[0, 0.6]] as Array<[number, number]> } }],
    ['template', { ...clip, templateKey: 'word-blast' }],
    ['custom look', { ...clip, style: { fontFamily: 'Anton' } }],
  ] as const) {
    assert(clipEditBasis(changed) !== key, `the basis key changes with the ${what}`);
  }
  assert(clipEditBasis(clip).length <= 300, 'fits the server limit');

  let n = 0;
  const caps = [
    cap(1, [['Before', 8, 9.5], ['it.', 9.5, 9.9]]),
    cap(2, [['Hello', 10.2, 10.6], ['there', 10.6, 11]], { emphasis: ['hero', 'small'], _id: 'orig-2' }),
    cap(3, [['General', 39.5, 39.9], ['Kenobi.', 39.9, 41]], { _id: 'orig-3' }),
  ];
  const copy = clipProjectCaptions(caps, clip, () => `new-${++n}`);
  assert(copy.length === 2, `the clip's captions only, got ${copy.length}`);
  assert(copy[0].start >= 0 && Math.abs(copy[0].start - 0.2) < 1e-9, `moved to start at 0:00, got ${copy[0].start}`);
  assert(copy.every((c) => c.end <= 30 + 1e-9), 'nothing past the clip');
  assert(copy.map((c) => c._id).join() === 'new-1,new-2', 'fresh ids (the original captions are never touched)');
  assert(copy.map((c) => c.sequence).join() === '1,2', 'renumbered');
  assert(copy[0].text === 'Hello there' && copy[0].emphasis?.join() === 'hero,small', 'text and hero words kept');
  assert(copy[1].text === 'General', `cut at the clip's end, got "${copy[1].text}"`);
  assert(caps[1]._id === 'orig-2' && caps[1].start === 10.2, 'the source captions are unchanged');
}

// ── a changed clip is applied to its editor project automatically ────────
{
  const clip = {
    start: 10,
    end: 40,
    aspect: '9:16' as const,
    templateKey: 'hero-word',
    style: null,
    crop: { mode: 'auto' as const, x: 0.5, track: [[0, 0.4]] as Array<[number, number]> },
  };
  const was = clipEditBasis(clip);
  const none = clipChanges(was, clipEditBasis(clip));
  assert(!none.range && !none.frame && !none.look, 'unchanged → nothing to apply');
  const trim = clipChanges(was, clipEditBasis({ ...clip, end: 42 }));
  assert(trim.range && trim.frame && !trim.look, 'trim → new captions and a new cut');
  const format = clipChanges(was, clipEditBasis({ ...clip, aspect: '16:9' }));
  assert(!format.range && format.frame && !format.look, 'format → a new cut, captions kept');
  const framing = clipChanges(was, clipEditBasis({ ...clip, crop: { ...clip.crop, mode: 'manual', x: 0.3 } }));
  assert(!framing.range && framing.frame && !framing.look, 'framing → a new cut, captions kept');
  const look = clipChanges(was, clipEditBasis({ ...clip, templateKey: 'word-blast' }));
  assert(!look.range && !look.frame && look.look, 'template → the new look only');
  const unknown = clipChanges(null, was);
  assert(unknown.range && unknown.frame && unknown.look, 'no record → apply everything');
}

// ── the clip clock: the editor sees only the clip, the original keeps playing ──
{
  const real = {
    currentTime: 30,
    duration: 300,
    ended: false,
    tag: 'video',
    play() {
      return this;
    },
  };
  const v = clipClock(real as unknown as HTMLVideoElement, { start: 25, end: 55 });
  assert(v.currentTime === 5, `30 s in the original is 0:05 of the clip, got ${v.currentTime}`);
  assert(v.duration === 30, `the clip's length, got ${v.duration}`);
  v.currentTime = 10;
  assert(real.currentTime === 35, `seeking 0:10 → 35 s in the original, got ${real.currentTime}`);
  v.currentTime = 100;
  assert(real.currentTime === 55, 'never past the clip');
  v.currentTime = -5;
  assert(real.currentTime === 25, 'never before the clip');
  real.currentTime = 55;
  assert(v.ended === true, 'the end of the clip is the end');
  assert((v.play as () => unknown)() === real, 'methods run on the real video');
  assert((v as unknown as { tag: string }).tag === 'video', 'everything else passes through');

  const caps = [cap(1, [['Hi', 0.2, 0.5], ['there', 0.5, 0.9]])];
  const abs = shiftCaptions(caps, 25);
  assert(abs[0].start === 25.2 && abs[0].words?.[1].end === 25.9, 'captions moved onto the original’s timeline for export');
  assert(caps[0].start === 0.2, 'the clip’s captions are untouched');

  // Captions sized against the frame's shorter side: a template keeps its authored size on a 1080-wide vertical frame.
  assert(clipFontFactor('9:16', true) === 0.5625, '9:16 cover');
  assert(clipFontFactor('4:5', true) === 0.8, '4:5 cover');
  assert(clipFontFactor('1:1', true) === 1 && clipFontFactor('16:9', true) === 1, 'square / landscape: as authored');
  assert(clipFontFactor('9:16', false) === 1, 'fit: as authored');

  const auto = { mode: 'auto' as const, x: 0.5, track: [[0, 0.3]] as Array<[number, number]> };
  assert(JSON.stringify(clipFraming(auto)) === JSON.stringify({ mode: 'cover', track: [[0, 0.3]] }), 'auto → the face track');
  assert(JSON.stringify(clipFraming({ ...auto, track: [] })) === JSON.stringify({ mode: 'cover', track: [[0, 0.5]] }), 'auto, no track yet → centre');
  assert(JSON.stringify(clipFraming({ mode: 'manual', x: 0.7 })) === JSON.stringify({ mode: 'cover', track: [[0, 0.7]] }), 'manual → fixed');
  assert(clipFraming({ mode: 'none', x: 0.5 }).mode === 'contain', 'fit → the whole frame');

  const tall = clipStyle({ template: 'classic', fontSize: 64 }, { templateKey: null, aspect: '9:16' });
  assert(Math.abs(tall.fontSize - 64 * 0.5625) < 0.01, `a 9:16 clip's captions keep their authored size on the 1080-wide frame, got ${tall.fontSize}`);
  const wide = clipStyle({ template: 'classic', fontSize: 64 }, { templateKey: null, aspect: '16:9' });
  assert(wide.fontSize === 64, 'a 16:9 clip keeps the size');
  const fit = clipStyle({ template: 'classic', fontSize: 64 }, { templateKey: null, aspect: '9:16', crop: { mode: 'none' } });
  assert(fit.fontSize === 64, 'Fit keeps the size (captions sit on the whole frame strip)');
  const tiny = clipStyle({ template: 'classic', fontSize: 14 }, { templateKey: null, aspect: '9:16' });
  assert(tiny.fontSize >= 12, 'never under the smallest size the server accepts');
}

// ── deleting a clip's render never wipes its video ───────────────────────
{
  assert(forgetsProject({ clipId: undefined }, true) === true, 'a video’s last render: its captions go with it');
  assert(forgetsProject({ clipId: 'c1' }, true) === false, 'a clip render is never “the video’s last video”');
  assert(forgetsProject({ clipId: undefined }, false) === false, 'not the last render: nothing else goes');
}

// ── textInRange (the in/out sentence shown next to the trim buttons) ─────
{
  const caps = [
    cap(1, [['Hello', 0, 0.5], ['world.', 0.5, 1]]),
    cap(2, [['How', 1.2, 1.5], ['are', 1.5, 1.8], ['you?', 1.8, 2.1]]),
  ];
  assert(textInRange(caps, 1.1, 2.2) === 'How are you?', `one sentence, got ${textInRange(caps, 1.1, 2.2)}`);
  assert(textInRange(caps, 0, 2.1) === 'Hello world. How are you?', 'spans captions');
  assert(textInRange(caps, 1.4, 1.9) === 'are', `only words mostly inside, got ${textInRange(caps, 1.4, 1.9)}`);
  assert(textInRange(caps, 5, 6) === '', 'nothing spoken → empty');
}

// ── clip format: 9:16 vertical (cropped) or 16:9 landscape (whole frame) ──
{
  const v = { _id: 'c9', start: 0, end: 10, crop: { mode: 'auto' as const, x: 0.5, track: [[0, 0.3]] as Array<[number, number]> }, aspect: '9:16' as const };
  const l = { ...v, aspect: '16:9' as const };
  assert(JSON.stringify(cropTrackFor(v)) === '[[0,0.3]]', 'vertical follows the face track');
  assert(cropTrackFor(l) === null, 'landscape keeps the whole frame');
  assert(thumbKey(v) !== thumbKey(l), 'the poster changes with the format');
  assert(clipAspect({}) === '9:16' && clipAspect(l) === '16:9', 'older clips are vertical');
  assert(aspectDims('16:9').join() === '16,9' && aspectDims('9:16').join() === '9,16', 'format dims');
  const st = clipStyle({ template: 'classic' }, { templateKey: null, aspect: '16:9' });
  assert(st.aspectRatio === '16:9', `landscape style, got ${st.aspectRatio}`);
  assert(clipStyle({ template: 'classic' }, { templateKey: null }).aspectRatio === '9:16', 'vertical by default');
  const untracked = { crop: { mode: 'auto' as const, x: 0.5, track: [] as Array<[number, number]> } };
  assert(needsFaceTrack(untracked) && !needsFaceTrack({ ...untracked, aspect: '16:9' }), 'no face tracking for landscape');
}

// ── one list of languages for the upload modal, the editor and New clips ──
{
  // Same values, same order as the server's translation agent (CAPTION_LANGUAGE_VALUES).
  assert(
    CAPTION_LANGUAGE_OPTIONS.map((o) => o.value).join() ===
      'keep_original,roman_urdu,roman_punjabi,english,urdu,hindi,arabic,german,spanish,french,turkish',
    'caption languages match the translation agent',
  );
  assert(CAPTION_LANGUAGE_OPTIONS.filter((o) => o.translate).length === 8, 'eight translation targets');
  assert(CAPTION_LANGUAGE_OPTIONS.every((o) => o.label && o.short), 'every caption language has a label and a short label');
  assert(SPOKEN_LANGUAGE_OPTIONS.map((o) => o.value).join() === 'auto,ur,pa,en,hi,ar,de,es,fr,tr', 'spoken languages');
}

// ── bulk actions go out in server-sized batches (≤ 200 ids per request) ──
{
  const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
  const parts = chunks(ids, 200);
  assert(parts.map((p) => p.length).join() === '200,200,50', `450 → 200,200,50, got ${parts.map((p) => p.length)}`);
  assert(parts.flat().join() === ids.join(), 'order kept, nothing lost');
  assert(chunks([], 200).length === 0, 'nothing → no requests');
}

// ── New Clips captions are finished (translated, hero words) only where needed ──
{
  const caps = [
    { sequence: 1, start: 0, end: 2, text: 'a b', deferred: true },
    { sequence: 2, start: 2, end: 4, text: 'c d' },
    { sequence: 3, start: 4, end: 6, text: 'e f', deferred: true },
  ] as Caption[];
  assert(deferredIn(caps, [{ start: 1, end: 3 }]), 'a range touching a deferred caption needs finishing');
  assert(!deferredIn(caps, [{ start: 2.5, end: 3.5 }]), 'a finished range needs nothing');
  assert(!deferredIn(caps, [{ start: 2, end: 4 }]), 'ranges that only touch a deferred caption’s edge need nothing');
  assert(deferredIn(caps, [{ start: 2.5, end: 3 }, { start: 5, end: 9 }]), 'any of several ranges');
  assert(!deferredIn(caps, []), 'no range → nothing to finish');
  assert(deferredIn(caps, 'all') && !deferredIn([caps[1]], 'all'), 'all');
}

// ── reels feed: which reels mount a player, keyboard steps, where a clip sits in the long video ──
{
  assert(JSON.stringify(reelMountSet(0, 5)) === '[0,1]', 'the active reel and the next one mount');
  assert(JSON.stringify(reelMountSet(4, 5)) === '[4]', 'the last reel has no next');
  assert(JSON.stringify(reelMountSet(0, 1)) === '[0]', 'a single clip');
  assert(JSON.stringify(reelMountSet(0, 0)) === '[]', 'no clips, nothing mounts');
  assert(JSON.stringify(reelMountSet(7, 3)) === '[2]', 'an index past the end clamps to the last reel');
  assert(JSON.stringify(reelMountSet(-2, 3)) === '[0,1]', 'a negative index clamps to the first');
  assert(stepReel(0, 1, 5) === 1 && stepReel(4, 1, 5) === 4, 'down stops at the last reel');
  assert(stepReel(0, -1, 5) === 0 && stepReel(3, -1, 5) === 2, 'up stops at the first reel');
  assert(stepReel(2, 1, 0) === 0, 'an empty feed stays at 0');
  const mid = sourceSpan(900, 960, 3600);
  assert(near(mid.left, 25) && near(mid.width, 100 / 60), 'a 60 s clip at 15:00 of 1 h sits at 25% and spans 60/3600');
  const tiny = sourceSpan(10, 10.5, 14400);
  assert(tiny.width >= 0.6, 'a tiny clip stays visible on the source bar');
  const end = sourceSpan(14390, 14420, 14400);
  assert(end.left + end.width <= 100 + 1e-9 && end.left >= 0, 'a clip padded past the end stays on the bar');
  const none = sourceSpan(5, 20, 0);
  assert(none.left === 0 && none.width === 0, 'unknown duration → no span');
  assert(formatSourceTime(0) === '0:00' && formatSourceTime(65.4) === '1:05', 'm:ss');
  assert(formatSourceTime(3600 + 12 * 60 + 4) === '1:12:04', 'h:mm:ss for long videos');
  assert(formatSourceTime(-3) === '0:00' && formatSourceTime(Number.NaN) === '0:00', 'bad input reads as 0:00');
}

// ── New Clips cleans up only after a definite refusal (a timeout or 5xx may have queued the job) ──
{
  assert(refusedByServer({ response: { status: 403 } }), 'a 403 (plan limits) is a refusal');
  assert(refusedByServer({ response: { status: 409 } }) && refusedByServer({ response: { status: 422 } }), '409 / 422 are refusals');
  assert(!refusedByServer({ response: { status: 500 } }) && !refusedByServer({ response: { status: 503 } }), 'a 5xx may have started the job');
  assert(!refusedByServer({ code: 'ECONNABORTED' }), 'a timeout (no response) may have started the job');
  assert(!refusedByServer({ message: 'Network Error' }), 'a dropped connection may have started the job');
  assert(!refusedByServer(undefined) && !refusedByServer(null) && !refusedByServer('x'), 'non-errors are not refusals');
}

// ── reels feed height: the screen under the header; a phone (either way up) gets a full screen under its app bar ──
{
  assert(feedHeightFor({ viewportW: 1440, viewportH: 900, top: 320, barH: 72 }) === 564, 'desktop: what is left under the page header');
  assert(feedHeightFor({ viewportW: 2560, viewportH: 1600, top: 320, barH: 72 }) === 980, 'a big screen is capped');
  assert(feedHeightFor({ viewportW: 1024, viewportH: 700, top: 370, barH: 72 }) === 480, 'a short desktop keeps a usable minimum (you scroll to it)');
  assert(feedHeightFor({ viewportW: 390, viewportH: 844, top: 600, barH: 64 }) === 772, 'phone upright: a full screen under the app bar');
  const sideways = feedHeightFor({ viewportW: 844, viewportH: 390, top: 300, barH: 64 });
  assert(sideways === 318, `phone sideways fits under its app bar (got ${sideways})`);
  assert(sideways <= 390 - 64, 'never taller than the screen under the app bar');
  assert(feedHeightFor({ viewportW: 700, viewportH: 200, top: 0, barH: 64 }) >= 240, 'a tiny window still gets something');
}

// ── playback the browser refuses (iPhone: sound needs a tap on that very video) ──
{
  assert(playFallback('NotAllowedError', false) === 'retry-muted', 'sound refused → play muted (the mute button shows it)');
  assert(playFallback('NotAllowedError', true) === 'paused', 'even muted refused (low power mode) → show it paused, a tap plays');
  assert(playFallback('AbortError', false) === 'ignore', 'a pause/seek interrupting play() is not a failure');
  assert(playFallback(undefined, true) === 'ignore', 'unknown → leave it');
}

// ── framing layouts (clips/framing.ts + clips/layout.ts): one geometry for preview, posters and export ──
{
  type R = { x: number; y: number; w: number; h: number };
  const inside = (r: R) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9;
  const SOURCES: Array<[number, number]> = [[1920, 1080], [1280, 720], [1440, 1080], [1080, 1920], [1918, 1078], [3840, 2160]];
  const OUTS: Array<[number, number]> = [[1080, 1920], [720, 1280], [2160, 3840], [271, 481]];
  const LAYOUTS = ['single', 'dual', 'full', 'stacked', 'pip', 'gameplay'] as const;

  for (const [sw, sh] of SOURCES) {
    for (const layout of LAYOUTS) {
      const f = defaultFraming(layout, sw, sh);
      assert(readFraming(f) !== null, `${layout} default is a drawable framing (${sw}x${sh})`);
      for (const key of layoutRegions(layout)) {
        const r = f[key]!;
        assert(inside(r) && r.w >= MIN_REGION - 1e-9 && r.h >= MIN_REGION - 1e-9, `${layout}.${key} inside the frame (${sw}x${sh})`);
        if (regionFit(f, key) === 'cover') {
          // A Fill box has exactly its panel's shape: what the box shows is what the panel shows.
          const want = coverRatio(panelAspect(f, key), sw, sh);
          assert(near(r.w / r.h, want, 1e-6) || r.w >= 1 - 1e-9 || r.h >= 1 - 1e-9, `${layout}.${key} is locked to its panel shape (${sw}x${sh})`);
        }
      }
      for (const [W, H] of OUTS) {
        const panels = panelsFor(f, W, H);
        assert(panels.length >= 1, `${layout} draws something`);
        for (const p of panels) {
          const d = panelDraw(p, sw, sh);
          for (const n of [d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh]) assert(Number.isInteger(n), `${layout}: whole pixels (${n})`);
          assert(d.sx >= 0 && d.sy >= 0 && d.sx + d.sw <= sw && d.sy + d.sh <= sh, `${layout}: source rect inside ${sw}x${sh}`);
          assert(d.dx >= p.dst.x && d.dy >= p.dst.y && d.dx + d.dw <= p.dst.x + p.dst.w && d.dy + d.dh <= p.dst.y + p.dst.h, `${layout}: drawn inside its panel`);
          assert(d.dw >= 1 && d.dh >= 1 && d.sw >= 1 && d.sh >= 1, `${layout}: nothing empty`);
          if (p.fit === 'cover') assert(d.dw === p.dst.w && d.dh === p.dst.h, `${layout}: Fill covers the panel`);
        }
        if (layout === 'dual' || layout === 'stacked') {
          const [top, bottom] = panels.map((p) => p.dst);
          assert(top.y === 0 && top.h + bottom.h === H && bottom.y === top.h, `${layout}: panels meet with no gap or overlap at ${W}x${H}`);
          assert(top.w === W && bottom.w === W, `${layout}: panels are full width`);
        }
      }
    }
  }

  // Split, swap and PiP boxes.
  {
    const f = { ...defaultFraming('stacked', 1920, 1080), split: 0.7 };
    const [top] = panelsFor(f, 1080, 1920);
    assert(top.dst.h === 1344 && top.region === f.a, 'stacked: Gameplay on top at 70%');
    const swapped = panelsFor({ ...f, swap: true }, 1080, 1920);
    assert(swapped[0].region === f.b && swapped[0].dst.h === 1344, 'swap puts the Facecam on top, same split');
    assert(splitOf({ v: 1, layout: 'dual', split: 0.95 }) === 0.8 && splitOf({ v: 1, layout: 'dual', split: 0.05 }) === 0.2, 'split is clamped');
    const pip = defaultFraming('pip', 1920, 1080);
    const box = panelsFor({ ...pip, pip: { x: 0.5, y: 0.6, w: 0.4, h: 0.25 } }, 1080, 1920)[1].dst;
    assert(box.x === 540 && box.y === 1152 && box.w === 432 && box.h === 480, `PiP box in output pixels (got ${JSON.stringify(box)})`);
    assert(panelsFor(pip, 1080, 1920)[0].dst.w === 1080, 'PiP: gameplay is the full frame behind the box');
  }

  // Fit (contain) letterboxes a 16:9 picture inside a 9:16 frame; a Fill crop never letterboxes.
  {
    const g = defaultFraming('gameplay', 1920, 1080);
    const d = panelDraw(panelsFor(g, 1080, 1920)[0], 1920, 1080);
    assert(d.dw === 1080 && d.dh === 608 && d.dy === 656 && d.sw === 1920 && d.sh === 1080, `gameplay fit keeps the whole frame (got ${JSON.stringify(d)})`);
    assert(hasBars(g, 1080, 1920, 1920, 1080), 'gameplay fit has bars (the background shows)');
    assert(!hasBars(defaultFraming('single', 1920, 1080), 1080, 1920, 1920, 1080), 'single fill has no bars');
    const s = panelDraw(panelsFor(defaultFraming('single', 1920, 1080), 1080, 1920)[0], 1920, 1080);
    assert(s.sw === 608 && s.sh === 1080 && s.sx === 656, `single default = centred 9:16 window of the full height (got ${JSON.stringify(s)})`);
  }

  // drawLayout draws black first, then each panel through drawRegion — the same calls preview and export make.
  {
    const calls: number[][] = [];
    const ctx = { fillStyle: '' as unknown, globalAlpha: 1, imageSmoothingEnabled: false, fillRect: () => calls.push([-1]), drawImage: () => undefined };
    const f = defaultFraming('dual', 1920, 1080);
    drawLayout(ctx, 1080, 1920, { ...f, bg: 'black' }, 1920, 1080, (_c, ...r) => calls.push(r));
    assert(calls[0][0] === -1 && calls.length === 3, 'black fill + two panels');
    assert(calls[1][4] === 0 && calls[1][5] === 0 && calls[2][5] === 960, 'Speaker A on top, Speaker B from the middle down');
    // Blurred backdrop: tiny cover draw, then the frame (stub canvas — Node has no OffscreenCanvas).
    const g = globalThis as unknown as { OffscreenCanvas?: unknown };
    const had = g.OffscreenCanvas;
    g.OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return ctx;
      }
    };
    calls.length = 0;
    drawLayout(ctx, 1080, 1920, defaultFraming('full', 1920, 1080), 1920, 1080, (_c, ...r) => calls.push(r));
    const draws = calls.filter((c) => c.length > 1);
    assert(draws.length === 2 && draws[0][6] < 60, 'blur: a tiny backdrop draw, then the fitted frame');
    g.OffscreenCanvas = had;
  }

  // Helpers: aspect lock, clamping, keys, reading stored values, layout carry-over.
  {
    const r = withRatio({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 }, 2);
    assert(inside(r) && near(r.w / r.h, 2, 1e-9), 'withRatio keeps the shape and stays inside');
    assert(near(clampRect({ x: -1, y: 2, w: 0.01, h: 3 }).w, MIN_REGION) && clampRect({ x: -1, y: 2, w: 0.01, h: 3 }).y === 0, 'clampRect');
    const a = defaultFraming('dual', 1920, 1080);
    const moved = { ...a, a: { ...a.a!, x: a.a!.x + 0.01 } };
    assert(framingKey(a) !== framingKey(moved) && framingKey(a) === framingKey({ ...a }), 'framingKey follows the boxes');
    assert(framingKey(null) === '', 'no framing → empty key');
    assert(readFraming({ v: 2, layout: 'dual' }) === null && readFraming({ v: 1, layout: 'zoom' }) === null, 'unknown version / layout → original crop');
    assert(readFraming({ v: 1, layout: 'dual', a: a.a }) === null, 'a dual without Speaker B is not drawable');
    const kept = defaultFraming('stacked', 1920, 1080, { ...defaultFraming('pip', 1920, 1080), b: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    assert(near(kept.b!.x + kept.b!.w / 2, 0.2, 1e-6), 'switching gaming layouts keeps the Facecam box where the user put it');
    const fresh = defaultFraming('stacked', 1920, 1080, defaultFraming('dual', 1920, 1080));
    assert(near(fresh.a!.h, 1), 'a podcast box is not reused as gameplay');
    assert(layoutVideoType('pip') === 'gaming' && layoutVideoType('full') === 'podcast', 'layout → video type');
  }

  // A clip's layout drives export, face tracking, caption size, posters and the editor copy.
  {
    const base = { _id: 'c1', start: 10, end: 40, crop: { mode: 'auto' as const, x: 0.5, track: [] as Array<[number, number]> } };
    const dual = defaultFraming('dual', 1920, 1080);
    assert(clipLayout({ ...base, framing: dual }) !== null && clipLayout({ ...base, aspect: '16:9', framing: dual }) === null, 'layouts are vertical only');
    assert(exportFramingFor({ ...base, framing: dual }).mode === 'layout', 'a layout exports as a layout');
    assert(exportFramingFor({ ...base, framing: null }).mode === 'cover', 'no layout → the crop, as before');
    assert(exportFramingFor({ ...base, crop: { mode: 'none' as const, x: 0.5 } }).mode === 'contain', 'Fit, as before');
    assert(!needsFaceTrack({ ...base, framing: dual }) && needsFaceTrack({ ...base, framing: null }), 'a hand-placed layout never waits for a face track');
    const k1 = thumbKey({ ...base, framing: dual });
    assert(k1 !== thumbKey({ ...base }) && k1 !== thumbKey({ ...base, framing: { ...dual, split: 0.6 } }), 'a new layout makes a new poster');
    assert(clipEditBasis({ ...base, framing: dual }) !== clipEditBasis({ ...base }), 'a layout change refreshes the editor copy');
    assert(clipChanges(clipEditBasis({ ...base }), clipEditBasis({ ...base, framing: dual })).frame, '… as a framing change');
    const st = (look: Record<string, unknown>) => clipStyle({ fontSize: 80 }, { aspect: '9:16', crop: { mode: 'none' }, ...look }).fontSize;
    assert(st({ framing: dual }) < st({}), 'captions are sized for a filled frame under a layout');
  }
}

console.log(`All clips client checks passed (${passed} assertions)`);
