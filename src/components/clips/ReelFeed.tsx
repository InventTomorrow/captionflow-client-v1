/**
 * ReelFeed — a video's clips as a vertical reels feed: one clip per screen,
 * snapping as you swipe or scroll, the one in view playing on loop straight
 * from the original on this device (ClipPreview: live crop + captions), so a
 * long video reads as a stack of short reels while nothing is cut. Only the
 * active reel and the next mount a player; the rest show posters.
 *
 * Beside (or under, on a phone) each reel: its title, hook, where it sits in
 * the long video, and the same actions as the grid (select, edit, open in the
 * editor, render / download, delete).
 */
import {
  CaretDown,
  CaretUp,
  Check,
  ClosedCaptioning,
  DownloadSimple,
  FilmSlate,
  FilmStrip,
  Pause,
  PencilSimpleLine,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Clip } from '../../lib/clips/api';
import { localClipMedia } from '../../lib/clips/clipMedia';
import { clipAspect, clipStyle, cropTrackFor, deferredIn, formatClipLength, scoreTone } from '../../lib/clips/clipMath';
import { linkPosters } from '../../lib/clips/linkSource';
import { loadProjectAssets, type ProjectAssets } from '../../lib/clips/projectAssets';
import { feedHeightFor, formatSourceTime, reelMountSet, sourceSpan, stepReel } from '../../lib/clips/reelFeed';
import { projectCaptions } from '../../lib/clips/renderClip';
import { getClipThumb } from '../../lib/clips/thumbs';
import type { RenderState } from '../../stores/clipsStore';
import { ClipPreview } from './ClipPreview';
import './reelFeed.css';

interface ReelFeedProps {
  clips: Clip[];
  project: { _id: string; name?: string; sourceUrl?: string; video?: { kind?: string; duration?: number } };
  renders: Record<string, RenderState | undefined>;
  /** Selection mode: the ids picked so far (undefined = not selecting). */
  selected?: ReadonlySet<string>;
  onToggleSelect(clip: Clip): void;
  onOpen(clip: Clip): void;
  onEditCaptions?(clip: Clip): void;
  onRender?(clip: Clip): void;
  onDownload(clip: Clip): void;
  onDelete(clip: Clip): void;
}

/** A linked video's clip part on this device: object URL + the source time at its 0:00 (null = none here). */
type Part = { url: string; offset: number } | null;


const partKey = (c: Clip) => `${c._id}:${c.start}:${c.end}`;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ReelFeed({
  clips,
  project,
  renders,
  selected,
  onToggleSelect,
  onOpen,
  onEditCaptions,
  onRender,
  onDownload,
  onDelete,
}: ReelFeedProps) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const reelRefs = useRef<Array<HTMLElement | null>>([]);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [assets, setAssets] = useState<ProjectAssets | undefined>();
  const [feedHeight, setFeedHeight] = useState<number | undefined>();
  const [parts, setParts] = useState<Record<string, Part | undefined>>({});
  const partUrls = useRef<string[]>([]);
  const partsAsked = useRef(new Set<string>());
  const captionsFor = useRef<string>('');

  const projectId = project._id;
  const link = project.sourceUrl;
  const duration = project.video?.duration ?? 0;
  const count = clips.length;
  const hasClips = count > 0;
  const activeIdx = Math.min(active, Math.max(0, count - 1));
  const mounted = useMemo(() => new Set(reelMountSet(activeIdx, count)), [activeIdx, count]);
  const activeClip = clips[activeIdx];
  /** Changes whenever the reels are different nodes (a re-run can return as many clips as before). */
  const idsKey = clips.map((c) => c._id).join(',');

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const urls = partUrls.current; // the same array the lookups push into
    return () => {
      alive.current = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // The original (or the server stream), the captions and the video's style — once per project.
  useEffect(() => {
    let cancelled = false;
    void loadProjectAssets(projectId, project.video?.kind)
      .then((a) => !cancelled && setAssets(a))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, project.video?.kind]);

  // A trimmed clip may reach captions the clip run didn't finish yet (translation / hero words).
  useEffect(() => {
    if (!assets || !activeClip || !deferredIn(assets.captions, [activeClip])) return;
    const key = partKey(activeClip);
    if (captionsFor.current === key) return;
    captionsFor.current = key;
    void projectCaptions(projectId, [activeClip])
      .then((captions) => setAssets((a) => (a ? { ...a, captions } : a)))
      .catch(() => undefined);
  }, [assets, activeClip, projectId]);

  // A linked video plays a clip from its own part, when this device already has it.
  useEffect(() => {
    if (!link) return;
    for (const i of mounted) {
      const clip = clips[i];
      const key = clip && partKey(clip);
      if (!clip || partsAsked.current.has(key)) continue;
      partsAsked.current.add(key);
      void localClipMedia(projectId, clip)
        .then((m) => {
          // Left the feed (e.g. switched to Grid) before the part was found: make no URL nobody will revoke.
          if (!alive.current) return;
          const url = m ? URL.createObjectURL(m.file) : null;
          if (url) partUrls.current.push(url);
          setParts((s) => ({ ...s, [key]: url && m ? { url, offset: m.offset } : null }));
        })
        .catch(() => setParts((s) => ({ ...s, [key]: null })));
    }
  }, [link, mounted, clips, projectId]);

  // Size the feed to the screen left under the header, so a whole reel and its details are in view.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const fit = () =>
      setFeedHeight(
        feedHeightFor({
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          top: el.getBoundingClientRect().top + window.scrollY,
          // The sticky app bar stays on screen above the feed.
          barH: document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0,
        }),
      );
    fit();
    // The page container, not <body>: body is fixed at the screen's height, so it never resizes when
    // the header above the feed grows (its stats arrive after the clips) — the page container does.
    const ro = new ResizeObserver(fit);
    ro.observe(el.closest('.clips-page') ?? el.parentElement ?? document.body);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [hasClips]);

  // The reel mostly in view is the active one.
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number((e.target as HTMLElement).dataset.index ?? 0));
        }
      },
      { root, threshold: [0.6] },
    );
    reelRefs.current.slice(0, count).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
    // idsKey: new clips are new <section> nodes, which must be observed instead of the old ones.
  }, [count, idsKey]);

  // A new reel starts playing.
  useEffect(() => setPaused(false), [activeIdx]);

  /** The playing reel's <video> (the active reel's ClipPreview). */
  const activeVideo = () => reelRefs.current[activeIdx]?.querySelector('video') ?? null;

  // Play and unmute act on the video inside the tap / key press itself: iPhones allow sound
  // (and play after a refusal) only from a gesture, not from an effect a render later.
  function togglePlay() {
    const v = activeVideo();
    if (paused) {
      if (v) void v.play().catch(() => undefined);
      setPaused(false);
    } else {
      v?.pause();
      setPaused(true);
    }
  }

  function toggleMute() {
    const next = !muted;
    const v = activeVideo();
    if (v) {
      v.muted = next;
      if (!next && !paused && v.paused) void v.play().catch(() => undefined);
    }
    setMuted(next);
  }

  /** The browser refused to play the active reel (iPhone: sound on a video nobody tapped). */
  const onPlayBlocked = useCallback((outcome: 'retry-muted' | 'paused') => {
    if (outcome === 'retry-muted') setMuted(true);
    else setPaused(true);
  }, []);

  // Scroll the feed only — scrollIntoView would also move the page (and tuck the reel under the sticky header).
  const goTo = useCallback((i: number) => {
    const feed = feedRef.current;
    const el = reelRefs.current[i];
    if (feed && el) feed.scrollTo({ top: el.offsetTop, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const own = e.target === e.currentTarget;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || (own && e.key === 'j')) {
      e.preventDefault();
      goTo(stepReel(activeIdx, 1, count));
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (own && e.key === 'k')) {
      e.preventDefault();
      goTo(stepReel(activeIdx, -1, count));
    } else if (own && e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (own && e.key === 'm') {
      toggleMute();
    }
  }

  const onTime = useCallback((t: number, len: number) => {
    const bar = progressRef.current;
    if (bar) bar.style.transform = `scaleX(${len > 0 ? Math.min(1, t / len) : 0})`;
  }, []);

  if (!count) return null;

  return (
    <div className="reel-shell">
      <div
        className="reel-feed"
        ref={feedRef}
        style={feedHeight ? { height: Math.min(feedHeight, 680) } : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="region"
        aria-roledescription="clip feed"
        aria-label={`${count} clips — use the arrow keys to move, space to pause, M to unmute`}
      >
        {clips.map((clip, i) => {
          const isActive = i === activeIdx;
          const part = link ? parts[partKey(clip)] : undefined;
          const src = link ? part?.url : assets?.url;
          const landscape = clipAspect(clip) === '16:9';
          const render = renders[clip._id];
          const rendering = render?.status === 'rendering' || render?.status === 'queued';
          const rendered = clip.status === 'rendered' || render?.status === 'done';
          const name = clip.title || 'Untitled clip';
          const span = sourceSpan(clip.start, clip.end, duration);
          const picked = selected?.has(clip._id) ?? false;
          return (
            <section
              key={clip._id}
              ref={(el) => {
                reelRefs.current[i] = el;
              }}
              data-index={i}
              className={`reel${landscape ? ' is-landscape' : ''}${isActive ? ' is-active' : ''}`}
              aria-label={`Clip ${i + 1} of ${count}: ${name}`}
            >
              <div className={`reel-stage${landscape ? ' is-landscape' : ''}`}>
                {mounted.has(i) && src && assets ? (
                  <ClipPreview
                    src={src}
                    credentials={!link && assets.credentials}
                    start={clip.start}
                    end={clip.end}
                    offset={part?.offset ?? 0}
                    captions={assets.captions}
                    style={clipStyle(assets.style, clip)}
                    track={cropTrackFor(clip)}
                    aspect={clipAspect(clip)}
                    playing={isActive && !paused}
                    muted={muted || !isActive}
                    className="reel-video"
                    onTime={isActive ? (t) => onTime(t, clip.end - clip.start) : undefined}
                    onPlayBlocked={isActive ? onPlayBlocked : undefined}
                  />
                ) : (
                  <ReelPoster clip={clip} projectId={projectId} videoKind={project.video?.kind} near={Math.abs(i - activeIdx) <= 2} fallbacks={linkPosters(link)} />
                )}
                {link && part === null && mounted.has(i) ? (
                  <button type="button" className="reel-open-link" onClick={() => onOpen(clip)}>
                    <Play size={18} weight="fill" aria-hidden="true" />
                    Open to play this clip
                  </button>
                ) : (
                  <button
                    type="button"
                    className="reel-tap"
                    onClick={() => (isActive ? togglePlay() : goTo(i))}
                    aria-label={isActive ? (paused ? 'Play' : 'Pause') : `Play ${name}`}
                  />
                )}
                {isActive && paused && (
                  <span className="reel-paused" aria-hidden="true">
                    <Play size={34} weight="fill" />
                  </span>
                )}
                <span className={`clip-score clip-score-${scoreTone(clip.score)}`} title="Clip score">
                  Score {clip.score}
                </span>
                <button
                  type="button"
                  className="reel-mute"
                  onClick={toggleMute}
                  aria-label="Mute"
                  aria-pressed={muted}
                >
                  {muted ? <SpeakerSlash size={18} aria-hidden="true" /> : <SpeakerHigh size={18} aria-hidden="true" />}
                </button>
                <span className="reel-progress" aria-hidden="true">
                  {/* Only the playing reel's bar moves; a reel you scroll back to starts from empty. */}
                  <span ref={isActive ? progressRef : undefined} style={isActive ? undefined : { transform: 'scaleX(0)' }} />
                </span>
                {rendering && (
                  <span className="clip-render-bar" role="progressbar" aria-label="Rendering" aria-valuenow={Math.round(render?.percent ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.max(3, render?.percent ?? 0)}%` }} />
                  </span>
                )}
              </div>

              <div className="reel-side">
                <p className="reel-count">
                  Clip {i + 1} of {count}
                </p>
                <h2 className="reel-title" dir="auto">
                  {name}
                </h2>
                {clip.hook && (
                  <p className="reel-hook" dir="auto">
                    “{clip.hook}”
                  </p>
                )}
                {span.width > 0 && (
                  <div className="reel-source">
                    <span className="reel-source-bar" aria-hidden="true">
                      <span style={{ left: `${span.left}%`, width: `${span.width}%` }} />
                    </span>
                    <span className="reel-source-text">
                      {formatClipLength(clip.end - clip.start)} from {formatSourceTime(clip.start)} in the {formatSourceTime(duration)} video
                    </span>
                  </div>
                )}
                {clip.reason && (
                  <details className="clip-why reel-why">
                    <summary>Why this clip</summary>
                    <p dir="auto">{clip.reason}</p>
                  </details>
                )}
                {render?.status === 'error' && (
                  <p className="clip-card-error" role="alert">
                    {render.error}
                  </p>
                )}
                <div className="reel-actions">
                  {rendered && !rendering ? (
                    <button type="button" className="btn primary reel-btn" onClick={() => onDownload(clip)}>
                      <DownloadSimple size={17} aria-hidden="true" />
                      Download MP4
                    </button>
                  ) : (
                    onRender && (
                      <button type="button" className="btn primary reel-btn" onClick={() => onRender(clip)} disabled={rendering}>
                        <FilmSlate size={17} aria-hidden="true" />
                        {rendering ? `Rendering ${Math.round(render?.percent ?? 0)}%` : 'Render clip'}
                      </button>
                    )
                  )}
                  <button type="button" className="btn ghost reel-btn" onClick={() => onOpen(clip)}>
                    <PencilSimpleLine size={17} aria-hidden="true" />
                    <span className="reel-btn-label">Edit clip</span>
                  </button>
                  {onEditCaptions && (
                    <button type="button" className="btn ghost reel-btn" onClick={() => onEditCaptions(clip)}>
                      <ClosedCaptioning size={17} aria-hidden="true" />
                      <span className="reel-btn-label">Open in editor</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn ghost reel-btn reel-select${picked ? ' is-on' : ''}`}
                    onClick={() => onToggleSelect(clip)}
                    aria-pressed={picked}
                  >
                    <Check size={17} weight="bold" aria-hidden="true" />
                    <span className="reel-btn-label">Select</span>
                  </button>
                  <button type="button" className="reel-delete" onClick={() => onDelete(clip)} aria-label={`Delete ${name}`} title="Delete clip">
                    <Trash size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="reel-nav" role="group" aria-label="Move between clips">
        <button type="button" className="reel-nav-btn" onClick={() => goTo(stepReel(activeIdx, -1, count))} disabled={activeIdx === 0} aria-label="Previous clip">
          <CaretUp size={20} weight="bold" aria-hidden="true" />
        </button>
        <span className="reel-nav-pos" aria-live="polite">
          {activeIdx + 1}/{count}
        </span>
        <button type="button" className="reel-nav-btn" onClick={() => goTo(stepReel(activeIdx, 1, count))} disabled={activeIdx >= count - 1} aria-label="Next clip">
          <CaretDown size={20} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="reel-nav-btn" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? <Play size={18} weight="fill" aria-hidden="true" /> : <Pause size={18} weight="fill" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** A reel that isn't mounted (or can't play here): its poster, decoded on this device once it is near. */
function ReelPoster({
  clip,
  projectId,
  videoKind,
  near,
  fallbacks,
}: {
  clip: Clip;
  projectId: string;
  videoKind?: string;
  near: boolean;
  fallbacks?: string[];
}) {
  /** undefined = not tried yet; null = no poster possible on this device. */
  const [thumb, setThumb] = useState<string | null | undefined>(undefined);
  const [fallbackIdx, setFallbackIdx] = useState(0);
  useEffect(() => {
    if (!near || thumb !== undefined) return;
    let cancelled = false;
    void getClipThumb(projectId, clip, videoKind).then((url) => !cancelled && setThumb(url));
    return () => {
      cancelled = true;
    };
  }, [near, thumb, projectId, clip, videoKind]);
  const fallback = fallbacks?.[fallbackIdx];
  if (thumb) return <img src={thumb} alt="" className="reel-poster" />;
  if (thumb === null && fallback) {
    return <img src={fallback} alt="" className="reel-poster" onError={() => setFallbackIdx((i) => i + 1)} />;
  }
  if (thumb === null) {
    return (
      <span className="reel-poster reel-poster-empty" aria-hidden="true">
        <FilmStrip size={28} />
      </span>
    );
  }
  return <span className="reel-poster clip-preview-skeleton" aria-hidden="true" />;
}
