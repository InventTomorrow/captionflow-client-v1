/**
 * /clips/:projectId/:clipId — one clip, large: play it, move its in/out point
 * by sentences, pick a caption style and the framing (face-tracked on this
 * device the first time Auto is used), rename it, render it here and download.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipPreview } from '../../components/clips/ClipPreview';
import { ReframeControl } from '../../components/clips/ReframeControl';
import { TrimNudger } from '../../components/clips/TrimNudger';
import { errorMessage } from '../../lib/api';
import type { ClipCropMode, ClipPatch } from '../../lib/clips/api';
import { clipStyle, cropTrackFor, formatClipLength, scoreTone } from '../../lib/clips/clipMath';
import { ensureFaceTrack, needsFaceTrack } from '../../lib/clips/autoFrame';
import { useClipSource, useProjectCaptions, useProjectStyle } from '../../lib/clips/useClipMedia';
import { downloadLocalFile, exportFileName, isDeviceExportTemplate } from '../../lib/export/clientExport';
import { latestExportForClip } from '../../lib/media/localMedia';
import type { ExportQuality } from '../../lib/render/frame';
import { pickerTemplates } from '../../lib/templateCatalog';
import { useAuthStore } from '../../stores/authStore';
import { useClipsStore } from '../../stores/clipsStore';

const QUALITIES: ExportQuality[] = ['720p', '1080p', '2K', '4K'];

export function ClipEditorPage() {
  const { projectId = '', clipId = '' } = useParams();
  const navigate = useNavigate();
  const data = useClipsStore((s) => s.byProject[projectId]);
  const render = useClipsStore((s) => s.renders[clipId]);
  const loadProject = useClipsStore((s) => s.loadProject);
  const updateClip = useClipsStore((s) => s.updateClip);
  const enqueueRenders = useClipsStore((s) => s.enqueueRenders);
  const cancelRender = useClipsStore((s) => s.cancelRender);
  const maxQuality = useAuthStore((s) => s.user?.limits?.maxExportQuality) ?? '1080p';

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [title, setTitle] = useState('');
  const [quality, setQuality] = useState<ExportQuality>('1080p');
  const [reframeStatus, setReframeStatus] = useState('');
  const timeBar = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!data) void loadProject(projectId).catch((e) => setError(errorMessage(e, 'Couldn’t load this clip')));
  }, [data, projectId, loadProject]);

  const clips = data?.clips ?? [];
  const index = clips.findIndex((c) => c._id === clipId);
  const clip = index >= 0 ? clips[index] : undefined;
  const project = data?.project;
  const source = useClipSource(projectId, project?.video?.kind);
  const captions = useProjectCaptions(projectId, !!project);
  const projectStyle = useProjectStyle(projectId);
  const style = useMemo(() => (projectStyle ? clipStyle(projectStyle, clip?.templateKey) : null), [projectStyle, clip?.templateKey]);
  const templates = useMemo(() => pickerTemplates().filter((t) => isDeviceExportTemplate(t.preset.template)), []);
  const allowedQualities = QUALITIES.slice(0, QUALITIES.indexOf(maxQuality as ExportQuality) + 1);

  useEffect(() => setTitle(clip?.title ?? ''), [clip?._id, clip?.title]);

  async function save(patch: ClipPatch) {
    if (!clip) return;
    setSaving(true);
    setError('');
    try {
      await updateClip(clip._id, patch);
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t save that change'));
    } finally {
      setSaving(false);
    }
  }

  // Auto framing: track the face once per clip range (shared with the clip list and renders).
  const setClipLocal = useClipsStore((s) => s.setClipLocal);
  useEffect(() => {
    if (!clip || !needsFaceTrack(clip) || !source.local) return;
    let live = true;
    setReframeStatus('Finding the speaker…');
    void ensureFaceTrack(projectId, clip, (done, total) => live && setReframeStatus(`Finding the speaker… ${Math.round((100 * done) / total)}%`))
      .then((u) => {
        if (u) setClipLocal(u);
        if (live) setReframeStatus('');
      })
      .catch(() => live && setReframeStatus('Couldn’t track the face — using the centre.'));
    return () => {
      live = false;
    };
  }, [clip, source.local, projectId, setClipLocal]);

  function setMode(mode: ClipCropMode) {
    if (!clip) return;
    // A new in/out point invalidates the old face track; Auto recomputes it.
    void save(mode === 'auto' ? { crop: { mode, track: [] } } : { crop: { mode } });
  }

  async function startRender() {
    if (!clip || !project || !projectStyle) return;
    enqueueRenders([{ clip, ctx: { projectId, projectName: project.name, projectStyle }, opts: { quality, format: 'mp4' } }]);
  }

  async function download() {
    if (!clip) return;
    const rec = await latestExportForClip(projectId, clip._id);
    if (rec) await downloadLocalFile(rec.opfsPath, exportFileName(clip.title || project?.name || 'clip', rec.quality, rec.format));
  }

  if (!data) return <div className="clips-page">{error ? <div className="error-banner">{error}</div> : <p className="clips-loading">Loading…</p>}</div>;
  if (!clip) {
    return (
      <div className="clips-page">
        <p>This clip no longer exists.</p>
        <Link to={`/clips/${projectId}`} className="btn ghost">
          Back to clips
        </Link>
      </div>
    );
  }

  const rendering = render?.status === 'queued' || render?.status === 'rendering';
  const rendered = clip.status === 'rendered' || render?.status === 'done';
  const prev = clips[index - 1];
  const next = clips[index + 1];

  return (
    <div className="clips-page clip-editor">
      <nav className="clips-crumbs" aria-label="Breadcrumb">
        <Link to="/clips">Clips</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/clips/${projectId}`}>{project?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{clip.title || 'Clip'}</span>
      </nav>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="clip-editor-grid">
        <section className="clip-editor-stage" aria-label="Preview">
          {source.url && captions && style ? (
            <ClipPreview
              src={source.url}
              credentials={!source.local}
              start={clip.start}
              end={clip.end}
              captions={captions}
              style={style}
              track={cropTrackFor(clip)}
              playing={playing}
              muted={muted}
              className="is-large"
              onTime={(t) => {
                if (timeBar.current) timeBar.current.style.width = `${Math.min(100, (100 * t) / (clip.end - clip.start))}%`;
              }}
            />
          ) : (
            <div className="clip-preview is-large clip-preview-empty">
              {source.missing ? 'The original video isn’t on this device.' : 'Loading…'}
            </div>
          )}
          <span className="clip-time" aria-hidden="true">
            <span ref={timeBar} />
          </span>
          <div className="clip-player-bar">
            <button type="button" className="btn ghost clip-btn" onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="btn ghost clip-btn" onClick={() => setMuted((m) => !m)} aria-pressed={!muted}>
              {muted ? 'Sound off' : 'Sound on'}
            </button>
            <span className="clip-nav">
              <button type="button" className="btn ghost clip-btn" disabled={!prev} onClick={() => prev && navigate(`/clips/${projectId}/${prev._id}`)}>
                ◀ Prev
              </button>
              <button type="button" className="btn ghost clip-btn" disabled={!next} onClick={() => next && navigate(`/clips/${projectId}/${next._id}`)}>
                Next ▶
              </button>
            </span>
          </div>
        </section>

        <section className="clip-editor-side" aria-label="Clip settings">
          <div className="clip-editor-meta">
            <span className={`clip-score clip-score-${scoreTone(clip.score)} is-static`}>{clip.score}</span>
            <span>{formatClipLength(clip.end - clip.start)}</span>
          </div>
          <label className="clip-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== clip.title && void save({ title: title.trim() })}
            />
          </label>
          {clip.hook && <p className="clip-card-hook">“{clip.hook}”</p>}
          {clip.reason && <p className="clip-card-reason">{clip.reason}</p>}

          <h2 className="clip-side-h">Trim</h2>
          <TrimNudger
            startIdx={clip.startIdx}
            endIdx={clip.endIdx}
            sentences={data.sentences}
            busy={saving}
            onChange={(startIdx, endIdx) => {
              void save({ startIdx, endIdx, ...(clip.crop.mode === 'auto' ? { crop: { mode: 'auto' as const, track: [] } } : {}) });
            }}
          />

          <h2 className="clip-side-h">Framing</h2>
          <ReframeControl
            mode={clip.crop.mode}
            x={clip.crop.x}
            busy={saving}
            status={reframeStatus}
            onMode={setMode}
            onX={(x) => void save({ crop: { mode: 'manual', x } })}
          />

          <label className="clip-field">
            <span>Caption style</span>
            <select value={clip.templateKey ?? ''} onChange={(e) => void save({ templateKey: e.target.value || null })} disabled={saving}>
              <option value="">Same as the video</option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <h2 className="clip-side-h">Render</h2>
          <div className="clip-render-row">
            <label className="clip-field clip-field-inline">
              <span>Quality</span>
              <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={rendering}>
                {allowedQualities.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
            {rendering ? (
              <button type="button" className="btn ghost" onClick={() => cancelRender(clip._id)}>
                Cancel {Math.round(render?.percent ?? 0)}%
              </button>
            ) : (
              <button type="button" className="btn primary" disabled={!source.local || !projectStyle} onClick={() => void startRender()}>
                {rendered ? 'Render again' : 'Render clip'}
              </button>
            )}
          </div>
          {rendering && <p className="clips-sub">{render?.detail}</p>}
          {render?.status === 'error' && (
            <p className="clip-card-error" role="alert">
              {render.error}
            </p>
          )}
          {rendered && !rendering && (
            <button type="button" className="btn ghost" onClick={() => void download()}>
              Download MP4
            </button>
          )}
          {!source.local && !source.loading && (
            <p className="clips-sub">Rendering needs the original video on this device.</p>
          )}
        </section>
      </div>
    </div>
  );
}
