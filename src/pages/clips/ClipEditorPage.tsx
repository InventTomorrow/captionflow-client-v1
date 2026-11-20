/**
 * /clips/:projectId/:clipId — one clip, large: play it, move its in/out point
 * by sentences, pick a caption template and the framing (face-tracked on this
 * device the first time Auto is used), rename it, render it here and download.
 * "Open in editor" opens the clip on its own in the captions editor (its own
 * project playing the original's range, captions and style copied) — nothing
 * is cut, re-transcribed or regenerated.
 *
 * A clip of a video from a pasted link plays from the link at once while just
 * its own part is fetched; the framed, captioned preview takes over when it
 * arrives (again after a trim reaches past it).
 */
import {
  ArrowClockwise,
  ArrowLeft,
  CaretLeft,
  CaretRight,
  ClosedCaptioning,
  DownloadSimple,
  FilmSlate,
  Pause,
  PencilLine,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  SquaresFour,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipFormatToggle } from '../../components/clips/ClipFormatToggle';
import { PremiumSelect } from '../../components/PremiumSelect';
import { ClipPreview } from '../../components/clips/ClipPreview';
import { ClipStyleBrowser } from '../../components/clips/ClipStyleBrowser';
import { ClipTemplatePicker } from '../../components/clips/ClipTemplatePicker';
import { LinkedVideo } from '../../components/clips/LinkedVideo';
import { PageLoader } from '../../components/PageLoader';
import { ReframeControl } from '../../components/clips/ReframeControl';
import { FrameLayoutPicker } from '../../components/clips/FrameLayoutPicker';
import { FramingEditor } from '../../components/clips/FramingEditor';
import { TrimNudger } from '../../components/clips/TrimNudger';
import { errorMessage } from '../../lib/api';
import type { ClipCropMode, ClipPatch } from '../../lib/clips/api';
import { clipAspect, clipLayout, clipStyle, cropTrackFor, formatClipLength, scoreTone, textInRange } from '../../lib/clips/clipMath';
import {
  defaultFraming,
  framingKey,
  layoutVideoType,
  normalizeFraming,
  type ClipFramingV1,
  type FramingLayout,
  type VideoType,
} from '../../lib/clips/framing';
import { needsReframe } from '../../lib/clips/reframe';
import { resolveCaptionAnchor } from '../../lib/captionPosition';
import { useFlagsStore } from '../../stores/flagsStore';
import { cropXAt } from '../../lib/clips/cropTrack';
import { useOpenInEditor } from '../../lib/clips/useOpenInEditor';
import { ensureFaceTrack, needsFaceTrack } from '../../lib/clips/autoFrame';
import { useClipPart, useClipSource, useProjectCaptions, useProjectStyle } from '../../lib/clips/useClipMedia';
import { getClipThumb, getSourceFrame, type SourceFrame } from '../../lib/clips/thumbs';
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
  const [poster, setPoster] = useState<string | undefined>(undefined);
  const [browsing, setBrowsing] = useState(false);
  // Framing layouts: the live (unsaved) layout while dragging, the clip's whole frame, the source size.
  const framingOn = useFlagsStore((s) => s.flags.framingEnabled);
  const styleAll = useClipsStore((s) => s.styleAllClips);
  const stageVideo = useRef<HTMLVideoElement | null>(null);
  const [draft, setDraft] = useState<ClipFramingV1 | null>(null);
  const [sourceFrame, setSourceFrame] = useState<SourceFrame | null>(null);
  const [videoDims, setVideoDims] = useState<[number, number] | null>(null);
  const [typeChoice, setTypeChoice] = useState<VideoType | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [applyAsk, setApplyAsk] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
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
  const imported = !!project?.sourceUrl;
  const source = useClipSource(projectId, project?.video?.kind, imported);
  // A linked video: this clip's own part, fetched while the link plays.
  const part = useClipPart(projectId, clip, { enabled: imported && !source.local, fetch: true, duration: project?.video?.duration });
  const media = source.url
    ? { src: source.url, offset: 0, credentials: !source.local }
    : part.url
      ? { src: part.url, offset: part.media?.offset ?? 0, credentials: false }
      : null;
  /** The clip's video is on this device (framing and renders work without a fetch). */
  const onDevice = source.local || part.status === 'ready';
  const captions = useProjectCaptions(projectId, !!project, clip);
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

  // A poster so the clip shows a frame instantly while the (often streamed) video loads.
  useEffect(() => {
    if (!clip) return;
    let cancelled = false;
    void getClipThumb(projectId, clip, project?.video?.kind).then((url) => {
      if (!cancelled && url) setPoster(url);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, clip, project?.video?.kind, onDevice]);

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
    if (!clip || !needsFaceTrack(clip) || !onDevice) return;
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
  }, [clip, onDevice, projectId, setClipLocal]);

  // A saved framing replaces the live one; another clip starts fresh.
  const savedKey = framingKey(clipLayout(clip ?? {}));
  useEffect(() => setDraft(null), [clip?._id, savedKey]);
  useEffect(() => {
    setApplyAsk(false);
    setTypeChoice(null);
  }, [clip?._id]);

  // The clip's whole frame, for the layout cards and the framing editor.
  const wantsFrame = framingOn && !!clip && clipAspect(clip) === '9:16';
  const clipNow = useRef(clip);
  clipNow.current = clip;
  useEffect(() => {
    setSourceFrame(null);
    const c = clipNow.current;
    if (!wantsFrame || !c) return;
    let live = true;
    void getSourceFrame(projectId, c, project?.video?.kind).then((f) => live && setSourceFrame(f));
    return () => {
      live = false;
    };
    // A new frame only for a new clip, in-point or device copy.
  }, [wantsFrame, projectId, clip?._id, clip?.start, onDevice, project?.video?.kind]);

  // The playing video's real (rotated) size, once it loads.
  useEffect(() => {
    const v = stageVideo.current;
    if (!v) return;
    const read = () => v.videoWidth && setVideoDims([v.videoWidth, v.videoHeight]);
    read();
    v.addEventListener('loadedmetadata', read);
    return () => v.removeEventListener('loadedmetadata', read);
  }, [media?.src]);

  function setMode(mode: ClipCropMode) {
    if (!clip) return;
    // A new in/out point invalidates the old face track; Auto recomputes it.
    void save(mode === 'auto' ? { crop: { mode, track: [] } } : { crop: { mode } });
  }

  async function startRender() {
    if (!clip || !project || !projectStyle) return;
    enqueueRenders([
      {
        clip,
        ctx: { projectId, projectName: project.name, projectStyle, imported, duration: project.video?.duration },
        opts: { quality, format: 'mp4' },
      },
    ]);
  }

  async function download() {
    if (!clip) return;
    const rec = await latestExportForClip(projectId, clip._id);
    if (rec) await downloadLocalFile(rec.opfsPath, exportFileName(clip.title || project?.name || 'clip', rec.quality, rec.format));
  }

  if (!data && !error) return <PageLoader inline />;
  if (!data) return <div className="clips-page"><div className="error-banner">{error}</div></div>;
  if (!clip) {
    return (
      <div className="clips-page">
        <p>This clip no longer exists.</p>
        <Link to={`/clips/${projectId}`} className="btn ghost">
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to clips
        </Link>
      </div>
    );
  }

  if (source.missing) {
    return (
      <div className="clips-page">
        <p>No clip to show.</p>
        <Link to="/clips" className="btn ghost">
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
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
  const track = cropTrackFor(clip);
  const cropX = track ? cropXAt(track, 0) : null;

  // Framing layouts (vertical clips): what is drawn now, and on which source size.
  const savedLayout = clipLayout(clip);
  const layout = landscape ? null : (draft ?? savedLayout);
  const rotated = project?.video?.rotation === 90 || project?.video?.rotation === 270;
  const projDims: [number, number] | null =
    project?.video?.width && project.video.height
      ? rotated
        ? [project.video.height, project.video.width]
        : [project.video.width, project.video.height]
      : null;
  const [srcW, srcH] = videoDims ?? (sourceFrame ? [sourceFrame.width, sourceFrame.height] : (projDims ?? [16, 9]));
  const knownDims = !!(videoDims || sourceFrame || projDims);
  const showLayouts = framingOn && !landscape && (!knownDims || needsReframe(srcW, srcH));
  const videoType: VideoType =
    typeChoice ?? (savedLayout ? layoutVideoType(savedLayout.layout) : (data.status.videoType ?? 'podcast'));
  const activeLayout: FramingLayout | null = layout?.layout ?? (videoType === 'podcast' ? 'single' : null);
  const captionY = style ? resolveCaptionAnchor(style).offsetY / 100 : undefined;

  const commitFraming = (f: ClipFramingV1) => {
    const next = normalizeFraming(f, srcW, srcH);
    setDraft(next);
    void save({ framing: next });
  };
  const pickLayout = (l: FramingLayout) => {
    // Single speaker is the original crop (Auto follows the face); every other card is a layout.
    if (l === 'single') {
      setDraft(null);
      void save({ framing: null });
      return;
    }
    setAdjustOpen(true);
    commitFraming(defaultFraming(l, srcW, srcH, layout));
  };
  // Single speaker with a box of its own: starts where the crop window is now.
  const startSingleBox = () => {
    const base = defaultFraming('single', srcW, srcH);
    const cx = cropX ?? 0.5;
    const a = base.a!;
    setAdjustOpen(true);
    commitFraming({ ...base, a: { ...a, x: Math.min(1 - a.w, Math.max(0, cx - a.w / 2)) } });
  };
  const resetFraming = () => layout && commitFraming(defaultFraming(layout.layout, srcW, srcH));
  async function applyFramingToAll() {
    setApplyBusy(true);
    setError('');
    try {
      await styleAll(projectId, { framing: savedLayout });
      setApplyAsk(false);
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t apply that framing to every clip'));
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div className="clips-page clip-editor">
      <nav className="clips-crumbs" aria-label="Breadcrumb">
        <Link to="/clips">Viral Clips</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/clips/${projectId}`} title={project?.name}>
          {project?.name || 'Project clips'}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Clip {index + 1}</span>
      </nav>

      <header className="clip-editor-head">
        <div className="clip-editor-heading">
          <h1 className="clip-editor-title" dir="auto" title={clip.title || undefined}>
            {clip.title || 'Untitled clip'}
          </h1>
          <p className="clip-editor-kicker">
            <span>
              Clip {index + 1} of {clips.length}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatClipLength(length)}</span>
            <span aria-hidden="true">·</span>
            <span className={`clip-editor-score is-${scoreTone(clip.score)}`} title="Clip score">
              Score {clip.score}
            </span>
          </p>
        </div>
        <div className="clip-editor-head-actions">
          <span className="clip-mode-nav">
            <button
              type="button"
              className="clip-icon-btn"
              disabled={!prev}
              onClick={() => prev && navigate(`/clips/${projectId}/${prev._id}`)}
              aria-label="Previous clip"
              title="Previous clip"
            >
              <CaretLeft size={18} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="clip-icon-btn"
              disabled={!next}
              onClick={() => next && navigate(`/clips/${projectId}/${next._id}`)}
              aria-label="Next clip"
              title="Next clip"
            >
              <CaretRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </span>
          <button type="button" className="btn ghost clip-open-editor" onClick={() => openEditor.open(projectId, clip)}>
            <ClosedCaptioning size={17} aria-hidden="true" />
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
            {media && captions && style ? (
              <ClipPreview
                src={media.src}
                credentials={media.credentials}
                start={clip.start}
                end={clip.end}
                offset={media.offset}
                captions={captions}
                style={style}
                track={cropTrackFor(clip)}
                aspect={aspect}
                framing={layout}
                videoRef={stageVideo}
                poster={poster}
                playing={playing}
                muted={muted}
                className="is-large"
                onTime={(t) => {
                  if (timeBar.current) timeBar.current.style.width = `${Math.min(100, (100 * t) / length)}%`;
                  if (timeText.current) timeText.current.textContent = formatClipLength(t);
                }}
              />
            ) : imported && project?.sourceUrl ? (
              // From the link while this clip's part arrives — nothing else of the video is fetched.
              <div className={`clip-preview is-large clip-part-wait${landscape ? ' is-landscape' : ''}`}>
                <LinkedVideo
                  sourceUrl={project.sourceUrl}
                  range={clip}
                  cropX={cropX}
                  title={clip.title || 'Clip'}
                  className="clip-part-player"
                />
                <div className="clip-part-status" role="status" aria-live="polite">
                  {part.status === 'error' ? (
                    <>
                      <span>{part.error}</span>
                      <button type="button" className="btn ghost clip-part-retry" onClick={part.retry}>
                        <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Getting this clip’s part of the video… {part.percent}%</span>
                      <span className="clip-part-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(3, part.percent)}%` }} />
                      </span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className={`clip-preview is-large clip-preview-empty${landscape ? ' is-landscape' : ''}`}>
                Loading…
              </div>
            )}
            {media && (
              <div className="clip-stage-controls">
                <button
                  type="button"
                  className="clip-stage-btn"
                  onClick={() => setPlaying((p) => !p)}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
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
                  {muted ? <SpeakerSlash size={18} aria-hidden="true" /> : <SpeakerHigh size={18} aria-hidden="true" />}
                </button>
              </div>
            )}
          </div>
          <span className="clip-time" aria-hidden="true">
            <span ref={timeBar} />
          </span>
        </section>

        <section className="clip-editor-side" aria-label="Clip settings">
          <div className="clip-ws-section">
            <label className="clip-field">
              <span className="clip-ws-label">Title</span>
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
                <summary>
                  <CaretRight size={13} weight="bold" className="clip-why-caret" aria-hidden="true" />
                  <span className="clip-why-label">Why this clip</span>
                  <span className="clip-why-summary-text" dir="auto">
                    {clip.reason || clip.hook}
                  </span>
                </summary>
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

          <div className="clip-ws-section">
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

          <div className="clip-ws-section">
            <h2 className="clip-side-h">Format</h2>
            <div className="clip-ws-row">
              <ClipFormatToggle value={aspect} disabled={saving} onChange={(v) => v && v !== aspect && void save({ aspect: v })} />
              <p className="clip-format-hint">
                {landscape ? 'The whole frame — YouTube, X, LinkedIn.' : 'Cropped around the speaker — Shorts, Reels, TikTok.'}
              </p>
            </div>
            {showLayouts && (
              <div className="clip-ws-framing is-layouts">
                <div className="frame-head">
                  <h3 className="clip-side-sub">Frame layout</h3>
                  <div className="clip-seg frame-type" role="radiogroup" aria-label="Video type">
                    {(['podcast', 'gaming'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={videoType === t}
                        className={`clip-seg-btn${videoType === t ? ' is-on' : ''}`}
                        onClick={() => setTypeChoice(t)}
                      >
                        {t === 'podcast' ? 'Podcast' : 'Gaming'}
                      </button>
                    ))}
                  </div>
                </div>
                <FrameLayoutPicker
                  videoType={videoType}
                  active={activeLayout}
                  framing={layout}
                  frame={sourceFrame}
                  srcW={srcW}
                  srcH={srcH}
                  disabled={saving}
                  onPick={pickLayout}
                />
                {!layout && videoType === 'podcast' && (
                  <ReframeControl
                    mode={clip.crop.mode}
                    x={clip.crop.x}
                    busy={saving}
                    status={reframeStatus}
                    onMode={setMode}
                    onX={(x) => void save({ crop: { mode: 'manual', x } })}
                  />
                )}
                {layout ? (
                  <details className="framing-disclosure" open={adjustOpen} onToggle={(e) => setAdjustOpen(e.currentTarget.open)}>
                    <summary>
                      <CaretRight size={13} weight="bold" className="clip-why-caret" aria-hidden="true" />
                      Adjust framing
                    </summary>
                    <FramingEditor
                      framing={layout}
                      srcW={srcW}
                      srcH={srcH}
                      frame={sourceFrame}
                      videoRef={stageVideo}
                      captionY={captionY}
                      disabled={saving}
                      onDraft={setDraft}
                      onCommit={commitFraming}
                      onReset={resetFraming}
                    />
                  </details>
                ) : videoType === 'podcast' ? (
                  <button type="button" className="framing-btn framing-start" disabled={saving} onClick={startSingleBox}>
                    Adjust framing
                  </button>
                ) : (
                  <p className="framing-note">Pick a layout to place the gameplay and the facecam.</p>
                )}
                {layout?.layout === 'single' && (
                  <button
                    type="button"
                    className="framing-link"
                    disabled={saving}
                    onClick={() => void save({ framing: null, crop: { mode: 'auto', track: [] } })}
                  >
                    Follow the speaker automatically instead
                  </button>
                )}
                {clips.length > 1 && (
                  <div className="framing-apply">
                    {applyAsk ? (
                      <>
                        <span>Use this framing for all {clips.length} clips of this video?</span>
                        <button type="button" className="framing-btn is-primary" disabled={applyBusy} onClick={() => void applyFramingToAll()}>
                          {applyBusy ? 'Applying…' : 'Apply to all'}
                        </button>
                        <button type="button" className="framing-btn" disabled={applyBusy} onClick={() => setApplyAsk(false)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="framing-btn" disabled={saving || !!draft} onClick={() => setApplyAsk(true)}>
                        Apply to all clips
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!landscape && !showLayouts && (
              <div className="clip-ws-framing">
                <h3 className="clip-side-sub">Framing</h3>
                <ReframeControl
                  mode={clip.crop.mode}
                  x={clip.crop.x}
                  busy={saving}
                  status={reframeStatus}
                  onMode={setMode}
                  onX={(x) => void save({ crop: { mode: 'manual', x } })}
                />
              </div>
            )}
          </div>

          <div className="clip-ws-section">
            <div className="clip-side-row">
              <h2 className="clip-side-h">Caption style</h2>
              <span className="clip-style-actions">
                <button type="button" className="clip-customize" onClick={() => openEditor.open(projectId, clip)}>
                  <PencilLine size={14} weight="bold" aria-hidden="true" />
                  Customize in editor
                </button>
                <button type="button" className="clip-browse-btn" onClick={() => setBrowsing(true)} aria-haspopup="dialog">
                  <SquaresFour size={15} aria-hidden="true" />
                  Browse all styles
                </button>
              </span>
            </div>
            <ClipTemplatePicker
              key={clip._id}
              templateKey={clip.templateKey}
              custom={!!clip.style}
              disabled={saving}
              max={6}
              onPick={(templateKey) => void save({ templateKey })}
            />
          </div>

          {(source.local || imported) && (
            <div className={`clip-render-dock${rendering ? ' is-rendering' : ''}`}>
              <div className="clip-render-row">
                <label className="clip-field clip-field-inline">
                  <span className="clip-ws-label">Quality</span>
                  <PremiumSelect
                    ariaLabel="Render quality"
                    value={quality}
                    onChange={(value) => setQuality(value as ExportQuality)}
                    disabled={rendering}
                    options={allowedQualities.map((q) => ({ value: q, label: q }))}
                  />
                </label>
                <span className="clip-render-buttons">
                  {rendered && !rendering && (
                    <button type="button" className="btn ghost" onClick={() => void download()}>
                      <DownloadSimple size={17} aria-hidden="true" />
                      Download MP4
                    </button>
                  )}
                  {rendering ? (
                    <button type="button" className="btn ghost" onClick={() => cancelRender(clip._id)}>
                      <X size={16} weight="bold" aria-hidden="true" />
                      Cancel {Math.round(render?.percent ?? 0)}%
                    </button>
                  ) : (
                    <button type="button" className="btn primary" disabled={!projectStyle} onClick={() => void startRender()}>
                      {rendered ? <ArrowClockwise size={17} weight="bold" aria-hidden="true" /> : <FilmSlate size={17} aria-hidden="true" />}
                      {rendered ? 'Render again' : 'Render clip'}
                    </button>
                  )}
                </span>
              </div>
              {rendering && (
                <div
                  className="clip-render-progress"
                  role="progressbar"
                  aria-label="Render progress"
                  aria-valuenow={Math.round(render?.percent ?? 0)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${Math.max(2, render?.percent ?? 0)}%` }} />
                </div>
              )}
              {rendering && render?.detail && <p className="clip-render-detail">{render.detail}</p>}
              {render?.status === 'error' && (
                <p className="clip-card-error" role="alert">
                  {render.error}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <ClipStyleBrowser
        open={browsing}
        templateKey={clip.templateKey}
        custom={!!clip.style}
        disabled={saving}
        onPick={(templateKey) => {
          setBrowsing(false);
          void save({ templateKey });
        }}
        onClose={() => setBrowsing(false)}
      />
      {openEditor.dialog}
    </div>
  );
}
