/**
 * /dev/local-media — exercise the device-side media store without logging in.
 *
 * Pick a video: it is probed (Mediabunny), copied into OPFS through the
 * worker, read back, and played from a blob URL — the exact path the upload
 * page and the editor use. Records and storage usage are listed below so a
 * tester can see what the browser is holding. Dev builds only (App.tsx).
 *
 * Automation hook: with `?auto=1` the page runs the whole flow as soon as a
 * file is set, parks results on `window.__localMediaDev`, and flips
 * `document.title` to `localmedia-ready` / `localmedia-error`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { probeMediaFile, type MediaProbe } from '../lib/media/probe';
import {
  deleteSource,
  getSourceFile,
  getStorageInfo,
  isLocalMediaSupported,
  listExports,
  listSources,
  storeSourceFile,
  type LocalExportRecord,
  type LocalSourceRecord,
} from '../lib/media/localMedia';

declare global {
  interface Window {
    __localMediaDev?: {
      probe: MediaProbe | null;
      stored: LocalSourceRecord | null;
      readBackSize: number;
      videoWidth: number;
      videoHeight: number;
      error?: string;
    };
  }
}

function fmtMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LocalMediaDevPage() {
  const [params] = useSearchParams();
  const auto = params.get('auto') === '1';
  const [supported] = useState(isLocalMediaSupported);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [sources, setSources] = useState<LocalSourceRecord[]>([]);
  const [exports, setExports] = useState<LocalExportRecord[]>([]);
  const [storage, setStorage] = useState({ usedMB: 0, quotaMB: 0, percentUsed: 0 });
  const [playing, setPlaying] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setSources(await listSources());
    setExports(await listExports());
    setStorage(await getStorageInfo());
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [refresh]);

  const play = useCallback(async (projectId: string) => {
    const file = await getSourceFile(projectId);
    const v = videoRef.current;
    if (!file || !v) return null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    v.src = objectUrlRef.current;
    setPlaying(projectId);
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        v.removeEventListener('loadedmetadata', done);
        v.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        v.removeEventListener('loadedmetadata', done);
        v.removeEventListener('error', fail);
        reject(new Error('video element could not open the stored file'));
      };
      v.addEventListener('loadedmetadata', done);
      v.addEventListener('error', fail);
    });
    return file;
  }, []);

  const runFlow = useCallback(
    async (file: File) => {
      const result: NonNullable<Window['__localMediaDev']> = {
        probe: null,
        stored: null,
        readBackSize: 0,
        videoWidth: 0,
        videoHeight: 0,
      };
      try {
        setStatus('probing…');
        result.probe = await probeMediaFile(file);
        setProbe(result.probe);

        const projectId = `dev-${Date.now().toString(36)}`;
        setStatus('copying into OPFS…');
        setProgress(0);
        result.stored = await storeSourceFile(projectId, file, result.probe, (w, t) =>
          setProgress(Math.round((w / t) * 100)),
        );
        setProgress(100);

        setStatus('reading back…');
        const back = await play(projectId);
        result.readBackSize = back?.size ?? 0;
        const v = videoRef.current;
        result.videoWidth = v?.videoWidth ?? 0;
        result.videoHeight = v?.videoHeight ?? 0;
        if (result.readBackSize !== file.size) {
          throw new Error(`size mismatch: stored ${result.readBackSize}, picked ${file.size}`);
        }
        setStatus('done');
        window.__localMediaDev = result;
        document.title = 'localmedia-ready';
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        setStatus(`error: ${result.error}`);
        window.__localMediaDev = result;
        document.title = 'localmedia-error';
      } finally {
        await refresh();
      }
    },
    [play, refresh],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void runFlow(file);
  };

  if (!supported) {
    return (
      <div style={{ padding: 24, color: '#fff' }}>
        <h1>Local media: unsupported</h1>
        <p>This browser lacks OPFS, IndexedDB or Workers - uploads keep working, playback streams from the server.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui', maxWidth: 960 }}>
      <h1 style={{ fontSize: 20 }}>Local media store (dev)</h1>
      <p style={{ opacity: 0.7 }}>
        Pick a video → probe → copy into OPFS → read back → play. {auto ? '(auto mode)' : ''}
      </p>
      <input type="file" accept="video/*" onChange={onPick} data-testid="file" />
      <p>
        Status: <b data-testid="status">{status}</b> {progress > 0 && `${progress}%`}
      </p>

      <video ref={videoRef} controls muted playsInline style={{ width: 480, background: '#000' }} />

      <h2 style={{ fontSize: 16 }}>Probe</h2>
      <pre style={{ fontSize: 12, background: '#111', padding: 12, overflow: 'auto' }}>
        {probe ? JSON.stringify(probe, null, 2) : '-'}
      </pre>

      <h2 style={{ fontSize: 16 }}>
        Storage: {storage.usedMB} / {storage.quotaMB} MB ({storage.percentUsed}%)
      </h2>

      <h2 style={{ fontSize: 16 }}>Sources ({sources.length})</h2>
      <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          {sources.map((s) => (
            <tr key={s.projectId} style={{ borderBottom: '1px solid #333' }}>
              <td style={{ padding: 4 }}>{s.projectId}</td>
              <td style={{ padding: 4 }}>{s.name}</td>
              <td style={{ padding: 4 }}>{fmtMB(s.size)}</td>
              <td style={{ padding: 4 }}>
                {s.probe ? `${s.probe.width}×${s.probe.height} ${s.probe.videoCodec ?? '?'}/${s.probe.audioCodec ?? '-'} ${s.probe.fps}fps` : 'no probe'}
              </td>
              <td style={{ padding: 4 }}>
                <button type="button" onClick={() => void play(s.projectId)} disabled={playing === s.projectId}>
                  Play
                </button>{' '}
                <button
                  type="button"
                  onClick={() => void deleteSource(s.projectId).then(refresh)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16 }}>Exports ({exports.length})</h2>
      <ul style={{ fontSize: 12 }}>
        {exports.map((x) => (
          <li key={x.id}>
            {x.title} · {x.template} · {x.quality} · {fmtMB(x.fileSize)}
          </li>
        ))}
      </ul>
    </div>
  );
}
