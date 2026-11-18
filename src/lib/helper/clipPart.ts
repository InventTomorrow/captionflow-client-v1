/**
 * helper/clipPart.ts — one clip's part of a YouTube video, made on this
 * device from only the bytes it needs. YouTube's streams are fragmented MP4
 * with an index (sidx) of fragments a few seconds long, each starting on a
 * keyframe. The part is each stream's header plus the fragments covering the
 * clip, for the video and the audio stream, joined into one MP4. Packets are
 * copied; nothing is re-encoded.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { TimeRange } from '../clips/clipMath';
import { HelperError, helperFetch, helperRange, helperVideoInfo, type HelperStream } from './helper';

/** One indexed fragment: source seconds and its bytes in the stream. */
interface Fragment {
  start: number;
  end: number;
  offset: number;
  size: number;
}

interface StreamIndex {
  /** End of the header (ftyp + moov): bytes [0, initEnd) */
  initEnd: number;
  fragments: Fragment[];
}

export interface HelperPart {
  blob: Blob;
  /** Source seconds at the part's 0:00, and where it ends. */
  start: number;
  end: number;
}

/** The header and index sit at the very start of the stream; this much almost always holds both. */
const HEAD_BYTES = 256 * 1024;

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

const noIndex = () => new HelperError('This video can’t be fetched in parts. Try another video.', 'no_index');

/** The fragments listed by a sidx box at `at` (ISO 14496-12 §8.16.3). */
function parseSidx(b: Uint8Array, at: number, header: number, size: number): Fragment[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = at + header;
  const version = v.getUint8(p);
  p += 8; // version + flags, reference_ID
  const timescale = v.getUint32(p);
  p += 4;
  let time: number;
  let first: number;
  if (version === 0) {
    time = v.getUint32(p);
    first = v.getUint32(p + 4);
    p += 8;
  } else {
    time = Number(v.getBigUint64(p));
    first = Number(v.getBigUint64(p + 8));
    p += 16;
  }
  const count = v.getUint16(p + 2);
  p += 4;
  if (!timescale || !count || p + count * 12 > at + size) throw noIndex();
  const fragments: Fragment[] = [];
  let offset = at + size + first;
  for (let i = 0; i < count; i++, p += 12) {
    const ref = v.getUint32(p);
    const duration = v.getUint32(p + 4);
    if (ref >>> 31) throw noIndex(); // An index of indexes: YouTube doesn't use these.
    const bytes = ref & 0x7fffffff;
    fragments.push({ start: time / timescale, end: (time + duration) / timescale, offset, size: bytes });
    offset += bytes;
    time += duration;
  }
  return fragments;
}

async function streamIndex(videoId: string, stream: HelperStream, signal?: AbortSignal): Promise<StreamIndex> {
  let head = await helperRange(videoId, stream, 0, Math.min(stream.size, HEAD_BYTES) - 1, signal);
  let initEnd = 0;
  for (let at = 0; at + 8 <= head.byteLength; ) {
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = v.getUint32(at);
    let header = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(at + 8));
      header = 16;
    }
    const type = ascii(head, at + 4);
    if (size < header || type === 'moof' || type === 'mdat') break;
    if (type === 'moov') initEnd = at + size;
    if (type === 'sidx') {
      if (!initEnd) break;
      if (at + size > head.byteLength) head = concat(head, await helperRange(videoId, stream, head.byteLength, at + size - 1, signal));
      return { initEnd, fragments: parseSidx(head, at, header, size) };
    }
    at += size;
  }
  throw noIndex();
}

/** The fragments that together cover [start, end]. */
function covering(fragments: Fragment[], range: TimeRange): Fragment[] {
  let i = fragments.findIndex((f) => f.end > range.start);
  if (i < 0) i = fragments.length - 1;
  let j = i;
  while (j + 1 < fragments.length && fragments[j].end < range.end) j++;
  return fragments.slice(i, j + 1);
}

/** Join the video and audio pieces into one MP4 whose 0:00 is the video's first frame (audio cut to the video's `length`). */
async function join(video: Blob, audio: Blob, audioLead: number, length: number): Promise<Blob> {
  const vIn = new Input({ formats: ALL_FORMATS, source: new BlobSource(video) });
  const aIn = new Input({ formats: ALL_FORMATS, source: new BlobSource(audio) });
  try {
    const vTrack = await vIn.getPrimaryVideoTrack();
    const aTrack = await aIn.getPrimaryAudioTrack();
    if (!vTrack?.codec || !aTrack?.codec) throw new HelperError('This clip’s part couldn’t be read. Try again.', 'bad_part');
    const [vConfig, aConfig, vFirst, aFirst] = await Promise.all([
      vTrack.getDecoderConfig(),
      aTrack.getDecoderConfig(),
      vTrack.getFirstTimestamp(),
      aTrack.getFirstTimestamp(),
    ]);
    if (!vConfig || !aConfig) throw new HelperError('This clip’s part couldn’t be read. Try again.', 'bad_part');

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const vSource = new EncodedVideoPacketSource(vTrack.codec);
    const aSource = new EncodedAudioPacketSource(aTrack.codec);
    output.addVideoTrack(vSource);
    output.addAudioTrack(aSource);
    await output.start();
    // The audio piece starts `audioLead` seconds before the video piece (its fragments don't line up with the video's).
    const copyVideo = async () => {
      let first = true;
      for await (const packet of new EncodedPacketSink(vTrack).packets()) {
        await vSource.add(packet.clone({ timestamp: packet.timestamp - vFirst }), first ? { decoderConfig: vConfig } : undefined);
        first = false;
      }
    };
    const copyAudio = async () => {
      let first = true;
      for await (const packet of new EncodedPacketSink(aTrack).packets()) {
        const timestamp = packet.timestamp - aFirst - audioLead;
        if (timestamp < 0) continue;
        if (timestamp >= length) break;
        await aSource.add(packet.clone({ timestamp }), first ? { decoderConfig: aConfig } : undefined);
        first = false;
      }
    };
    await Promise.all([copyVideo(), copyAudio()]);
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new HelperError('This clip’s part couldn’t be made. Try again.', 'bad_part');
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    vIn.dispose();
    aIn.dispose();
  }
}

/**
 * The part of a YouTube video covering `range`, through Asaan Caption Helper.
 * `onProgress` gets 0..1 as the bytes arrive.
 */
export async function fetchHelperPart(
  sourceUrl: string,
  range: TimeRange,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<HelperPart> {
  const info = await helperVideoInfo(sourceUrl, signal);
  const [vIndex, aIndex] = await Promise.all([
    streamIndex(info.id, info.video, signal),
    streamIndex(info.id, info.audio, signal),
  ]);
  const vFrags = covering(vIndex.fragments, range);
  const aFrags = covering(aIndex.fragments, { start: vFrags[0].start, end: range.end });

  const pieces = [
    { stream: info.video, index: vIndex, frags: vFrags },
    { stream: info.audio, index: aIndex, frags: aFrags },
  ];
  const total = pieces.reduce((n, p) => n + p.index.initEnd + p.frags.reduce((s, f) => s + f.size, 0), 0);
  const got = [0, 0];
  const report = () => onProgress?.(Math.min(1, (got[0] + got[1]) / total));
  const [videoBlob, audioBlob] = await Promise.all(
    pieces.map(async ({ stream, index, frags }, k) => {
      const init = await helperRange(info.id, stream, 0, index.initEnd - 1, signal);
      got[k] = init.byteLength;
      report();
      const first = frags[0].offset;
      const last = frags[frags.length - 1];
      const body = await helperFetch(info.id, stream, first, last.offset + last.size - 1, {
        signal,
        onBytes: (n) => {
          got[k] = init.byteLength + n;
          report();
        },
      });
      return new Blob([init, ...body] as BlobPart[], { type: stream.mime });
    }),
  );

  const start = vFrags[0].start;
  const end = Math.min(vFrags[vFrags.length - 1].end, aFrags[aFrags.length - 1].end);
  const blob = await join(videoBlob, audioBlob, start - aFrags[0].start, end - start);
  return { blob, start, end };
}
