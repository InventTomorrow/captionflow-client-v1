/**
 * /dev/export — run an on-device export without an account or a server.
 *
 * Pick a video; the page writes sample captions across its length and renders
 * it through exactly the code the editor uses (buildDeviceExportJob +
 * startDeviceExport → export.worker.ts). Shows progress, timing, the result
 * file and its thumbnail. Dev builds only (App.tsx).
 *
 * Query: ?template=blockbuster&quality=720p&format=mp4&aspect=16:9
 * Automation: results on `window.__exportDev`, `document.title` becomes
 * `export-ready` / `export-error`; `window.__readOpfsBase64(path)` returns a
 * stored file's bytes so a test can inspect the rendered video.
 */

import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Caption } from '../stores/captionStore';
import { KINETIC_TEMPLATE_IDS, isKineticTemplate } from '../lib/kinetic/engine';
import { probeMediaFile } from '../lib/media/probe';
import { getExportFile } from '../lib/media/localMedia';
import {
  buildDeviceExportJob,
  deviceExportBlocker,
  describeDeviceProgress,
  formatBytes,
  formatSeconds,
  startDeviceExport,
  type DeviceExportHandle,
  type ExportStyle,
} from '../lib/export/clientExport';
import { exportFrameSize, type ExportFormat, type ExportQuality } from '../lib/render/frame';
import type { ExportResult } from '../lib/export/protocol';

/** Preview-layout templates (everything that isn't kinetic). */
const LAYOUT_TEMPLATES = ['classic', 'heroWord', 'hero', 'stack', 'bigpop', 'highlight', 'mixed', 'mixed2', 'editorMasala', 'aura', 'swiss', 'theBigRed', 'scribble', 'archives'];
const ALL_TEMPLATES: string[] = [...KINETIC_TEMPLATE_IDS, ...LAYOUT_TEMPLATES];

const SAMPLE_LINES = [
  'this is the next big thing',
  'nobody saw it coming',
  'run',
  'the truth is finally out there',
  'we are so back',
  'everything changes tonight',
];

declare global {
  interface Window {
    __exportDev?: {
      result?: Omit<ExportResult, 'thumbnail'> & { thumbnailBytes: number };
      error?: { code: string; message: string };
      captions: Caption[];
      overlayCaptions: unknown;
      style: ExportStyle;
      width: number;
      height: number;
      wallMs: number;
    };
    __readOpfsBase64?: (path: string) => Promise<string | null>;
  }
}

window.__readOpfsBase64 = async (path: string) => {
  const file = await getExportFile(path);
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
};

/** Captions every ~2 s with evenly spread word timings. */
function sampleCaptions(duration: number): Caption[] {
  const out: Caption[] = [];
  const span = 2;
  for (let i = 0, t = 0.2; t + 0.6 < duration; i++, t += span) {
    const text = SAMPLE_LINES[i % SAMPLE_LINES.length];
    const words = text.split(/\s+/);
    const end = Math.min(duration - 0.05, t + span - 0.2);
    const step = (end - t) / words.length;
    out.push({
      _id: `dev-${i}`,
      sequence: i + 1,
      start: Number(t.toFixed(3)),
      end: Number(end.toFixed(3)),
      text,
      words: words.map((word, w) => ({
        word,
        start: Number((t + w * step).toFixed(3)),
        end: Number((t + (w + 1) * step).toFixed(3)),
      })),
    });
  }
  return out;
}

export function ExportDevPage() {
  const [params] = useSearchParams();
  const initialTemplate = params.get('template');
  const [template, setTemplate] = useState<string>(
    initialTemplate && ALL_TEMPLATES.includes(initialTemplate) ? initialTemplate : 'blockbuster',
  );
  const [quality, setQuality] = useState<ExportQuality>((params.get('quality') as ExportQuality) || '720p');
  const [format, setFormat] = useState<ExportFormat>((params.get('format') as ExportFormat) || 'mp4');
  const [aspect, setAspect] = useState(params.get('aspect') || '16:9');
  const [status, setStatus] = useState('idle');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const handleRef = useRef<DeviceExportHandle | null>(null);
  const blocker = deviceExportBlocker();

  async function run(file: File) {
    document.title = 'export-running';
    setResultUrl(null);
    setThumbUrl(null);
    setSummary('');
    const probe = await probeMediaFile(file);
    if (!probe) {
      setStatus('error: not a readable video');
      document.title = 'export-error';
      return;
    }
    const captions = sampleCaptions(probe.duration);
    const kinetic = isKineticTemplate(template);
    const style: ExportStyle = {
      template,
      color: '#FFFFFF',
      highlightColor: kinetic ? '#FF1F1F' : '#FFC43D',
      fontSize: kinetic ? 64 : 48,
      displayWords: kinetic ? 6 : 5,
      aspectRatio: aspect,
      behindPerson: params.get('behind') === '1',
      fontFamily: params.get('font') ?? 'Montserrat',
      fontWeight: 700,
      backgroundColor: 'rgba(0,0,0,0)',
      activeFill: 'transparent',
      textTransform: 'none',
      position: 'center',
      offsetX: 50,
      offsetY: 70,
      animation: params.get('anim') ?? 'pop',
      displayMode: (params.get('mode') as ExportStyle['displayMode']) ?? (template === 'heroWord' ? 'paintOn' : 'phrase'),
    };
    const { width, height } = exportFrameSize(quality, aspect, probe.width, probe.height);
    const job = await buildDeviceExportJob({
      exportId: `dev-${Date.now().toString(36)}`,
      source: file,
      width,
      height,
      durationSec: probe.duration,
      format,
      style,
      captions,
      frameRate: params.get('fps') === 'original' ? 'original' : 'fast',
    });
    job.tuning = {
      hardwareAcceleration: (params.get('hw') as NonNullable<typeof job.tuning>['hardwareAcceleration']) ?? undefined,
      noOverlay: params.get('noOverlay') === '1',
      noEncode: params.get('noEncode') === '1',
      frameRate: Number(params.get('fps')) || undefined,
      quantizer: params.get('qp') ? Number(params.get('qp')) : undefined,
    };
    const started = performance.now();
    const handle = startDeviceExport(job, (p) => setStatus(describeDeviceProgress(p, started)));
    handleRef.current = handle;
    const base = {
      captions,
      overlayCaptions: job.overlay.kind === 'kinetic' ? job.overlay.captions : job.overlay.track.captions.length,
      style,
      width,
      height,
    };
    try {
      const result = await handle.promise;
      const wallMs = Math.round(performance.now() - started);
      const { thumbnail, ...rest } = result;
      window.__exportDev = { ...base, wallMs, result: { ...rest, thumbnailBytes: thumbnail?.size ?? 0 } };
      const out = await getExportFile(result.outputPath);
      if (out) setResultUrl(URL.createObjectURL(out));
      if (thumbnail) setThumbUrl(URL.createObjectURL(thumbnail));
      const fps = result.frames / (result.renderMs / 1000);
      setSummary(
        `${width}×${height} · ${result.frames} frames in ${formatSeconds(result.renderMs / 1000)} ` +
          `(${fps.toFixed(0)} fps, ${(probe.duration / (result.renderMs / 1000)).toFixed(2)}× realtime) · ` +
          `${formatBytes(result.sizeBytes)} · audio ${result.audio}${result.audioCodec ? ` (${result.audioCodec})` : ''}` +
          (result.fingerprintMismatch.length ? ` · FONT MISMATCH ${result.fingerprintMismatch.join(', ')}` : ''),
      );
      setStatus('done');
      document.title = 'export-ready';
    } catch (err) {
      const e = err as { code?: string; message?: string };
      window.__exportDev = {
        ...base,
        wallMs: Math.round(performance.now() - started),
        error: { code: e.code ?? 'FAILED', message: e.message ?? String(err) },
      };
      setStatus(`error ${e.code ?? ''}: ${e.message ?? String(err)}`);
      document.title = 'export-error';
    } finally {
      handleRef.current = null;
    }
  }

  return (
    <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 20 }}>On-device export (dev)</h1>
      <p style={{ opacity: 0.7 }}>
        {blocker ? `Not available here: ${blocker}` : 'WebCodecs export worker - same code path as the editor.'}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={template} onChange={(e) => setTemplate(e.target.value)}>
          {ALL_TEMPLATES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)}>
          {['720p', '1080p', '2K', '4K'].map((q) => (
            <option key={q}>{q}</option>
          ))}
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          <option>mp4</option>
          <option>webm</option>
        </select>
        <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
          {['16:9', '9:16', '1:1', '4:5', '4:3', '21:9'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <input
          type="file"
          accept="video/*"
          data-testid="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f);
          }}
        />
        <button type="button" data-testid="cancel" onClick={() => handleRef.current?.cancel()}>
          Cancel
        </button>
      </div>
      <p>
        Status: <b data-testid="status">{status}</b>
      </p>
      {summary && <p data-testid="summary">{summary}</p>}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {resultUrl && <video src={resultUrl} controls style={{ maxWidth: 560, background: '#000' }} />}
        {thumbUrl && <img src={thumbUrl} alt="thumbnail" style={{ maxWidth: 240 }} />}
      </div>
    </div>
  );
}
