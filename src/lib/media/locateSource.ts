/**
 * media/locateSource.ts — "Locate file": the user re-picks the original video
 * of an audio-only project on a device that has no copy. Accepted only if it
 * matches what was uploaded (size within 1%, duration within 0.5 s), then
 * kept in OPFS like the first upload's copy.
 */
import { formatBytes, formatSeconds } from '../export/clientExport';
import { storeSourceFile } from './localMedia';
import { probeMediaFile } from './probe';

export interface ExpectedSource {
  /** Original upload size in bytes (0 = unknown). */
  size: number;
  /** Known durations of the original, seconds (empty = unknown). */
  durations: number[];
}

export type LocateResult = { ok: true } | { ok: false; error: string };

export async function locateOriginal(projectId: string, expected: ExpectedSource, file: File): Promise<LocateResult> {
  const probe = await probeMediaFile(file);
  if (!probe?.hasVideo) return { ok: false, error: 'That file isn’t a video this browser can read.' };
  const sizeOk = !expected.size || Math.abs(file.size - expected.size) <= expected.size * 0.01;
  const durationOk =
    !expected.durations.length || expected.durations.some((d) => Math.abs(probe.duration - d) <= 0.5);
  if (!sizeOk || !durationOk) {
    const want = [
      expected.size ? formatBytes(expected.size) : '',
      expected.durations.length ? formatSeconds(expected.durations[0]) : '',
    ]
      .filter(Boolean)
      .join(', ');
    return { ok: false, error: `That doesn’t look like the original video${want ? ` (expected ${want})` : ''}.` };
  }
  await storeSourceFile(projectId, file, probe);
  return { ok: true };
}
