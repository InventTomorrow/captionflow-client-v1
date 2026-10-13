/**
 * /clips/:projectId/:clipId — one clip, large: play it, move its in/out point
 * by sentences, pick a caption template and the framing (face-tracked on this
 * device the first time Auto is used), rename it, render it here and download.
 * "Open in editor" opens the clip as its own video in the captions editor
 * (its own project: video cut on this device, captions and style copied) —
 * nothing is re-transcribed or regenerated.
 */
import { Captions, ChevronLeft, ChevronRight, Pause, PenLine, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipFormatToggle } from '../../components/clips/ClipFormatToggle';
import { ClipPreview } from '../../components/clips/ClipPreview';
import { ClipTemplatePicker } from '../../components/clips/ClipTemplatePicker';
import { ReframeControl } from '../../components/clips/ReframeControl';
import { TrimNudger } from '../../components/clips/TrimNudger';
import { errorMessage } from '../../lib/api';
import type { ClipCropMode, ClipPatch } from '../../lib/clips/api';
import { clipAspect, clipStyle, cropTrackFor, formatClipLength, scoreTone, textInRange } from '../../lib/clips/clipMath';
import { useOpenInEditor } from '../../lib/clips/useOpenInEditor';
import { ensureFaceTrack, needsFaceTrack } from '../../lib/clips/autoFrame';
import { useClipSource, useProjectCaptions, useProjectStyle } from '../../lib/clips/useClipMedia';
import { downloadLocalFile, exportFileName } from '../../lib/export/clientExport';
import { latestExportForClip } from '../../lib/media/localMedia';
import type { ExportQuality } from '../../lib/render/frame';
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
  const openEditor = useOpenInEditor();
  const [params, setParams] = useSearchParams();
  const timeBar = useRef<HTMLSpanElement | null>(null);
  const timeText = useRef<HTMLSpanElement | null>(null);

  // Always fetch on open: the captions editor may have changed this clip's look.
  useEffect(() => {
    void loadProject(projectId).catch((e) => setError(errorMessage(e, 'Couldn’t load this clip')));
  }, [projectId, loadProject]);

  const clips = data?.clips ?? [];
  const index = clips.findIndex((c) => c._id === clipId);
  const clip = index >= 0 ? clips[index] : undefined;
  const project = data?.project;
  const source = useClipSource(projectId, project?.video?.kind);
  const captions = useProjectCaptions(projectId, !!project);
  const projectStyle = useProjectStyle(projectId);
  const style = useMemo(() => (projectStyle && clip ? clipStyle(projectStyle, clip) : null), [projectStyle, clip]);
  const allowedQualities = QUALITIES.slice(0, QUALITIES.indexOf(maxQuality as ExportQuality) + 1);
  const sentences = data?.sentences;
  const startText = useMemo(() => {
    const s = clip && sentences?.[clip.startIdx];
    return s && captions ? textInRange(captions, s[0], s[1]) : '';
  }, [clip, sentences, captions]);
  const endText = useMemo(() => {
    const s = clip && sentences?.[clip.endIdx];
    return s && captions ? textInRange(captions, s[0], s[1]) : '';
  }, [clip, sentences, captions]);

  useEffect(() => setTitle(clip?.title ?? ''), [clip?._id, clip?.title]);

  // ?open=editor (an old link into the clip's editor): open it right away.
  const openNow = params.get('open') === 'editor';
  const { open: openInEditor } = openEditor;
  useEffect(() => {
    if (!openNow || !clip) return;
    setParams({}, { replace: true });
    openInEditor(projectId, clip);
  }, [openNow, clip, projectId, openInEditor, setParams]);

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
  const length = clip.end - clip.start;
  const aspect = clipAspect(clip);
  const landscape = aspect === '16:9';

  return (
    <div className="clips-page clip-editor">
      <nav className="clips-crumbs" aria-label="Breadcrumb">
        <Link to="/clips">Clips</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/clips/${projectId}`}>{project?.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{clip.title || 'Clip'}</span>
      </nav>

      <header className="clip-editor-head">
        <div className="clip-editor-heading">
          <span className={`clip-score clip-score-${scoreTone(clip.score)} is-static`} title="AI score">
            {clip.score}
          </span>
          <div className="clip-editor-heading-text">
            <p className="clip-editor-kicker">
              Clip {index + 1} of {clips.length} · {formatClipLength(length)}
            </p>
            <h1 className="clip-editor-title" dir="auto">
              {clip.title || 'Untitled clip'}
            </h1>
          </div>
        </div>
        <div className="clip-editor-head-actions">
          <span className="clip-mode-nav">
            <button
              type="button"
              className="clip-icon-btn"
              disabled={!prev}
              onClick={() => prev && navigate(`/clips/${projectId}/${prev._id}`)}
              aria-label="Previous clip"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="clip-icon-btn"
              disabled={!next}
              onClick={() => next && navigate(`/clips/${projectId}/${next._id}`)}
              aria-label="Next clip"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </span>
          <button type="button" className="btn primary clip-open-editor" onClick={() => openEditor.open(projectId, clip)}>
            <Captions size={17} aria-hidden="true" />
            Open in editor
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className={`clip-editor-grid${landscape ? ' is-landscape' : ''}`}>
        <section className="clip-editor-stage" aria-label="Preview">
          <div className={`clip-stage-frame${landscape ? ' is-landscape' : ''}`}>
            {source.url && captions && style ? (
              <ClipPreview
                src={source.url}
                credentials={!source.local}
                start={clip.start}
                end={clip.end}
                captions={captions}
                style={style}
                track={cropTrackFor(clip)}
                aspect={aspect}
                playing={playing}
                muted={muted}
                className="is-large"
                onTime={(t) => {
                  if (timeBar.current) timeBar.current.style.width = `${Math.min(100, (100 * t) / length)}%`;
                  if (timeText.current) timeText.current.textContent = formatClipLength(t);
                }}
              />
            ) : (
              <div className={`clip-preview is-large clip-preview-empty${landscape ? ' is-landscape' : ''}`}>
                {source.missing ? 'The original video isn’t on this device.' : 'Loading…'}
              </div>
            )}
            <div className="clip-stage-controls">
              <button
                type="button"
                className="clip-stage-btn"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              </button>
              <span className="clip-stage-time">
                <span ref={timeText}>0:00</span> / {formatClipLength(length)}
              </span>
              <button
                type="button"
                className="clip-stage-btn"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
                aria-pressed={!muted}
              >
                {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <span className="clip-time" aria-hidden="true">
            <span ref={timeBar} />
          </span>
        </section>

        <section className="clip-editor-side" aria-label="Clip settings">
          <div className="clip-side-card">
            <label className="clip-field">
              <span>Title</span>
              <input
                type="text"
                dir="auto"
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== clip.title && void save({ title: title.trim() })}
              />
            </label>
            {(clip.hook || clip.reason) && (
              <details className="clip-why">
                <summary>Why this clip</summary>
                {clip.hook && (
                  <p className="clip-card-hook" dir="auto">
                    “{clip.hook}”
                  </p>
                )}
                {clip.reason && (
                  <p className="clip-card-reason" dir="auto">
                    {clip.reason}
                  </p>
                )}
              </details>
            )}
          </div>

          <div className="clip-side-card">
            <h2 className="clip-side-h">Trim</h2>
            <TrimNudger
              startIdx={clip.startIdx}
              endIdx={clip.endIdx}
              sentences={data.sentences}
              busy={saving}
              startText={startText}
              endText={endText}
              onChange={(startIdx, endIdx) => {
                // The server clears an Auto face track when the range moves; it is recomputed here.
                void save({ startIdx, endIdx });
              }}
            />
          </div>

          <div className="clip-side-card">
            <h2 className="clip-side-h">Format</h2>
            <ClipFormatToggle value={aspect} disabled={saving} onChange={(v) => v && v !== aspect && void save({ aspect: v })} />
            <p className="clip-format-hint">
              {landscape
                ? 'The whole frame, as filmed — for YouTube, X or LinkedIn.'
                : 'Vertical for Shorts, Reels and TikTok, cropped around the speaker.'}{' '}
              Render it in both formats by switching and rendering again.
            </p>
            {!landscape && (
              <>
                <h3 className="clip-side-sub">Framing</h3>
                <ReframeControl
                  mode={clip.crop.mode}
                  x={clip.crop.x}
                  busy={saving}
                  status={reframeStatus}
                  onMode={setMode}
                  onX={(x) => void save({ crop: { mode: 'manual', x } })}
                />
              </>
            )}
          </div>

          <div className="clip-side-card">
            <div className="clip-side-row">
              <h2 className="clip-side-h">Caption style</h2>
              <button type="button" className="clip-customize" onClick={() => openEditor.open(projectId, clip)}>
                <PenLine size={15} aria-hidden="true" />
                Customize in editor
              </button>
            </div>
            <ClipTemplatePicker
              templateKey={clip.templateKey}
              custom={!!clip.style}
              disabled={saving}
              onPick={(templateKey) => void save({ templateKey })}
            />
          </div>

          <div className="clip-side-card">
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
              {rendered && !rendering && (
                <button type="button" className="btn ghost" onClick={() => void download()}>
                  Download MP4
                </button>
              )}
            </div>
            {rendering && (
              <div className="clip-render-progress" role="progressbar" aria-valuenow={Math.round(render?.percent ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${Math.max(2, render?.percent ?? 0)}%` }} />
              </div>
            )}
            {rendering && <p className="clips-sub">{render?.detail}</p>}
            {render?.status === 'error' && (
              <p className="clip-card-error" role="alert">
                {render.error}
              </p>
            )}
            {!source.local && !source.loading && (
              <p className="clips-sub">
                Rendering needs the original video on this device.{' '}
                <Link to={`/clips/${projectId}`}>Locate the original file</Link>
              </p>
            )}
          </div>
        </section>
      </div>
      {openEditor.dialog}
    </div>
  );
}
