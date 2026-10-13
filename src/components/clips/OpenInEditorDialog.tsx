/**
 * OpenInEditorDialog — "Open in editor" for one clip: makes (or reopens) the
 * clip's own editor project with a progress line, asks first when the clip
 * changed after its editor copy was made, then goes to the editor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../lib/api';
import type { Clip } from '../../lib/clips/api';
import { openClipInEditor, type OpenStage } from '../../lib/clips/openInEditor';
import { useClipsStore } from '../../stores/clipsStore';

const STAGE_TEXT: Record<OpenStage, string> = {
  framing: 'Finding the speaker…',
  cutting: 'Cutting the clip on this device…',
  saving: 'Saving the clip’s captions and style…',
  opening: 'Opening the editor…',
};

interface Props {
  projectId: string;
  clip: Clip;
  onClose(): void;
}

export function OpenInEditorDialog({ projectId, clip, onClose }: Props) {
  const navigate = useNavigate();
  const setClipLocal = useClipsStore((s) => s.setClipLocal);
  const [stage, setStage] = useState<OpenStage>('opening');
  const [percent, setPercent] = useState<number | undefined>(undefined);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  const run = useCallback(
    async (opts: { startOver?: boolean; keepEdited?: boolean }) => {
      setBusy(true);
      setError('');
      setStale(false);
      setStage('opening');
      try {
        const r = await openClipInEditor(projectId, clip, {
          ...opts,
          onProgress: (s, p) => {
            setStage(s);
            setPercent(p);
          },
          onClipUpdated: setClipLocal,
        });
        if (r.kind === 'stale') {
          setStale(true);
          setBusy(false);
          return;
        }
        navigate(`/projects/${r.projectId}/editor`);
      } catch (e) {
        setError(errorMessage(e, 'Couldn’t open this clip in the editor'));
        setBusy(false);
      }
    },
    [projectId, clip, navigate, setClipLocal],
  );

  // Once per dialog (React may run effects twice in development).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run({});
  }, [run]);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="open-editor-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="open-editor-title">Open in editor</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="clip-open-name" dir="auto">
            {clip.title || 'Untitled clip'}
          </p>
          {busy && (
            <div className="export-progress" role="status" aria-live="polite">
              <div className="progress-bar thin">
                <div style={{ width: `${stage === 'cutting' ? Math.max(3, percent ?? 0) : stage === 'framing' ? 8 : 100}%` }} />
              </div>
              <span className="muted tiny">
                {STAGE_TEXT[stage]}
                {stage === 'cutting' && percent ? ` ${Math.round(percent)}%` : ''}
              </span>
            </div>
          )}
          {!busy && !stale && !error && <p className="muted tiny">Opening…</p>}
          {stale && (
            <>
              <p className="muted tiny">
                You changed this clip (trim, format, framing or template) after opening it in the editor. Keep the
                version you edited there, or start over from the clip as it is now?
              </p>
              <div className="clip-render-actions">
                <button type="button" className="btn primary" onClick={() => void run({ keepEdited: true })}>
                  Open my edited version
                </button>
                <button type="button" className="btn ghost" onClick={() => void run({ startOver: true })}>
                  Start over from the clip
                </button>
              </div>
            </>
          )}
          {error && (
            <>
              <p className="clip-card-error" role="alert">
                {error}
              </p>
              <div className="clip-render-actions">
                <button type="button" className="btn ghost" onClick={() => void run({})}>
                  Try again
                </button>
              </div>
            </>
          )}
          <p className="muted tiny">
            The clip opens as its own video with its captions and style, ready to edit. Nothing is re-transcribed or
            regenerated.
          </p>
        </div>
      </div>
    </div>
  );
}
