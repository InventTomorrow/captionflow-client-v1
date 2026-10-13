/**
 * ClipRenderDialog — the captions editor's Export in clip mode: renders the
 * clip on this device through the same queue as the Clips pages (trimmed,
 * reframed, 9:16, its saved look), then downloads it.
 */
import { useState } from 'react';
import type { Clip } from '../../lib/clips/api';
import { downloadLocalFile, exportFileName } from '../../lib/export/clientExport';
import type { EditorStyle } from '../../lib/export/styleSnapshot';
import { latestExportForClip } from '../../lib/media/localMedia';
import type { ExportQuality } from '../../lib/render/frame';
import { useAuthStore } from '../../stores/authStore';
import { useClipsStore } from '../../stores/clipsStore';

const QUALITIES: ExportQuality[] = ['720p', '1080p', '2K', '4K'];

interface ClipRenderDialogProps {
  projectId: string;
  projectName: string;
  projectStyle: Partial<EditorStyle>;
  clipId: string;
  /** Save the editor's pending style first, so the render matches the preview. */
  beforeRender(): Promise<void>;
  onClose(): void;
}

export function ClipRenderDialog({ projectId, projectName, projectStyle, clipId, beforeRender, onClose }: ClipRenderDialogProps) {
  const render = useClipsStore((s) => s.renders[clipId]);
  const enqueueRenders = useClipsStore((s) => s.enqueueRenders);
  const cancelRender = useClipsStore((s) => s.cancelRender);
  const maxQuality = useAuthStore((s) => s.user?.limits?.maxExportQuality) ?? '1080p';
  const allowed = QUALITIES.slice(0, QUALITIES.indexOf(maxQuality as ExportQuality) + 1);
  const [quality, setQuality] = useState<ExportQuality>(allowed.includes('1080p') ? '1080p' : allowed[0]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const rendering = render?.status === 'queued' || render?.status === 'rendering';
  const done = render?.status === 'done';

  async function start() {
    setError('');
    setStarting(true);
    try {
      await beforeRender();
      const clip: Clip | undefined = useClipsStore.getState().byProject[projectId]?.clips.find((c) => c._id === clipId);
      if (!clip) throw new Error('This clip no longer exists');
      enqueueRenders([{ clip, ctx: { projectId, projectName, projectStyle }, opts: { quality, format: 'mp4' } }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start the render');
    } finally {
      setStarting(false);
    }
  }

  async function download() {
    const rec = await latestExportForClip(projectId, clipId);
    const clip = useClipsStore.getState().byProject[projectId]?.clips.find((c) => c._id === clipId);
    if (rec) await downloadLocalFile(rec.opfsPath, exportFileName(clip?.title || projectName || 'clip', rec.quality, rec.format));
    else setError('That render isn’t on this device any more — render it again.');
  }

  return (
    <div className="modal-backdrop" onClick={rendering ? undefined : onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="clip-render-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="clip-render-title">Render clip</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted tiny">
            Renders this clip on this device: 9:16, framed and trimmed as on the clip page, with the style you set here.
          </p>
          <label className="props-field">
            Resolution
            <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={rendering || starting}>
              {allowed.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          {rendering && (
            <div className="export-progress">
              <div className="progress-bar thin">
                <div style={{ width: `${Math.max(2, render?.percent ?? 0)}%` }} />
              </div>
              <span className="muted tiny">{render?.detail || `Rendering… ${Math.round(render?.percent ?? 0)}%`}</span>
            </div>
          )}
          {(error || render?.status === 'error') && (
            <p className="clip-card-error" role="alert">
              {error || render?.error}
            </p>
          )}
          <div className="clip-render-actions">
            {rendering ? (
              <button type="button" className="btn ghost" onClick={() => cancelRender(clipId)}>
                Cancel
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={() => void start()} disabled={starting}>
                {starting ? 'Saving…' : done ? 'Render again' : 'Render clip'}
              </button>
            )}
            {done && !rendering && (
              <button type="button" className="btn ghost" onClick={() => void download()}>
                Download MP4
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
