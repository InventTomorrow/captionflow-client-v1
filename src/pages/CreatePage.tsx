import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClosedCaptioning, FileVideo, LinkSimple, Scissors, Sparkle } from '@phosphor-icons/react';
import { VideoUploader } from '../components/creation/VideoUploader';
import { WorkflowStepper } from '../components/creation/WorkflowStepper';
import { ClipInstructionsField } from '../components/creation/ClipInstructionsField';
import { ClipOptionsForm } from '../components/clips/ClipOptionsForm';
import { ClipFormatToggle } from '../components/clips/ClipFormatToggle';
import { ClipTemplatePicker } from '../components/clips/ClipTemplatePicker';
import { HelperInstallModal } from '../components/clips/HelperInstallModal';
import { PremiumSelect } from '../components/PremiumSelect';
import { PageLoader } from '../components/PageLoader';
import { UpgradeBanner } from '../components/UpgradeBanner';
import { ClipsDeviceError, uploadLinkedAudio, uploadProjectMedia, type UploadProgress } from '../lib/uploader';
import { api, errorMessage } from '../lib/api';
import { CAPTION_LANGUAGE_OPTIONS, SPOKEN_LANGUAGE_OPTIONS } from '../lib/languageLabel';
import { clipOptionsFrom, type LengthPresetId } from '../lib/clips/clipOptions';
import type { ClipAspect } from '../lib/clips/clipMath';
import type { VideoType } from '../lib/clips/framing';
import { createClipsFromUrl, findLinkedClips, styleAllClips } from '../lib/clips/api';
import { HelperError, findHelper, helperFetch, helperVideoInfo, youtubeVideoId } from '../lib/helper/helper';
import { buildExportStyle } from '../lib/export/styleSnapshot';
import { templateByKey } from '../lib/templateCatalog';
import { refusedByServer } from '../lib/clips/refused';
import { deleteSource } from '../lib/media/localMedia';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../lib/planErrors';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';
import '../creation.css';

type Workflow = 'captions' | 'clips';
const LAST_WORKFLOW = 'asaan_last_workflow';
const steps: Record<Workflow, string[]> = {
  captions: ['Upload', 'Language', 'Editor', 'Export'],
  clips: ['Upload', 'Language', 'Clip setup', 'Style', 'Review', 'Export'],
};
function savedWorkflow(): Workflow {
  try { return localStorage.getItem(LAST_WORKFLOW) === 'clips' ? 'clips' : 'captions'; }
  catch { return 'captions'; }
}
function parseKeyterms(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 50);
}
function asProgress(percent: number, status: string): UploadProgress {
  return { percent: Math.round(percent), status, uploadedBytes: 0, totalBytes: 0, speedMBps: 0, etaSeconds: 0 };
}

export function CreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedWorkflow = params.get('workflow');
  const flags = useFlagsStore((s) => s.flags);
  const flagsLoaded = useFlagsStore((s) => s.loaded);
  const loadFlags = useFlagsStore((s) => s.load);
  const maxGb = useAuthStore((s) => s.user?.limits?.maxFileSizeGb ?? 1);
  const [workflow, setWorkflow] = useState<Workflow>(() => requestedWorkflow === 'clips' ? 'clips' : requestedWorkflow === 'captions' ? 'captions' : savedWorkflow());
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [outputLanguage, setOutputLanguage] = useState('keep_original');
  const [keyterms, setKeyterms] = useState('');
  const [preset, setPreset] = useState<LengthPresetId>('standard');
  const [maxClips, setMaxClips] = useState(8);
  /** "What kind of clips do you want?" — kept across steps and source changes; sent with the clip options. */
  const [clipInstructions, setClipInstructions] = useState('');
  /** Podcast / Gaming: which framing layouts the clip page offers, and the one new clips start with. */
  const [videoType, setVideoType] = useState<VideoType>('podcast');
  const [aspect, setAspect] = useState<ClipAspect>('9:16');
  const [templateKey, setTemplateKey] = useState('hero-word');
  const [helperModal, setHelperModal] = useState<'missing' | 'outdated' | null>(null);
  const resumeAfterHelper = useRef(false);
  const startRef = useRef<() => void>(() => undefined);
  const abortRef = useRef<AbortController | null>(null);
  const useUrl = workflow === 'clips' && flags.urlImportEnabled && !!url.trim();
  const urlInvalid = useUrl && !/^https?:\/\/\S+/i.test(url.trim());
  const youtubeId = useUrl && !urlInvalid ? youtubeVideoId(url.trim()) : null;

  useEffect(() => { void loadFlags(); }, [loadFlags]);
  useEffect(() => {
    if (requestedWorkflow === 'clips' && flags.clipsEnabled) setWorkflow('clips');
    if (requestedWorkflow === 'captions') setWorkflow('captions');
  }, [requestedWorkflow, flags.clipsEnabled]);
  useEffect(() => {
    if (flagsLoaded && !flags.clipsEnabled && workflow === 'clips') setWorkflow('captions');
  }, [flagsLoaded, flags.clipsEnabled, workflow]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [stage, workflow]);

  const selectWorkflow = useCallback((next: Workflow) => {
    if (busy || next === workflow) return;
    if (next === 'clips' && !flags.clipsEnabled) return;
    setWorkflow(next);
    setError('');
    setPlanError(null);
    setProgress(null);
    // A selected local file is retained. No edit or server project exists yet.
    setStage(file || (next === 'clips' && url.trim()) ? 1 : 0);
    try { localStorage.setItem(LAST_WORKFLOW, next); } catch { /* storage can be unavailable */ }
  }, [busy, file, flags.clipsEnabled, url, workflow]);

  const selectFile = useCallback((next: File | null) => {
    setFile(next);
    if (next) setUrl('');
    setStage(next ? 1 : 0);
    setError('');
    setPlanError(null);
    setProgress(null);
  }, []);

  async function helperAudio(link: string, signal: AbortSignal): Promise<string | null> {
    setProgress(asProgress(1, 'Getting the video ready…'));
    const existing = await findLinkedClips(link).catch(() => null);
    if (existing) { navigate(`/clips/${existing}`); return null; }
    const info = await helperVideoInfo(link, signal);
    const size = info.audio.size;
    setProgress(asProgress(5, 'Getting the audio…'));
    const parts = await helperFetch(info.id, info.audio, 0, size - 1, {
      signal,
      onBytes: (got) => setProgress(asProgress(5 + (got / size) * 65, 'Getting the audio…')),
    });
    return uploadLinkedAudio(new Blob(parts as BlobPart[], { type: 'audio/mp4' }), info, link,
      (p) => setProgress({ ...p, percent: Math.round(70 + p.percent * .3) }), signal);
  }

  async function start() {
    if (busy || (!file && !useUrl) || urlInvalid) return;
    const link = url.trim();
    if (workflow === 'clips' && youtubeId) {
      const helper = await findHelper();
      if (!helper?.ready || helper.outdated) {
        resumeAfterHelper.current = true;
        setHelperModal(helper?.outdated ? 'outdated' : 'missing');
        return;
      }
    }
    setBusy(true);
    setError('');
    setPlanError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    let created: string | undefined;
    try {
      if (workflow === 'clips' && useUrl && !youtubeId) {
        const { projectId } = await createClipsFromUrl({
          url: link, sourceLanguage, outputLanguage, keyterms: parseKeyterms(keyterms),
          clipOptions: clipOptionsFrom(preset, maxClips, clipInstructions), templateKey, aspect,
          ...(flags.framingEnabled ? { videoType } : {}),
        });
        navigate(`/clips/${projectId}`);
        return;
      }
      await useFlagsStore.getState().load();
      const currentFlags = useFlagsStore.getState().flags;
      const projectId = workflow === 'clips' && youtubeId
        ? await helperAudio(link, abort.signal)
        : (await uploadProjectMedia(file!, setProgress, abort.signal, {
            audioOnlyEnabled: currentFlags.audioOnlyUploadEnabled,
            requireAudioOnly: workflow === 'clips',
          })).projectId;
      if (!projectId) return;
      created = projectId;
      if (workflow === 'clips') {
        const card = templateByKey(templateKey);
        if (card) await api.patch(`/projects/${projectId}/style`,
          buildExportStyle({ ...card.preset, templateKey: card.key }, { defaultAspect: '9:16' })).catch(() => undefined);
        if (aspect !== '9:16') await styleAllClips(projectId, { aspect }).catch(() => undefined);
      }
      await api.post(`/projects/${projectId}/transcribe`, {
        ...(workflow === 'clips'
          ? { purpose: 'clips', clipOptions: clipOptionsFrom(preset, maxClips, clipInstructions), ...(currentFlags.framingEnabled ? { videoType } : {}) }
          : {}),
        sourceLanguage, outputLanguage, keyterms: parseKeyterms(keyterms),
      });
      created = undefined;
      navigate(workflow === 'clips' ? `/clips/${projectId}` : `/projects/${projectId}/editor`);
    } catch (err) {
      if (created && workflow === 'clips' && refusedByServer(err)) {
        const id = created;
        void api.delete(`/projects/${id}`).catch(() => undefined);
        void deleteSource(id).catch(() => undefined);
      }
      const data = (err as { response?: { data?: ApiErrorPayload } }).response?.data;
      const plan = resolvePlanError(data);
      if (plan) setPlanError(plan);
      else if (err instanceof ClipsDeviceError) setError(err.message);
      else if (err instanceof HelperError) {
        setError(err.message);
        if (err.code === 'missing') setHelperModal('missing');
      } else if ((err as { name?: string }).name !== 'AbortError' && (err as { name?: string }).name !== 'CanceledError') {
        setError(errorMessage(err, 'Could not create this project. Please try again.'));
      }
      setProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }
  useEffect(() => { startRef.current = () => void start(); });

  if (!flagsLoaded) return <PageLoader inline label="Loading Create" />;
  const sourceReady = useUrl ? !urlInvalid : !!file;
  const stepTitle = stage === 1 ? 'Choose your languages' : stage === 2 ? 'Set up your clips' : 'Choose a caption style';
  const stepDescription = stage === 1 ? 'Tell us how to understand and caption your video.' : stage === 2 ? 'Choose the clip length, number, and format.' : 'Pick a starting look. You can edit each clip later.';
  return <div className={'creation-page' + (stage > 0 ? ' is-setup' : '')}>
    <div className="creation-container">
      <header className={'creation-header' + (stage > 0 ? ' is-compact' : '')}>
        <span className="creation-kicker">{workflow === 'clips' ? 'CREATE SHORT CLIPS' : 'ADD CAPTIONS'}</span>
        <h1>{stage === 0 ? 'What would you like to create?' : stepTitle}</h1>
        <p>{stage === 0 ? 'Choose how you want to turn your video into content.' : stepDescription}</p>
      </header>
      {stage === 0 && <div className="creation-workflows" role="group" aria-label="Choose a workflow">
        <button type="button" className={'creation-workflow' + (workflow === 'captions' ? ' is-selected' : '')} aria-pressed={workflow === 'captions'} disabled={busy} onClick={() => selectWorkflow('captions')}>
          <ClosedCaptioning size={24} weight={workflow === 'captions' ? 'fill' : 'duotone'} aria-hidden="true" /><span><strong>Add Captions</strong><small>Add accurate, styled subtitles to your video.</small></span>
        </button>
        {flags.clipsEnabled && <button type="button" className={'creation-workflow' + (workflow === 'clips' ? ' is-selected' : '')} aria-pressed={workflow === 'clips'} disabled={busy} onClick={() => selectWorkflow('clips')}>
          <Scissors size={24} weight={workflow === 'clips' ? 'fill' : 'duotone'} aria-hidden="true" /><span><strong>Create Short Clips</strong><small>Find the best moments in long videos and turn them into shorts.</small></span>
        </button>}
      </div>}
      <WorkflowStepper steps={steps[workflow]} current={stage} />
      {stage > 0 && <div className="creation-source-summary">
        <span className="creation-source-symbol">{useUrl ? <LinkSimple size={18} aria-hidden="true" /> : <FileVideo size={18} aria-hidden="true" />}</span>
        <div><strong>{useUrl ? url.trim() : file?.name}</strong><small>{useUrl ? 'Video link' : ((file?.size ?? 0) / 1024 ** 2).toFixed(1) + ' MB · Selected video'}</small></div>
        <button type="button" disabled={busy} onClick={() => setStage(0)}>Change source</button>
        {file && flags.clipsEnabled && <button type="button" disabled={busy} onClick={() => selectWorkflow(workflow === 'clips' ? 'captions' : 'clips')}>Switch to {workflow === 'clips' ? 'Captions' : 'Short Clips'}</button>}
      </div>}
      {planError && <UpgradeBanner info={planError} />}
      {stage === 0 ? <>
        <VideoUploader file={file} onFile={selectFile} maxGb={maxGb} disabled={busy || useUrl} progress={null} error={error} onError={setError} onCancel={() => abortRef.current?.abort()} />
        {workflow === 'clips' && flags.urlImportEnabled && <div className="creation-url">
          <span>or import a link</span>
          <label><LinkSimple size={18} aria-hidden="true" /><input type="url" inputMode="url" value={url} disabled={busy} onChange={(event) => { setUrl(event.target.value); setError(''); }} placeholder="Paste a video URL" aria-label="Video URL" aria-invalid={urlInvalid || undefined} /></label>
          {urlInvalid ? <small role="alert">Enter a full link starting with https://</small> : <small>YouTube, TikTok, Instagram, Vimeo or direct MP4 · Single videos only</small>}
        </div>}
        {workflow === 'clips' && flags.framingEnabled && <div className="creation-video-type">
          <span id="video-type-label">Video type</span>
          <div className="clip-seg" role="radiogroup" aria-labelledby="video-type-label">
            {(['podcast', 'gaming'] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={videoType === t} className={'clip-seg-btn' + (videoType === t ? ' is-on' : '')} disabled={busy} onClick={() => setVideoType(t)}>{t === 'podcast' ? 'Podcast / Interview' : 'Gaming / Streaming'}</button>)}
          </div>
          <small>Sets the framing layouts your clips start with. You can change each clip later.</small>
        </div>}
        {workflow === 'clips' && <ClipInstructionsField value={clipInstructions} disabled={busy} onChange={setClipInstructions} />}
        {sourceReady && <div className="creation-actions"><button type="button" className="btn primary" onClick={() => setStage(1)}>Continue <ArrowRight size={16} weight="bold" aria-hidden="true" /></button></div>}
      </> : busy ? <section className="creation-processing" role="status" aria-live="polite">
        <h2>{workflow === 'clips' ? 'Creating your short clips' : 'Generating your captions'}</h2>
        <p>{progress?.status || 'Preparing your video…'}</p>
        {progress && <><progress value={progress.percent} max={100} aria-label="Upload progress" /><strong>{progress.percent}%</strong></>}
        {!(useUrl && !youtubeId) && <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>Cancel</button>}
      </section> : <>
        {error && <p className="creation-error" role="alert">{error}</p>}
        {stage === 1 && <section className="creation-step-panel" aria-label="Language settings">
          <div className="creation-fields">
            <label><span>Spoken language</span><PremiumSelect value={sourceLanguage} options={SPOKEN_LANGUAGE_OPTIONS} onChange={setSourceLanguage} ariaLabel="Spoken language" /></label>
            <label><span>Caption language</span><PremiumSelect value={outputLanguage} options={CAPTION_LANGUAGE_OPTIONS} onChange={setOutputLanguage} ariaLabel="Caption language" /></label>
          </div>
          <label className="creation-keyterms"><span>Names and special words <small>Optional</small></span><input value={keyterms} onChange={(event) => setKeyterms(event.target.value)} placeholder="e.g. Lahore, Dawood, CaptionFlow" /></label>
        </section>}
        {stage === 2 && workflow === 'clips' && <section className="creation-step-panel" aria-label="Clip setup">
          <ClipOptionsForm preset={preset} maxClips={maxClips} onPreset={setPreset} onMaxClips={setMaxClips} />
          <div className="creation-format"><span>Output format</span><ClipFormatToggle value={aspect} onChange={(value) => value && setAspect(value)} /></div>
        </section>}
        {stage === 3 && workflow === 'clips' && <section className="creation-step-panel creation-style-step" aria-label="Caption style">
          <h2>Starting caption style</h2>
          <ClipTemplatePicker templateKey={templateKey} allowVideoStyle={false} onPick={(key) => key && setTemplateKey(key)} />
        </section>}
        <div className="creation-actions">
          <button type="button" className="btn ghost" onClick={() => setStage((stage - 1) as 0 | 1 | 2)}><ArrowLeft size={16} weight="bold" aria-hidden="true" /> Back</button>
          <button type="button" className="btn primary" disabled={!sourceReady} onClick={() => { if (workflow === 'captions' || stage === 3) void start(); else setStage((stage + 1) as 2 | 3); }}>
            {workflow === 'captions' || stage === 3
              ? <><Sparkle size={16} weight="fill" aria-hidden="true" /> {workflow === 'captions' ? 'Generate Captions' : 'Create Short Clips'}</>
              : <>Continue <ArrowRight size={16} weight="bold" aria-hidden="true" /></>}
          </button>
        </div>
      </>}
    </div>
    {helperModal && <HelperInstallModal reason={helperModal} onConnected={() => { setHelperModal(null); if (resumeAfterHelper.current) { resumeAfterHelper.current = false; startRef.current(); } }} onClose={() => { resumeAfterHelper.current = false; setHelperModal(null); }} />}
  </div>;
}
