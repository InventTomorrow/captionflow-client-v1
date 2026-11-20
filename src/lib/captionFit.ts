/**
 * lib/captionFit.ts — keep a caption inside the frame's safe area.
 *
 * A caption normally fits: `.caption-overlay` is max-width 90 % and wraps.
 * It can still spill past the frame when a single word is wider than that
 * (Swiss / Hero Punch giant uppercase words on a narrow 9:16 frame), when a
 * stacked template grows taller than the frame, or after the user scales a
 * chunk up. Then the whole design is shrunk — its `.cap-block` gets a font-size
 * below 1em, so text, boxes, marks and em-based strokes all scale together —
 * just enough to fit, never enlarged.
 *
 * Called by the editor preview (CaptionOverlay, after every layout) AND by the
 * export's layout measuring (export/layout/compile.tsx, after fonts load), so
 * the preview and the burned-in video shrink identically.
 */

/** Gap kept from each frame edge, as a fraction of the frame. */
const SAFE_X = 0.03;
const SAFE_Y = 0.04;

export function fitCaptionToFrame(overlay: HTMLElement | null): number {
  const block = overlay?.querySelector<HTMLElement>('.cap-block');
  const frame = overlay?.parentElement;
  if (!overlay || !block || !frame) return 1;
  block.style.fontSize = '';
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;
  if (!fw || !fh) return 1;
  // The caption is centred on its anchor (left/top %), so the room it has is
  // twice the distance to the nearer edge, minus the safe margin.
  const cx = ((parseFloat(overlay.style.left) || 50) / 100) * fw;
  const cy = ((parseFloat(overlay.style.top) || 50) / 100) * fh;
  const availW = Math.max(fw * 0.3, 2 * Math.min(cx, fw - cx) - 2 * SAFE_X * fw);
  const availH = Math.max(fh * 0.2, 2 * Math.min(cy, fh - cy) - 2 * SAFE_Y * fh);
  let k = 1;
  // Shrinking can re-wrap lines, so settle in a few passes (layout sizes only — transforms ignored).
  for (let pass = 0; pass < 3; pass++) {
    const w = Math.max(overlay.scrollWidth, block.scrollWidth, overlay.offsetWidth);
    const h = Math.max(overlay.scrollHeight, overlay.offsetHeight);
    const need = Math.min(availW / Math.max(1, w), availH / Math.max(1, h));
    if (need >= 0.995) break;
    k = Math.max(0.3, k * need);
    block.style.fontSize = `${k.toFixed(4)}em`;
  }
  return k;
}
