/** clips/clipOptions.ts — the clip length presets offered when finding clips. */
import type { ClipOptions } from './api';

export const LENGTH_PRESETS = [
  { id: 'short', label: 'Short', hint: '15–30 s', minSec: 15, maxSec: 30 },
  { id: 'standard', label: 'Standard', hint: '20–60 s', minSec: 20, maxSec: 60 },
  { id: 'long', label: 'Long', hint: '45–90 s', minSec: 45, maxSec: 90 },
] as const;

export type LengthPresetId = (typeof LENGTH_PRESETS)[number]['id'];

/** Longest "What kind of clips do you want?" text (the server enforces the same cap). */
export const CLIP_INSTRUCTIONS_MAX = 1000;

/** `instructions` is sent only when it has text, so a blank field finds clips exactly as before. */
export function clipOptionsFrom(preset: LengthPresetId, maxClips: number, instructions?: string): ClipOptions {
  const p = LENGTH_PRESETS.find((x) => x.id === preset) ?? LENGTH_PRESETS[1];
  const text = instructions?.trim().slice(0, CLIP_INSTRUCTIONS_MAX);
  return { minSec: p.minSec, maxSec: p.maxSec, maxClips, ...(text ? { instructions: text } : {}) };
}
