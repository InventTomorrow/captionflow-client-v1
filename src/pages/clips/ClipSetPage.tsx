/**
 * /clips/:projectId — one video's clips. While the video is transcribing or
 * the AI is reading it, a stepper shows where it is (live over the socket);
 * then the clips, best first, each with the AI's reason. Also the entry point
 * for "Find clips" on an existing captioned video, re-runs and Render all.
 * Clips are a preview of what this device can play: a video that can't play
 * here shows no clips (and never asks for a file). "Style all clips"
 * puts one caption template on every clip (and on later runs); Select picks
 * some clips for one template, a render or a delete.
 */
import { Captions, ListChecks, Palette } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipBulkBar } from '../../components/clips/ClipBulkBar';
import { ClipGrid } from '../../components/clips/ClipGrid';
import { ClipStyleSheet } from '../../components/clips/ClipStyleSheet';
import { useOpenInEditor } from '../../lib/clips/useOpenInEditor';
import { captionLanguageLabel } from '../../lib/languageLabel';
import { templateByKey } from '../../lib/templateCatalog';
import { ClipOptionsForm } from '../../components/clips/ClipOptionsForm';
import { clipOptionsFrom, LENGTH_PRESETS, type LengthPresetId } from '../../lib/clips/clipOptions';
import { ClipProcessing } from '../../components/clips/ClipProcessing';
import { UpgradeBanner } from '../../components/UpgradeBanner';
import { errorMessage } from '../../lib/api';
import { analyzeClips, type Clip, type ClipLookPatch } from '../../lib/clips/api';
import { ensureFaceTrack, needsFaceTrack } from '../../lib/clips/autoFrame';
import { useClipSource, useProjectStyle } from '../../lib/clips/useClipMedia';
import { downloadLocalFile, exportFileName } from '../../lib/export/clientExport';
import { latestExportForClip } from '../../lib/media/localMedia';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../../lib/planErrors';
import { getSocket, joinProjectRoom, leaveProjectRoom } from '../../lib/socket';
import { useClipsStore } from '../../stores/clipsStore';

const BUSY_PROJECT = ['uploading', 'uploaded', 'processing', 'transcribing', 'translating'];

export function ClipSetPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const data = useClipsStore((s) => s.byProject[projectId]);
  const live = useClipsStore((s) => s.live[projectId]);
  const renders = useClipsStore((s) => s.renders);
  const loadProject = useClipsStore((s) => s.loadProject);
  const removeClip = useClipsStore((s) => s.removeClip);
  const enqueueRenders = useClipsStore((s) => s.enqueueRenders);
  const styleClips = useClipsStore((s) => s.styleClips);
  const styleAllClips = useClipsStore((s) => s.styleAllClips);
  const removeClips = useClipsStore((s) => s.removeClips);
  const [error, setError] = useState('');
  /** Selection mode: the picked clip ids; null = not selecting. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [sheet, setSheet] = useState<'all' | 'selected' | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [stage, setStage] = useState<{ percent?: number; message?: string }>({});
  const [showOptions, setShowOptions] = useState(false);
  const [preset, setPreset] = useState<LengthPresetId>('standard');
  const [maxClips, setMaxClips] = useState(8);
  const [starting, setStarting] = useState(false);
  const openEditor = useOpenInEditor();

  const project = data?.project;
  const source = useClipSource(projectId, project?.video?.kind);
  const projectStyle = useProjectStyle(projectId);

  useEffect(() => {
    if (!projectId) return;
    void loadProject(projectId).catch((e) => setError(errorMessage(e, 'Couldn’t load this video')));
  }, [projectId, loadProject]);

  // Transcription progress comes over the project room, not the user room.
  useEffect(() => {
    if (!projectId) return;
    joinProjectRoom(projectId);
    const socket = getSocket();
    const onStage = (e: { percent?: number; message?: string }) => setStage(e);
    const reload = () => void loadProject(projectId).catch(() => undefined);
    socket.on('stage:update', onStage);
    socket.on('captions:complete', reload);
    socket.on('project:error', reload);
    return () => {
      socket.off('stage:update', onStage);
      socket.off('captions:complete', reload);
      socket.off('project:error', reload);
      leaveProjectRoom(projectId);
    };
  }, [projectId, loadProject]);

  // Seed the options panel from the last run.
  useEffect(() => {
    const o = data?.status.options;
    if (!o) return;
    const p = LENGTH_PRESETS.find((x) => x.minSec === o.minSec && x.maxSec === o.maxSec);
    if (p) setPreset(p.id);
    if (o.maxClips) setMaxClips(o.maxClips);
  }, [data?.status.options]);

  const runStatus = live?.status ?? data?.status.status ?? 'idle';
  const projectBusy = !!project && BUSY_PROJECT.includes(project.status);
  const working = projectBusy || runStatus === 'queued' || runStatus === 'analyzing';
  const clips = useMemo(() => data?.clips ?? [], [data?.clips]);
  const canAnalyze = !!project && !projectBusy && project.status !== 'error' && (data?.sentences.length ?? 0) > 0;
  const tooShort = (project?.video?.duration ?? 0) > 0 && (project?.video?.duration ?? 0) < 60;

  async function findClips() {
    setStarting(true);
    setError('');
    setPlanError(null);
    try {
      await analyzeClips(projectId, clipOptionsFrom(preset, maxClips));
      setShowOptions(false);
      useClipsStore.setState((s) => ({ live: { ...s.live, [projectId]: { status: 'queued', percent: 0 } } }));
      await loadProject(projectId);
    } catch (err) {
      const payload = (err as { response?: { data?: ApiErrorPayload } }).response?.data;
      const plan = resolvePlanError(payload);
      if (plan) setPlanError(plan);
      else setError(errorMessage(err, 'Couldn’t start finding clips'));
    } finally {
      setStarting(false);
    }
  }

  function renderJobs(list: Clip[]) {
    if (!project || !projectStyle) return;
    enqueueRenders(
      list.map((clip) => ({
        clip,
        ctx: { projectId, projectName: project.name, projectStyle },
        opts: { quality: '1080p' as const, format: 'mp4' as const },
      })),
    );
  }

  async function download(clip: Clip) {
    const rec = await latestExportForClip(projectId, clip._id);
    if (rec) await downloadLocalFile(rec.opfsPath, exportFileName(clip.title || project?.name || 'clip', rec.quality, rec.format));
    else setError('That render isn’t available here — render it again.');
  }

  async function remove(clip: Clip) {
    if (!window.confirm(`Delete “${clip.title || 'this clip'}”?`)) return;
    await removeClip(clip._id).catch((e) => setError(errorMessage(e, 'Couldn’t delete the clip')));
  }

  // Frame every Auto clip on the speaker as soon as clips arrive (on this device, one at a time).
  const setClipLocal = useClipsStore((s) => s.setClipLocal);
  useEffect(() => {
    if (!source.local) return;
    for (const c of clips) {
      if (needsFaceTrack(c)) void ensureFaceTrack(projectId, c).then((u) => u && setClipLocal(u)).catch(() => undefined);
    }
  }, [clips, source.local, projectId, setClipLocal]);

  const unrendered = clips.filter((c) => c.status !== 'rendered' && renders[c._id]?.status !== 'done');

  // Selection only holds clips that still exist.
  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return cur;
      const live = new Set(clips.map((c) => c._id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [clips]);

  const status = data?.status;
  const defaultLook = status?.style
    ? 'Custom look'
    : (templateByKey(status?.templateKey)?.name ?? 'Video’s style');
  const defaultFormat = status?.aspect === '16:9' ? '16:9' : '9:16';
  const captionLanguage = project
    ? captionLanguageLabel(project.sourceLanguage, project.detectedLanguage, project.outputLanguage)
    : undefined;

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applySheet(look: ClipLookPatch) {
    setSheetBusy(true);
    setSheetError('');
    try {
      if (sheet === 'all') await styleAllClips(projectId, look);
      else if (selected?.size) await styleClips([...selected], look);
      setSheet(null);
    } catch (err) {
      setSheetError(errorMessage(err, 'Couldn’t apply that style'));
    } finally {
      setSheetBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected?.size) return;
    if (!window.confirm(`Delete ${selected.size} clip${selected.size === 1 ? '' : 's'}?`)) return;
    try {
      await removeClips([...selected]);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t delete those clips'));
    }
  }

  // A video this device can't play: its clips aren't shown here.
  if (project && source.missing) {
    return (
      <div className="clips-page">
        <nav className="clips-crumbs" aria-label="Breadcrumb">
          <Link to="/clips">Clips</Link>
          <span aria-hidden="true">/</span>
          <span>{project.name}</span>
        </nav>
        <header className="clips-head">
          <h1 className="clips-title">{project.name}</h1>
        </header>
        <div className="clips-empty">
          <p>No clips to show.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="clips-page">
      <nav className="clips-crumbs" aria-label="Breadcrumb">
        <Link to="/clips">Clips</Link>
        <span aria-hidden="true">/</span>
        <span>{project?.name ?? '…'}</span>
      </nav>
      <header className="clips-head">
        <div>
          <h1 className="clips-title">{project?.name ?? 'Loading…'}</h1>
          {runStatus === 'ready' && (
            <p className="clips-sub">
              {clips.length} clips · best first{clips.length > 0 && ` · ${defaultFormat} · ${defaultLook}`}
            </p>
          )}
          {project && !projectBusy && (
            <p className="clips-sub clips-lang">Captions: {captionLanguage ?? 'as spoken'}</p>
          )}
        </div>
        <div className="clips-head-actions">
          {project && (
            <Link to={`/projects/${projectId}/editor`} className="btn ghost clips-head-btn">
              <Captions size={16} aria-hidden="true" />
              Full video in editor
            </Link>
          )}
          {clips.length > 0 && !working && (
            <button type="button" className="btn ghost clips-head-btn" onClick={() => setSheet('all')}>
              <Palette size={16} aria-hidden="true" />
              Style &amp; format all
            </button>
          )}
          {clips.length > 0 && !selected && (
            <button type="button" className="btn ghost clips-head-btn" onClick={() => setSelected(new Set())}>
              <ListChecks size={16} aria-hidden="true" />
              Select
            </button>
          )}
          {canAnalyze && !working && (
            <button type="button" className="btn ghost" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions}>
              {clips.length || runStatus === 'ready' ? 'Find more / re-run' : 'Find clips'}
            </button>
          )}
          {unrendered.length > 0 && source.local && (
            <button type="button" className="btn primary" onClick={() => renderJobs(unrendered)} disabled={!projectStyle}>
              Render all ({unrendered.length})
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {planError && <UpgradeBanner info={planError} />}

      {(showOptions || (canAnalyze && runStatus === 'idle' && !clips.length)) && (
        <section className="clips-panel clips-options-panel" aria-label="Find clips">
          {tooShort ? (
            <p>Clips need a video of at least one minute.</p>
          ) : (
            <>
              <ClipOptionsForm preset={preset} maxClips={maxClips} disabled={starting} onPreset={setPreset} onMaxClips={setMaxClips} />
              <p className="clips-sub">Uses one clip run from your plan. Your existing edits and renders are kept.</p>
              <button type="button" className="btn primary clips-cta" disabled={starting} onClick={() => void findClips()}>
                {starting ? 'Starting…' : 'Find clips'}
              </button>
            </>
          )}
        </section>
      )}

      {project && (working || runStatus === 'error' || project.status === 'error') && (
        <section className="clips-panel">
          <ClipProcessing
            projectStatus={project.status}
            stagePercent={stage.percent}
            stageMessage={stage.message}
            runStatus={runStatus}
            runPercent={live?.percent}
            runMessage={live?.message}
          />
          {(runStatus === 'error' || project.status === 'error') && (
            <p className="clip-card-error" role="alert">
              {live?.message || data?.status.error || 'Something went wrong. You can try again.'}
            </p>
          )}
        </section>
      )}

      {runStatus === 'ready' && clips.length === 0 && !working && (
        <div className="clips-empty">
          <p>No strong moments found in this video.</p>
          <p className="clips-sub">Try a different clip length, or a video with more talking.</p>
        </div>
      )}

      {selected && (
        <ClipBulkBar
          total={clips.length}
          selectedCount={selected.size}
          onToggleAll={() => setSelected(selected.size === clips.length ? new Set() : new Set(clips.map((c) => c._id)))}
          onStyle={() => setSheet('selected')}
          onRender={
            source.local && projectStyle ? () => renderJobs(clips.filter((c) => selected.has(c._id))) : undefined
          }
          onDelete={() => void deleteSelected()}
          onDone={() => setSelected(null)}
        />
      )}

      {clips.length > 0 && project && (
        <ClipGrid
          clips={clips}
          project={project}
          showReason
          renders={renders}
          selected={selected ?? undefined}
          onToggleSelect={(c) => toggleSelect(c._id)}
          onOpen={(c) => navigate(`/clips/${projectId}/${c._id}`)}
          onEditCaptions={(c) => openEditor.open(projectId, c)}
          onRender={source.local ? (c) => renderJobs([c]) : undefined}
          onDownload={(c) => void download(c)}
          onDelete={(c) => void remove(c)}
        />
      )}

      {sheet && (
        <ClipStyleSheet
          title={sheet === 'all' ? 'Style & format all clips' : `Style & format ${selected?.size ?? 0} clip${selected?.size === 1 ? '' : 's'}`}
          note={
            sheet === 'all'
              ? `Every clip of this video gets what you pick, and so will the clips later runs find (now: ${defaultFormat}, ${defaultLook}). You can still change one clip on its own page.`
              : 'The selected clips get what you pick. You can still change one clip on its own page.'
          }
          count={sheet === 'all' ? clips.length : (selected?.size ?? 0)}
          busy={sheetBusy}
          error={sheetError}
          onApply={(look) => void applySheet(look)}
          onClose={() => {
            setSheet(null);
            setSheetError('');
          }}
        />
      )}
      {openEditor.dialog}
    </div>
  );
}
