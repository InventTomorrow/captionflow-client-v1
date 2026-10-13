/**
 * clips/clipMath.ts — small pure rules the Clips pages, thumbnails and renders
 * share, so a card, its preview and its rendered MP4 always agree.
 */
import { buildExportStyle, type EditorStyle } from '../export/styleSnapshot';
import { templateByKey } from '../templateCatalog';
import type { Caption } from '../../stores/captionStore';
import { cropXAt, type CropTrack } from './cropTrack';
import { sliceCaptionsToRange } from './sliceCaptions';

export interface ClipTiming {
  _id: string;
  start: number;
  end: number;
}
export interface ClipFraming {
  crop: { mode: 'auto' | 'manual' | 'none'; x: number; track?: CropTrack };
  /** Output frame; absent on clips from before formats = vertical. */
  aspect?: ClipAspect;
}

/** A clip's output frame: vertical (cropped around the speaker) or the landscape original. */
export type ClipAspect = '9:16' | '16:9';

export function clipAspect(clip: { aspect?: ClipAspect | null }): ClipAspect {
  return clip.aspect === '16:9' ? '16:9' : '9:16';
}

/** [width, height] proportions of a format. */
export function aspectDims(aspect: ClipAspect): [number, number] {
  return aspect === '16:9' ? [16, 9] : [9, 16];
}

/** Auto framing of a vertical clip that has no face track yet (landscape keeps the whole frame). */
export function needsFaceTrack(clip: ClipFraming): boolean {
  return clipAspect(clip) === '9:16' && clip.crop.mode === 'auto' && !clip.crop.track?.length;
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
  if (clipAspect(clip) === '16:9' || clip.crop.mode === 'none') return null;
  if (clip.crop.mode === 'manual') return [[0, clip.crop.x]];
  return clip.crop.track?.length ? clip.crop.track : [[0, 0.5]];
}

/** Cache key of a clip's poster: changes whenever the in-point or the framing does. */
export function thumbKey(clip: ClipTiming & ClipFraming): string {
  const track = cropTrackFor(clip);
  const x = track ? cropXAt(track, clipFrameTime(clip) - clip.start).toFixed(3) : 'fit';
  return `${clip._id}:${clip.start.toFixed(2)}:${clipAspect(clip)}:${clip.crop.mode}:${x}`;
}

/** What a clip says about its captions' look (Clip.templateKey / Clip.style). */
export interface ClipLook {
  templateKey?: string | null;
  /** A look made for this clip in the captions editor — wins over the template. */
  style?: Partial<EditorStyle> | null;
  aspect?: ClipAspect | null;
}

/**
 * A clip's caption style: the project's look, switched to the clip's template
 * card, or to the look made for it in the captions editor. Always 9:16 and
 * never behind-person (the matte maps onto letterboxed frames only).
 */
export function clipStyle(projectStyle: Partial<EditorStyle>, look: ClipLook): EditorStyle {
  const card = !look.style && look.templateKey ? templateByKey(look.templateKey) : undefined;
  const merged: Partial<EditorStyle> = {
    ...projectStyle,
    ...(card ? { ...card.preset, templateKey: card.key } : {}),
    ...(look.style ?? {}),
    aspectRatio: clipAspect(look),
    behindPerson: false,
  };
  return buildExportStyle(merged, { defaultAspect: clipAspect(look) });
}

/**
 * What "Locate file" checks a picked file against: the size of the video the
 * user originally chose (not the audio that was uploaded) and every duration
 * the server knows — container and audio lengths can differ by a second.
 * Same rule as the editor's own Locate file.
 */
export function expectedSource(video: {
  size?: number;
  originalSize?: number;
  duration?: number;
  originalDuration?: number;
}): { size: number; durations: number[] } {
  return {
    size: Number(video.originalSize) || 0,
    durations: [video.originalDuration, video.duration].map(Number).filter((d) => d > 0),
  };
}

/** m:ss for a clip length in seconds. */
export function formatClipLength(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function scoreTone(score: number): 'high' | 'mid' | 'low' {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}

/** The words spoken in [start, end] (a sentence's text beside the trim buttons). */
export function textInRange(captions: Caption[], start: number, end: number): string {
  return sliceCaptionsToRange(captions, start, end)
    .map((c) => c.text)
    .join(' ');
}

/** A list cut into runs of at most `size` (bulk requests: the server takes ≤ 200 clips at a time). */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
