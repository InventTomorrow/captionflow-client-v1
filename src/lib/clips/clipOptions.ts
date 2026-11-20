/** clips/clipOptions.ts — the clip length choices offered when finding clips. */
import type { ClipOptions } from './api';

export const LENGTH_PRESETS = [
  { id: 'short', label: 'Short', hint: '15–30 s', minSec: 15, maxSec: 30 },
  { id: 'standard', label: 'Standard', hint: '20–60 s', minSec: 20, maxSec: 60 },
  { id: 'long', label: 'Long', hint: '45–90 s', minSec: 45, maxSec: 90 },
] as const;

export type LengthPresetId = (typeof LENGTH_PRESETS)[number]['id'];
/** A preset, or the user's own minimum and maximum. */
export type LengthChoice = LengthPresetId | 'custom';

/** Custom bounds — the server accepts the same (clips.service CLIP_LENGTH_MIN_SEC / CLIP_LENGTH_MAX_SEC). */
export const CLIP_LENGTH_MIN_SEC = 5;
export const CLIP_LENGTH_MAX_SEC = 300;

export type LengthUnit = 's' | 'min';
/** The Custom fields as typed (strings, so a half-typed number is never rewritten under the cursor). */
export interface CustomLength {
  min: string;
  minUnit: LengthUnit;
  max: string;
  maxUnit: LengthUnit;
}
export const DEFAULT_CUSTOM_LENGTH: CustomLength = { min: '30', minUnit: 's', max: '120', maxUnit: 's' };

export interface LengthRange {
  minSec: number;
  maxSec: number;
}

/** "45 s", "2 min", "1 min 30 s". */
export function formatLength(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

function toSeconds(value: string, unit: LengthUnit): number {
  const v = value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(v) ? Math.round(v * (unit === 'min' ? 60 : 1)) : NaN;
}

/** The seconds a choice stands for, or why the Custom fields can't be used yet. */
export function lengthRange(choice: LengthChoice, custom: CustomLength): LengthRange | { error: string } {
  if (choice !== 'custom') {
    const p = LENGTH_PRESETS.find((x) => x.id === choice) ?? LENGTH_PRESETS[1];
    return { minSec: p.minSec, maxSec: p.maxSec };
  }
  const minSec = toSeconds(custom.min, custom.minUnit);
  const maxSec = toSeconds(custom.max, custom.maxUnit);
  if (Number.isNaN(minSec) || Number.isNaN(maxSec)) return { error: 'Enter a minimum and a maximum length.' };
  if (minSec <= 0) return { error: 'The minimum must be more than 0.' };
  if (minSec < CLIP_LENGTH_MIN_SEC) return { error: `Clips must be at least ${formatLength(CLIP_LENGTH_MIN_SEC)} long.` };
  if (maxSec > CLIP_LENGTH_MAX_SEC) return { error: `Clips can be at most ${formatLength(CLIP_LENGTH_MAX_SEC)} long.` };
  if (maxSec < minSec) return { error: 'The maximum must be at least the minimum.' };
  return { minSec, maxSec };
}

/** The choice that matches a stored run (a preset when it is one, else Custom with those values). */
export function lengthChoiceFor(minSec: number, maxSec: number): { choice: LengthChoice; custom?: CustomLength } {
  const p = LENGTH_PRESETS.find((x) => x.minSec === minSec && x.maxSec === maxSec);
  if (p) return { choice: p.id };
  const field = (sec: number): [string, LengthUnit] => (sec >= 60 && sec % 60 === 0 ? [String(sec / 60), 'min'] : [String(sec), 's']);
  const [min, minUnit] = field(minSec);
  const [max, maxUnit] = field(maxSec);
  return { choice: 'custom', custom: { min, minUnit, max, maxUnit } };
}

/** Longest "What kind of clips do you want?" text (the server enforces the same cap). */
export const CLIP_INSTRUCTIONS_MAX = 1000;

/** `instructions` is sent only when it has text, so a blank field finds clips exactly as before. */
export function clipOptionsFrom(range: LengthRange, maxClips: number, instructions?: string): ClipOptions {
  const text = instructions?.trim().slice(0, CLIP_INSTRUCTIONS_MAX);
  return { minSec: range.minSec, maxSec: range.maxSec, maxClips, ...(text ? { instructions: text } : {}) };
}
