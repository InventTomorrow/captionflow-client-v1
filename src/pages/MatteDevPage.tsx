/**
 * /dev/matte — "text behind person" for the on-device export, in isolation.
 *
 * Pick a video (or pass ?src=/some/public/video.mp4); matteTest.worker.ts
 * decodes the first N seconds with Mediabunny, segments every frame with
 * personMatte.ts inside a module worker and composites a big test caption
 * with the person drawn over it at two 1080p frame shapes (one same-aspect,
 * one letterboxed for most sources). Shows the frames, the mask overlaid on
 * the footage, per-stage ms/frame, the delegate and a determinism check.
 * Dev builds only (App.tsx).
 *
 * Query: ?src=&seconds=5&delegate=GPU|CPU&edge=512&snapshots=3&encode=1
 * Automation: `window.__matteDev` holds the result (or error);
 * `document.title` becomes `matte-ready` / `matte-error`;
 * `window.__matteDev.png(i, 'composite' | 'maskOverlay')` → PNG data URL.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  MatteSnapshot,
  MatteTestLayout,
  MatteTestOut,
  MatteTestRequest,
  MatteTestResult,
} from '../lib/export/matteProtocol';
import type { MatteDelegate } from '../lib/export/personMatte';

const LAYOUTS: MatteTestLayout[] = [
  { label: '16x9-1080p', width: 1920, height: 1080 },
  { label: '9x16-1080p', width: 1080, height: 1920 },
];

type SnapshotInfo = Omit<MatteSnapshot, 'composite' | 'maskOverlay'>;

declare global {
  interface Window {
    __matteDev?: {
      wallMs: number;
      result?: Omit<MatteTestResult, 'snapshots'> & { snapshots: SnapshotInfo[] };
      error?: string;
      png?: (index: number, kind: 'composite' | 'maskOverlay') => string;
    };
  }
}

function bitmapToDataUrl(bitmap: ImageBitmap): string {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  return c.toDataURL('image/png');
}

function BitmapView({ bitmap, label }: { bitmap: ImageBitmap; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  const portrait = bitmap.height > bitmap.width;
  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={ref}
        style={{ width: portrait ? 180 : 320, height: 'auto', display: 'block', background: '#000' }}
      />
      <figcaption style={{ fontSize: 12, opacity: 0.7 }}>{label}</figcaption>
    </figure>
  );
}

export function MatteDevPage() {
  const [params] = useSearchParams();
  const [seconds, setSeconds] = useState(Number(params.get('seconds')) || 5);
  const [delegate, setDelegate] = useState<'auto' | MatteDelegate>(
    params.get('delegate') === 'GPU' || params.get('delegate') === 'CPU'
      ? (params.get('delegate') as MatteDelegate)
      : 'auto',
  );
  const [edge, setEdge] = useState(Number(params.get('edge')) || 512);
  const [encode, setEncode] = useState(params.get('encode') === '1');
  const snapshotsWanted = Number(params.get('snapshots')) || 3;
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState<MatteTestResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  function run(source: Blob) {
    workerRef.current?.terminate();
    setResult(null);
    document.title = 'matte-running';
    const started = performance.now();
    const worker = new Worker(new URL('../lib/export/matteTest.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const fail = (message: string) => {
      window.__matteDev = { wallMs: Math.round(performance.now() - started), error: message };
      setStatus(`error: ${message}`);
      document.title = 'matte-error';
      worker.terminate();
    };
    worker.onerror = (e) => fail(e.message || 'worker failed to start');
    worker.onmessage = (e: MessageEvent<MatteTestOut>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setStatus(`${msg.stage}… ${msg.frames} frames`);
      } else if (msg.type === 'error') {
        fail(msg.message);
      } else {
        const r = msg.result;
        setResult(r);
        const { snapshots, ...rest } = r;
        window.__matteDev = {
          wallMs: Math.round(performance.now() - started),
          result: { ...rest, snapshots: snapshots.map(({ composite: _c, maskOverlay: _m, ...info }) => info) },
          png: (i, kind) => bitmapToDataUrl(snapshots[i][kind]),
        };
        setStatus('done');
        document.title = 'matte-ready';
        // Keep the worker alive: bitmaps drawn on a worker's OffscreenCanvas
        // are GPU-backed and go blank once that worker is terminated.
      }
    };
    const req: MatteTestRequest = {
      type: 'run',
      source,
      seconds,
      maxInputEdge: edge,
      delegate: delegate === 'auto' ? undefined : delegate,
      layouts: LAYOUTS,
      snapshots: snapshotsWanted,
      encodeBenchmark: encode,
    };
    worker.postMessage(req);
  }

  // ?src= runs straight away (automation).
  const src = params.get('src');
  const autoRan = useRef(false);
  useEffect(() => {
    if (!src || autoRan.current) return;
    autoRan.current = true;
    setStatus('fetching source…');
    void fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch ${src}: ${r.status}`);
        return r.blob();
      })
      .then((b) => run(b))
      .catch((err: unknown) => {
        window.__matteDev = { wallMs: 0, error: String(err) };
        setStatus(`error: ${String(err)}`);
        document.title = 'matte-error';
      });
    // run() reads the initial settings; this fires once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return (
    <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui', maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20 }}>Text behind person - on-device matte (dev)</h1>
      <p style={{ opacity: 0.7 }}>
        MediaPipe selfie segmenter in a module worker on Mediabunny-decoded frames (personMatte.ts).
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          seconds{' '}
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value) || 5)}
            style={{ width: 64 }}
          />
        </label>
        <label>
          delegate{' '}
          <select value={delegate} onChange={(e) => setDelegate(e.target.value as 'auto' | MatteDelegate)}>
            <option value="auto">auto (GPU → CPU)</option>
            <option value="GPU">GPU</option>
            <option value="CPU">CPU</option>
          </select>
        </label>
        <label>
          max input edge{' '}
          <input
            type="number"
            min={64}
            step={32}
            value={edge}
            onChange={(e) => setEdge(Number(e.target.value) || 512)}
            style={{ width: 72 }}
          />
        </label>
        <label>
          <input type="checkbox" checked={encode} onChange={(e) => setEncode(e.target.checked)} /> encode benchmark
        </label>
        <input
          type="file"
          accept="video/*"
          data-testid="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(f);
          }}
        />
      </div>
      <p>
        Status: <b data-testid="status">{status}</b>
      </p>
      {result && (
        <>
          <pre data-testid="summary" style={{ fontSize: 12, background: '#111', padding: 12, overflowX: 'auto' }}>
            {JSON.stringify({ ...result, snapshots: result.snapshots.length }, null, 2)}
          </pre>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {result.snapshots.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <BitmapView bitmap={s.composite} label={`${s.layout} @${s.timestampSec.toFixed(2)}s`} />
                <BitmapView bitmap={s.maskOverlay} label="mask" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
