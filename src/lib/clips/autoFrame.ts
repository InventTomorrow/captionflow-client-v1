/**
 * clips/autoFrame.ts — make sure an 'auto'-framed clip has its face track,
 * once. Shared by the clip set page (tracks every clip in the background as
 * soon as they arrive, so posters and previews are framed on the speaker),
 * the clip editor and the render (never renders a centre crop by accident).
 * Concurrent callers for the same clip range share one computation, and
 * clips are tracked one at a time.
 */
import { getSourceFile, getSourceRecord } from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { patchClip, type Clip } from './api';
import type { CropTrack } from './cropTrack';
import { computeFaceTrack, needsReframe } from './reframe';

const inflight = new Map<string, Promise<Clip | null>>();
let chain: Promise<unknown> = Promise.resolve();

export function needsFaceTrack(clip: Pick<Clip, 'crop'>): boolean {
  return clip.crop.mode === 'auto' && !clip.crop.track?.length;
}

/**
 * The clip with a saved face track, or null when nothing was done (not auto,
 * already tracked, no local source, or a source that needs no reframing).
 */
export function ensureFaceTrack(projectId: string, clip: Clip, onProgress?: (done: number, total: number) => void): Promise<Clip | null> {
  if (!needsFaceTrack(clip)) return Promise.resolve(null);
  const key = `${clip._id}:${clip.start}:${clip.end}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = chain.then(async () => {
    const file = await getSourceFile(projectId);
    if (!file) return null;
    const probe = (await getSourceRecord(projectId))?.probe ?? (await probeMediaFile(file));
    const track: CropTrack =
      probe && !needsReframe(probe.width, probe.height)
        ? [[0, 0.5]]
        : await computeFaceTrack(file, clip.start, clip.end, undefined, onProgress);
    // Saved only if the clip is still Auto over this exact range — the user may
    // have switched to Manual/Fit or trimmed it while this one waited its turn.
    // Either way the reply is the clip as it really is now.
    return patchClip(clip._id, { crop: { track, trackFor: { start: clip.start, end: clip.end } } });
  });
  chain = run.catch(() => undefined);
  const p = run.finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
