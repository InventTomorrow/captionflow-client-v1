/**
 * audio.worker.ts — the audio-only upload's extraction step (see extractAudio.ts).
 *
 * One request per worker: { type: 'start', file } → progress messages → one
 * 'done' (result, or null + reason) or 'error'. The main thread terminates the
 * worker afterwards, so nothing here needs tearing down between jobs.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type ConversionAudioOptions,
  type InputAudioTrack,
  type OutputFormat,
} from 'mediabunny';
import type { AudioWorkerIn, AudioWorkerOut, ExtractedAudio } from './extractAudio';

type Outcome = { result: ExtractedAudio | null; reason?: string };

function post(msg: AudioWorkerOut) {
  self.postMessage(msg);
}

interface Container {
  make: () => OutputFormat;
  ext: string;
  mime: string;
}

// fastStart 'in-memory' puts the index first; the whole output is in memory anyway (BufferTarget).
const M4A: Container = { make: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), ext: '.m4a', mime: 'audio/mp4' };
const WEBM: Container = { make: () => new WebMOutputFormat(), ext: '.webm', mime: 'audio/webm' };
const OGG: Container = { make: () => new OggOutputFormat(), ext: '.ogg', mime: 'audio/ogg' };
const MP3: Container = { make: () => new Mp3OutputFormat(), ext: '.mp3', mime: 'audio/mpeg' };
const FLAC: Container = { make: () => new FlacOutputFormat(), ext: '.flac', mime: 'audio/flac' };
const WAV: Container = { make: () => new WavOutputFormat(), ext: '.wav', mime: 'audio/wav' };

/** A WAV copy past this size is not worth uploading (or holding in memory) — transcode instead. */
const PCM_COPY_MAX_BYTES = 64 * 1024 * 1024;
/** Transcodes only feed speech recognition; the server resamples to 16 kHz mono anyway. */
const TRANSCODE_BITRATE = 96_000;

const PCM_BYTES: Partial<Record<AudioCodec, number>> = {
  'pcm-u8': 1, 'pcm-s8': 1, ulaw: 1, alaw: 1,
  'pcm-s16': 2, 'pcm-s16be': 2,
  'pcm-s24': 3, 'pcm-s24be': 3,
  'pcm-s32': 4, 'pcm-s32be': 4, 'pcm-f32': 4, 'pcm-f32be': 4,
  'pcm-f64': 8, 'pcm-f64be': 8,
};

/** Containers the codec can be COPIED into, best first. */
function copyTargets(codec: AudioCodec | null, audio: InputAudioTrack, durationSec: number): Container[] {
  switch (codec) {
    case 'aac':
      return [M4A];
    case 'opus':
    case 'vorbis':
      return [WEBM, OGG];
    case 'mp3':
      return [MP3];
    case 'flac':
      return [FLAC];
    default: {
      const bytes = codec ? PCM_BYTES[codec] : undefined;
      if (!bytes) return [];
      const size = durationSec * audio.sampleRate * audio.numberOfChannels * bytes;
      return size > 0 && size <= PCM_COPY_MAX_BYTES ? [WAV] : [];
    }
  }
}

function baseName(name: string) {
  return name.replace(/\.[^./\\]+$/, '') || 'audio';
}

/** The extracted file must reach (about) as far as the source's audio did. */
async function assertComplete(blob: Blob, expectedEnd: number) {
  if (!(expectedEnd > 0)) return;
  const check = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const end = await check.computeDuration();
    if (Math.abs(end - expectedEnd) > Math.max(1, expectedEnd * 0.02)) {
      throw new Error(`extracted audio ends at ${end.toFixed(2)} s, source audio at ${expectedEnd.toFixed(2)} s`);
    }
  } finally {
    check.dispose();
  }
}

/** One conversion attempt; null = this attempt can't produce a usable file. */
async function convert(
  file: File,
  container: Container,
  audioOptions: ConversionAudioOptions,
  mode: 'copy' | 'transcode',
  expectedEnd: number,
): Promise<Blob | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({ format: container.make(), target: new BufferTarget() });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { discard: true },
      audio: audioOptions,
      // 'forced': a copy attempt must never quietly turn into a transcode.
      copy: mode === 'copy' ? { mode: 'forced' } : {},
      // Keep the source's timeline — captions are timed against the video, and
      // by default the audio would be shifted so its first packet lands at 0.
      trim: { start: 0 },
      // No title / cover art: only the audio matters, and nothing personal leaks.
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.utilizedTracks.length === 0) return null;
    conversion.onProgress = (p) => post({ type: 'progress', percent: Math.min(99, Math.round(p * 100)) });
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    const blob = new Blob([buffer], { type: container.mime });
    await assertComplete(blob, expectedEnd);
    return blob;
  } catch (err) {
    console.warn(`[audio.worker] ${mode} into ${container.ext} failed`, err);
    return null;
  } finally {
    input.dispose();
  }
}

async function extractFrom(file: File, input: Input): Promise<Outcome> {
  let audio: InputAudioTrack | null;
  let hasVideo: boolean;
  let audioEnd = 0;
  try {
    const [video, primaryAudio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    audio = primaryAudio;
    hasVideo = Boolean(video);
    if (audio) audioEnd = await audio.computeDuration().catch(() => 0);
  } catch (err) {
    return { result: null, reason: `could not read the file (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!hasVideo) return { result: null, reason: 'the file has no video track' };
  if (!audio) return { result: null, reason: 'the file has no audio track' };

  const codec = audio.codec;
  const name = baseName(file.name);

  for (const container of copyTargets(codec, audio, audioEnd)) {
    const blob = await convert(file, container, {}, 'copy', audioEnd);
    if (blob) {
      return {
        result: { blob, fileName: `${name}${container.ext}`, mimeType: container.mime, codec: codec ?? 'unknown', copied: true },
      };
    }
  }

  if (!(await audio.canDecode().catch(() => false))) {
    return { result: null, reason: `this browser can't decode ${codec ?? 'this'} audio` };
  }

  const quality = new Quality({ bitrate: TRANSCODE_BITRATE });
  const sampleRate = audio.sampleRate > 48_000 ? 48_000 : audio.sampleRate;
  const plans: Array<{ target: 'aac' | 'opus'; container: Container; wasm?: boolean }> = [];
  const nativeAac = await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate, quality }).catch(() => false);
  if (nativeAac) {
    plans.push({ target: 'aac', container: M4A });
  } else {
    // A native Opus encoder beats the WASM AAC one on speed; WASM AAC works everywhere.
    if (await canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: 48_000, quality }).catch(() => false)) {
      plans.push({ target: 'opus', container: WEBM });
    }
    plans.push({ target: 'aac', container: M4A, wasm: true });
  }

  for (const plan of plans) {
    if (plan.wasm) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }
    const blob = await convert(
      file,
      plan.container,
      {
        codec: plan.target,
        numberOfChannels: 1,
        sampleRate: plan.target === 'opus' ? 48_000 : sampleRate,
        quality,
        forceTranscode: true,
      },
      'transcode',
      audioEnd,
    );
    if (blob) {
      return {
        result: { blob, fileName: `${name}${plan.container.ext}`, mimeType: plan.container.mime, codec: plan.target, copied: false },
      };
    }
  }
  return { result: null, reason: `could not copy or transcode ${codec ?? 'this'} audio` };
}

async function extract(file: File): Promise<Outcome> {
  // Held open for the decisions in extractFrom; each conversion attempt opens its own.
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    return await extractFrom(file, input);
  } finally {
    input.dispose();
  }
}

self.onmessage = (e: MessageEvent<AudioWorkerIn>) => {
  if (e.data?.type !== 'start') return;
  extract(e.data.file).then(
    ({ result, reason }) => post({ type: 'done', result, reason }),
    (err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
