/**
 * Offline checks for the Clips client helpers (pure functions only).
 * Run: npx tsx scripts/checks/clips.check.ts
 */
import type { Caption } from '../../src/stores/captionStore';
import { sliceCaptionsToRange } from '../../src/lib/clips/sliceCaptions';
import { cropRect, cropXAt, integerCrop } from '../../src/lib/clips/cropTrack';

let passed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

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
      cap(1, [['a', 9, 9.5], ['b', 9.5, 10.2], ['c', 10.2, 11]], {
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

console.log(`All clips client checks passed (${passed} assertions)`);
