/**
 * probe.ts — read a media file's headers in the browser (Mediabunny, pure TS).
 *
 * Replaces the server-side ffprobe for everything the client needs to know
 * before touching the network: display size with rotation applied, duration,
 * frame rate, codecs, and whether THIS browser can decode the streams (the
 * export router sends undecodable sources — HEVC on Firefox, say — to the
 * server). Reads only the container index, so it costs milliseconds even on
 * a 1 GB file.
 */

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

export interface MediaProbe {
  /** Container as Mediabunny names it (e.g. "MP4", "QuickTime File Format", "WebM"). */
  container: string;
  mimeType: string;
  /** Seconds. */
  duration: number;
  /** Display size — rotation already applied, like the server's ffprobe path. */
  width: number;
  height: number;
  /** Stored (unrotated) frame size. */
  codedWidth: number;
  codedHeight: number;
  rotation: 0 | 90 | 180 | 270;
  /** Average frames per second, from packet statistics. */
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Mediabunny codec ids: 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1' | ... ; null = unknown. */
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number;
  audioChannels: number;
  /** Whether WebCodecs in this browser can decode each stream. */
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
}

/**
 * Returns null when the container is one Mediabunny does not read (AVI, FLV,
 * WMV) or the file is not media at all — callers treat that as "unknown" and
 * fall back to the server's ffprobe, never as an error.
 */
export async function probeMediaFile(blob: Blob): Promise<MediaProbe | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const format = await input.getFormat();
    const [video, audio, mimeType] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.getMimeType().catch(() => ''),
    ]);
    if (!video && !audio) return null;

    const duration = await input.computeDuration().catch(() => 0);

    let fps = 0;
    let canDecodeVideo = false;
    if (video) {
      // A few hundred packets is enough for a stable average and stays cheap.
      const [stats, decodable] = await Promise.all([
        video.computePacketStats(300).catch(() => null),
        video.canDecode().catch(() => false),
      ]);
      fps = stats?.averagePacketRate ?? 0;
      canDecodeVideo = decodable;
    }

    const canDecodeAudio = audio ? await audio.canDecode().catch(() => false) : false;

    return {
      container: format.name,
      mimeType,
      duration,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      codedWidth: video?.codedWidth ?? 0,
      codedHeight: video?.codedHeight ?? 0,
      rotation: (video?.rotation ?? 0) as MediaProbe['rotation'],
      fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 0,
      hasVideo: !!video,
      hasAudio: !!audio,
      videoCodec: video?.codec ?? null,
      audioCodec: audio?.codec ?? null,
      audioSampleRate: audio?.sampleRate ?? 0,
      audioChannels: audio?.numberOfChannels ?? 0,
      canDecodeVideo,
      canDecodeAudio,
    };
  } catch (err) {
    console.warn('[probe] could not read media headers', err);
    return null;
  } finally {
    input.dispose();
  }
}
