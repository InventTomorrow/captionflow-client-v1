/**
 * clips/clipMath.ts — small pure rules the Clips pages, thumbnails and renders
 * share, so a card, its preview and its rendered MP4 always agree.
 */
import { buildExportStyle, type EditorStyle } from '../export/styleSnapshot';
import { templateByKey } from '../templateCatalog';
import { cropXAt, type CropTrack } from './cropTrack';

export interface ClipTiming {
  _id: string;
  start: number;
  end: number;
}
export interface ClipFraming {
  crop: { mode: 'auto' | 'manual' | 'none'; x: number; track?: CropTrack };
}

/** The poster frame: 1.5 s in (past the cut), or a third of the way through a very short clip. */
export function clipFrameTime(clip: Pick<ClipTiming, 'start' | 'end'>): number {
  return clip.start + Math.min(1.5, Math.max(0, clip.end - clip.start) / 3);
}

/**
 * How a clip fills the 9:16 frame: a crop track to follow ('auto' = the saved
 * face track, centred until one exists; 'manual' = the user's fixed centre),
 * or null for 'none' = letterbox the whole frame.
 */
export function cropTrackFor(clip: ClipFraming): CropTrack | null {
  if (clip.crop.mode === 'none') return null;
  if (clip.crop.mode === 'manual') return [[0, clip.crop.x]];
  return clip.crop.track?.length ? clip.crop.track : [[0, 0.5]];
}

/** Cache key of a clip's poster: changes whenever the in-point or the framing does. */
export function thumbKey(clip: ClipTiming & ClipFraming): string {
  const track = cropTrackFor(clip);
  const x = track ? cropXAt(track, clipFrameTime(clip) - clip.start).toFixed(3) : 'fit';
  return `${clip._id}:${clip.start.toFixed(2)}:${clip.crop.mode}:${x}`;
}

/**
 * A clip's caption style: the project's look, switched to the clip's own
 * template card when it has one, always 9:16 and never behind-person (the
 * matte maps onto letterboxed frames only).
 */
export function clipStyle(projectStyle: Partial<EditorStyle>, templateKey: string | null | undefined): EditorStyle {
  const card = templateKey ? templateByKey(templateKey) : undefined;
  const merged: Partial<EditorStyle> = {
    ...projectStyle,
    ...(card ? { ...card.preset, templateKey: card.key } : {}),
    aspectRatio: '9:16',
    behindPerson: false,
  };
  return buildExportStyle(merged, { defaultAspect: '9:16' });
}
