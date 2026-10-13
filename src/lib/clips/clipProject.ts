/**
 * clips/clipProject.ts — "Open in editor" turns a clip into its own editor
 * project (kind 'clip'): its video cut on this device, its captions copied
 * and moved to start at 0:00, its look as the project style. Nothing is
 * transcribed or regenerated. These are the pure parts (see openInEditor.ts).
 */
import type { Caption } from '../../stores/captionStore';
import type { EditorStyle } from '../export/styleSnapshot';
import { clipAspect, type ClipAspect } from './clipMath';
import { sliceCaptionsToRange } from './sliceCaptions';
import type { CropTrack } from './cropTrack';

export interface ClipBasis {
  start: number;
  end: number;
  aspect?: ClipAspect | null;
  templateKey?: string | null;
  style?: Partial<EditorStyle> | Record<string, unknown> | null;
  crop: { mode: 'auto' | 'manual' | 'none'; x: number; track?: CropTrack };
}

/** Small stable string hash (djb2), base 36. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * What a clip's editor project is made from: its range, format, framing and
 * look. When the clip changes after it was opened in the editor, the key
 * differs and reopening asks whether to keep the edited copy or start over.
 */
export function clipEditBasis(clip: ClipBasis): string {
  const framing =
    clip.crop.mode === 'manual'
      ? `m${clip.crop.x.toFixed(3)}`
      : clip.crop.mode === 'none'
        ? 'fit'
        : `a${hash(JSON.stringify(clip.crop.track ?? []))}`;
  const look = clip.style ? `s${hash(JSON.stringify(clip.style))}` : `t${clip.templateKey ?? '-'}`;
  // '|' between parts: the format itself ('9:16') has a colon in it.
  return [clip.start.toFixed(2), clip.end.toFixed(2), clipAspect(clip), framing, look].join('|');
}

/**
 * The clip's captions for its own project: cut to the clip at word level,
 * moved to start at 0:00, with fresh ids (captions are stored by id, so a
 * copy must never reuse the source video's — editing it leaves them alone).
 */
export function clipProjectCaptions(
  captions: Caption[],
  clip: Pick<ClipBasis, 'start' | 'end'>,
  newId: () => string = () => crypto.randomUUID(),
): Caption[] {
  return sliceCaptionsToRange(captions, clip.start, clip.end).map((c, i) => ({
    ...c,
    _id: newId(),
    sequence: i + 1,
    behindPerson: false,
  }));
}

/**
 * What changed on a clip since its editor project was made (both are
 * clipEditBasis keys): range → new captions and a new cut; format or framing →
 * a new cut (captions kept); look → the new look. No old key → everything.
 */
export function clipChanges(was: string | null | undefined, now: string): { range: boolean; frame: boolean; look: boolean } {
  if (!was) return { range: true, frame: true, look: true };
  const [s0, e0, a0, f0, l0] = was.split('|');
  const [s1, e1, a1, f1, l1] = now.split('|');
  const range = s0 !== s1 || e0 !== e1;
  return { range, frame: range || a0 !== a1 || f0 !== f1, look: l0 !== l1 };
}
