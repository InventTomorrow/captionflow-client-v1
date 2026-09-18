import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HexColorPicker } from 'react-colorful';
import { api, API_URL } from '../lib/api';
import { useCaptionStore, type Caption, type WordRole, type WordStyle } from '../stores/captionStore';
import { useEditorChromeStore } from '../stores/editorChromeStore';
import { useFlagsStore } from '../stores/flagsStore';
import { useAuthStore } from '../stores/authStore';
import { PlanBadge } from '../components/AppShell';
import { joinProjectRoom, connectSocket, getSocket } from '../lib/socket';
import { PrepareMediaModal } from '../components/PrepareMediaModal';
import { PricingModal } from '../components/PricingModal';
import { resolvePlanError, type PlanErrorInfo } from '../lib/planErrors';
import { CaptionOverlay, findActiveCaption, type CaptionTemplate } from '../components/CaptionOverlay';
import KineticCaptionLayer from '../components/KineticCaptionLayer';
import {
  isKineticTemplate,
  KINETIC_PARAM_DEFAULTS,
  type KineticParams,
} from '../lib/kinetic/engine';
import {
  deriveDisplayCaptions,
  legacyModeToDisplay,
  type DisplayCaption,
  type DisplayMode,
} from '../lib/displayCaptions';
import {
  matchPositionPreset,
  POSITION_PRESETS,
  resolveCaptionAnchor,
  type CaptionPosition,
} from '../lib/captionPosition';
import { matchTemplateKey, pickerTemplates } from '../lib/templateCatalog';
import { TemplateCard } from '../components/TemplateCard';
import { getAllForProject, replaceAllForProject, upsertOne } from '../lib/captionDb';
import { captionsToSrt } from '../lib/srt';
import {
  evictOldExportsIfNeeded,
  getSourceFile,
  markExportDownloaded,
  storeSourceFile,
} from '../lib/media/localMedia';
import { captionLanguageLabel } from '../lib/languageLabel';
import { probeMediaFile } from '../lib/media/probe';
import { uploadVideoToProject } from '../lib/export/serverUpload';
import {
  authorizeDeviceExport,
  buildDeviceExportJob,
  chooseExportRoute,
  completeDeviceExport,
  describeDeviceProgress,
  DeviceExportError,
  downloadLocalFile,
  exportFileName,
  formatBytes,
  formatSeconds,
  reportDeviceExportFailure,
  saveDeviceExportRecord,
  startDeviceExport,
  type DeviceExportHandle,
  type ExportRoute,
} from '../lib/export/clientExport';

interface StyleState {
  template: CaptionTemplate;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  /** Accent color for hero words, karaoke highlight, marks. */
  highlightColor: string;
  /** Karaoke active-word pill fill (e.g. Viral Orange). Transparent = none. */
  activeFill: string;
  /** Optional whole-caption text transform from Antigravity presets. */
  textTransform: 'none' | 'uppercase' | 'lowercase';
  position: 'top' | 'center' | 'bottom';
  /** Custom vertical position (% from top, caption center). null = use `position` preset. */
  offsetY: number | null;
  /** Custom horizontal position (% from left, caption center). null = centered. */
  offsetX: number | null;
  animation: string;
  /** Preview/export canvas ratio (e.g. 9:16, 16:9). */
  aspectRatio: string;
  /** How captions appear on the video — derived client-side, no API calls. */
  displayMode: DisplayMode;
  /** Words per caption for phrase-based display templates. */
  displayWords: number;
  /** Blockbuster's knobs (glow / letter spacing / tilt / script size); missing = as authored. */
  kinetic?: KineticParams;
  /** Text behind person (kinetic templates): person composited over the captions. */
  behindPerson?: boolean;
  /** Picker card the style started from (lib/templateCatalog.ts); feeds the admin export log. */
  templateKey?: string;
}

/** Server-side state of the project's person matte (Project.masks). */
interface MasksState {
  status: 'none' | 'queued' | 'running' | 'done' | 'failed' | string;
  error?: string;
}

/* Display / Words controls are hidden for now (use Templates instead).
const DISPLAY_TEMPLATES: Array<{
  id: DisplayMode;
  name: string;
  tag?: string;
  desc: string;
  anim?: string;
}> = [
  { id: 'word', name: 'Word-by-Word', desc: 'One word at a time, exactly as it is spoken.' },
  {
    id: 'karaoke',
    name: 'Karaoke',
    tag: 'Popular',
    desc: 'The phrase stays on screen while the spoken word lights up.',
  },
  { id: 'phrase', name: 'Phrase', desc: 'Short groups of words shown together.' },
  { id: 'sentence', name: 'Sentence', desc: 'One full sentence until the next begins.' },
  { id: 'popOn', name: 'Pop-On', desc: 'Each caption pops in with an animation.', anim: 'pop' },
  {
    id: 'rolling',
    name: 'Rolling',
    desc: 'New captions push the previous line upward.',
    anim: 'slideUp',
  },
  { id: 'paintOn', name: 'Paint-On', desc: 'Words are revealed one after another.' },
  {
    id: 'typewriter',
    name: 'Typewriter',
    desc: 'Characters appear one by one, like typing.',
    anim: 'none',
  },
];

const PHRASE_BASED: DisplayMode[] = ['karaoke', 'phrase', 'popOn', 'rolling', 'paintOn', 'typewriter'];
*/

/**
 * Display mode forced by the multi-size ("stacked") templates, or null when
 * the template lets the user pick freely.
 *
 * These templates size each word differently, so karaoke/word modes would
 * flatten them. Hero Word additionally builds its phrase up word by word
 * (paintOn); Neon Glow / Hero Punch / Poetic Stack show the whole block.
 *
 * MUST stay in sync with stackedDisplayMode() in
 * server/src/services/export.service.ts — that pairing is what makes the
 * preview and the burned-in export identical.
 */
function stackedDisplayMode(template?: string): DisplayMode | null {
  if (template === 'heroWord') return 'paintOn';
  if (
    template === 'hero' ||
    template === 'stack' ||
    template === 'mixed' ||
    template === 'mixed2'
  )
    return 'phrase';
  // The kinetic templates lay out a whole caption's letters at once and stagger
  // them internally, so karaoke/word would fight the engine's own timing.
  if (isKineticTemplate(template)) return 'phrase';
  return null;
}

const ASPECT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '9:16', label: '9:16 - Reels / TikTok' },
  { value: '16:9', label: '16:9 - YouTube' },
  { value: '1:1', label: '1:1 - Square' },
  { value: '4:5', label: '4:5 - Instagram' },
  { value: '4:3', label: '4:3 - Classic' },
  { value: '21:9', label: '21:9 - Cinema' },
];

const DEFAULT_ASPECT = '9:16';

/** On-device render attempts before the export shows an error (1 automatic retry). */
const DEVICE_RENDER_ATTEMPTS = 2;

/** Preview canvas ratio — matches export. */
function resolvePreviewAspect(
  aspect: string,
  videoDims: { w: number; h: number } | null,
): number | null {
  const src = videoDims && videoDims.h > 0 ? videoDims.w / videoDims.h : null;
  const raw = aspect && aspect !== 'original' ? aspect : DEFAULT_ASPECT;
  const [w, h] = raw.split(':').map(Number);
  if (w > 0 && h > 0) return w / h;
  return src ?? 9 / 16;
}

/** Prefer server display size when the browser reports a swapped orientation. */
function preferDisplayDims(
  html: { w: number; h: number },
  saved: { w: number; h: number } | null,
): { w: number; h: number } {
  if (!saved || !(saved.w > 0 && saved.h > 0)) return html;
  const htmlPortrait = html.w < html.h;
  const savedPortrait = saved.w < saved.h;
  if (htmlPortrait !== savedPortrait) return saved;
  return html;
}

const FONT_GROUPS: Array<{ label: string; fonts: string[] }> = [
  {
    label: 'Modern Sans',
    fonts: [
      'Montserrat',
      'Poppins',
      'Inter',
      'Roboto',
      'Open Sans',
      'Lato',
      'Raleway',
      'Nunito',
      'Rubik',
      'Kanit',
      'Barlow',
      'Manrope',
      'Work Sans',
      'DM Sans',
      'Outfit',
      'Sora',
      'Exo 2',
      'Josefin Sans',
      'Quicksand',
      'Comfortaa',
      'Fredoka',
      'Baloo 2',
    ],
  },
  {
    label: 'Bold & Impact',
    fonts: [
      'Oswald',
      'Bebas Neue',
      'Anton',
      'Archivo Black',
      'Archivo',
      'Rajdhani',
      'Teko',
      'Staatliches',
      'Fjalla One',
      'Saira Condensed',
      'Barlow Condensed',
      'Russo One',
      'Righteous',
      'Alfa Slab One',
      'Concert One',
      'Secular One',
      'Passion One',
      'Titan One',
      'Bangers',
      'Bungee',
      'Luckiest Guy',
      'Orbitron',
    ],
  },
  {
    label: 'Serif & Elegant',
    fonts: [
      'Playfair Display',
      'Merriweather',
      'Lora',
      'PT Serif',
      'Crimson Text',
      'Cinzel',
      'Cormorant Garamond',
      'Abril Fatface',
    ],
  },
  {
    label: 'Script & Handwriting',
    fonts: [
      'Lobster',
      'Pacifico',
      'Dancing Script',
      'Caveat',
      'Permanent Marker',
      'Shadows Into Light',
      'Amatic SC',
    ],
  },
  {
    label: 'Urdu & Arabic',
    fonts: ['Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Cairo', 'Tajawal', 'Amiri'],
  },
];

type PanelId =
  | 'media'
  | 'text'
  | 'captions'
  | 'templates'
  | 'audio'
  | 'transitions'
  | 'filters'
  | 'settings';

const RAIL_ITEMS: Array<{ id: PanelId; label: string }> = [
  //{ id: 'media', label: 'Media' },
  { id: 'text', label: 'Text' },
  { id: 'templates', label: 'Templates' },
  { id: 'captions', label: 'Captions' },
  //{ id: 'audio', label: 'Audio' },
 // { id: 'transitions', label: 'Transitions' },
 // { id: 'filters', label: 'Filters' },
  //{ id: 'settings', label: 'Settings' },
];

function RailIcon({ id }: { id: PanelId }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'media':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m10 9 5 3-5 3V9Z" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 6h14M12 6v13" />
        </svg>
      );
    case 'captions':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 13h4M7 16h7M13 13h4" />
        </svg>
      );
    case 'templates':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </svg>
      );
    case 'audio':
      return (
        <svg {...common}>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </svg>
      );
    case 'transitions':
      return (
        <svg {...common}>
          <path d="M4 7h9M4 12h6M4 17h9M17 7l3 5-3 5" />
        </svg>
      );
    case 'filters':
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="5" />
          <circle cx="15" cy="14" r="5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
        </svg>
      );
  }
}

/** Swatches for the caption highlight color (Text panel). */
const HIGHLIGHT_SWATCHES = ['#FFC43D', '#8FE649', '#FFFFFF', '#5ED2FF', '#FF5FA2', '#89E900'];

const STAGE_LABELS: Record<string, string> = {
  extracting: 'Extracting Audio',
  splitting: 'Preparing Audio',
  vad: 'Detecting Speech',
  transcribing: 'Transcribing',
  merging: 'Merging Results',
  translating: 'Generating Captions',
  ready: 'Finishing Up',
};

const STAGE_FLAVORS: Record<string, string[]> = {
  extracting: ['Pulling the audio from your video…', 'Warming up the engines…'],
  splitting: ['Slicing audio into chunks…', 'Getting everything ready…'],
  vad: ['Listening for speech…', 'Skipping the silence…'],
  transcribing: [
    'Transcribing every word…',
    'Catching every syllable…',
    'Timing words to the beat…',
  ],
  merging: ['Stitching results together…', 'Cleaning up the transcript…'],
  translating: [
    'Generating captions…',
    'Enhancing styles…',
    'Picking hero & support words…',
    'Polishing the layout…',
  ],
  ready: ['Almost there…'],
};

/** Inline processing state shown on the video stage while the pipeline runs. */
function ProcessingOverlay({
  stage,
}: {
  stage: { current: string; percent: number; message?: string };
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 2200);
    return () => window.clearInterval(t);
  }, []);
  const flavors = STAGE_FLAVORS[stage.current] || ['Working on it…'];
  const flavor = flavors[tick % flavors.length];
  return (
    <div className="processing-overlay">
      <div className="processing-spinner" />
      <div className="processing-title">{STAGE_LABELS[stage.current] || 'Processing'}</div>
      <div className="processing-flavor" key={flavor}>
        {flavor}
      </div>
      <div className="processing-bar">
        <div style={{ width: `${Math.min(100, Math.max(4, stage.percent))}%` }} />
      </div>
      {stage.message && <div className="processing-msg">{stage.message}</div>}
    </div>
  );
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountMenuPos, setAccountMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const rect = accountBtnRef.current?.getBoundingClientRect();
    if (rect) setAccountMenuPos({ left: rect.right + 8, bottom: window.innerHeight - rect.bottom });
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (accountMenuRef.current?.contains(target) || accountBtnRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [accountMenuOpen]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  /** Horizontal scroll container of the timeline. */
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const captions = useCaptionStore((s) => s.captions);
  const setCaptions = useCaptionStore((s) => s.setCaptions);
  const pipelineStage = useCaptionStore((s) => s.stage);
  const setPipelineStage = useCaptionStore((s) => s.setStage);
  const receivePartialChunk = useCaptionStore((s) => s.receivePartialChunk);
  const beginGeneration = useCaptionStore((s) => s.beginGeneration);
  const setComplete = useCaptionStore((s) => s.setComplete);
  /** True while the initial transcription pipeline runs — shows the inline overlay. */
  const [processing, setProcessing] = useState(false);
  const [style, setStyle] = useState<StyleState>({
    template: 'classic',
    fontFamily: 'Montserrat',
    fontSize: 48,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFC43D',
    activeFill: 'transparent',
    textTransform: 'none',
    position: 'center',
    offsetY: POSITION_PRESETS.center.offsetY,
    offsetX: POSITION_PRESETS.center.offsetX,
    animation: 'fade',
    aspectRatio: DEFAULT_ASPECT,
    displayMode: 'karaoke',
    displayWords: 5,
  });
  /**
   * Index of the caption at the playhead, for the phrase-list highlight,
   * auto-scroll and timeline active block. Updated by the rAF loop only when
   * the active caption actually changes (low frequency), so the big page tree
   * never re-renders per frame. The high-frequency caption/word reveal lives
   * inside <CaptionOverlay/>, which runs its own rAF loop.
   */
  const [activeIndex, setActiveIndex] = useState(-1);
  const [duration, setDuration] = useState(0);
  const [projectName, setProjectName] = useState('Project');
  const [outputLanguage, setOutputLanguage] = useState('keep_original');
  /** Spoken language as chosen at upload, and as detected by transcription. */
  const spokenLanguageRef = useRef<{ chosen?: string; detected?: string }>({});
  /** File name of the video just downloaded from the export modal. */
  const [savedAs, setSavedAs] = useState('');
  const [busy, setBusy] = useState('');
  const [rebuildPercent, setRebuildPercent] = useState(0);
  const [error, setError] = useState('');
  const [hasFailedChunks, setHasFailedChunks] = useState(false);
  /** The server still has this video's transcript, so the captions can be
   *  rebuilt from it without transcribing (and paying for) it again. */
  const [canRestoreCaptions, setCanRestoreCaptions] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showHlPicker, setShowHlPicker] = useState(false);
  const [panel, setPanel] = useState<PanelId>('templates');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Word index currently being edited in the selected caption, or null. */
  const [selectedWordIdx, setSelectedWordIdx] = useState<number | null>(null);
  /** Caption whose text is being edited inline in the Phrases list, or null. */
  const [phraseEditingId, setPhraseEditingId] = useState<string | null>(null);
  /** Custom color picker toggle inside the Phrases word tools. */
  const [phrasePickerOpen, setPhrasePickerOpen] = useState(false);
  useEffect(() => setPhrasePickerOpen(false), [selectedId, selectedWordIdx]);
  /** Native display size of the uploaded video (server + loadedmetadata). */
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  /** Last server-stored display size — wins if HTML videoWidth/Height are rotated wrong. */
  const savedVideoDims = useRef<{ w: number; h: number } | null>(null);
  /** Preview canvas size fitted to the stage at the chosen aspect ratio. */
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number } | null>(null);
  /**
   * Object-fit content box inside video-wrap. Captions mount here so type
   * never sizes to pillarbox bars when the outer stage is still wide.
   */
  const [contentBox, setContentBox] = useState<{
    left: number;
    top: number;
    w: number;
    h: number;
  } | null>(null);
  const stageCanvasRef = useRef<HTMLDivElement>(null);
  const captionLayerRef = useRef<HTMLDivElement>(null);
  const [showPrepare, setShowPrepare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  /** Text-behind-person matte status, mirrored from the server via socket. */
  const [masks, setMasks] = useState<MasksState>({ status: 'none' });
  const [masksPercent, setMasksPercent] = useState(0);
  /** Seconds left on the person matte, estimated from observed progress. */
  const [matteEtaSec, setMatteEtaSec] = useState<number | null>(null);
  const matteStartRef = useRef<{ at: number; percent: number } | null>(null);
  const flags = useFlagsStore((s) => s.flags);
  const loadFlags = useFlagsStore((s) => s.load);
  /** Picker cards in the order the admin set (Admin → Templates). */
  const templateLayout = useFlagsStore((s) => s.templateLayout);
  const templateCards = useMemo(() => pickerTemplates(templateLayout), [templateLayout]);
  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);
  const [exportQuality, setExportQuality] = useState<'720p' | '1080p' | '2K' | '4K'>('1080p');
  useEffect(() => {
    if (exportQuality === '4K' && !flags.export4kEnabled) setExportQuality('2K');
  }, [flags.export4kEnabled, exportQuality]);
  const [exportFormat, setExportFormat] = useState<'mp4' | 'webm'>('mp4');
  const [exportFrameRate, setExportFrameRate] = useState<'fast' | 'original'>('fast');
  const [exportStatus, setExportStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [exportPercent, setExportPercent] = useState(0);
  const [exportError, setExportError] = useState('');
  /** Export succeeded, but a requested effect could not be applied. */
  const [exportWarning, setExportWarning] = useState('');
  const [exportPlanError, setExportPlanError] = useState<PlanErrorInfo | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  /** Where the current/last render ran — shown in the modal so it is never a mystery. */
  const [exportWhere, setExportWhere] = useState<'device' | 'server' | null>(null);
  const exportWhereRef = useRef(exportWhere);
  exportWhereRef.current = exportWhere;
  /** Stage + ETA line for an on-device render. */
  const [exportDetail, setExportDetail] = useState('');
  /** The finished on-device render — downloaded from this device's storage, not the server. */
  const [deviceResult, setDeviceResult] = useState<{
    id: string;
    opfsPath: string;
    fileName: string;
    renderMs: number;
    sizeBytes: number;
  } | null>(null);
  const deviceExportRef = useRef<DeviceExportHandle | null>(null);
  /** Aborts caption-layout measuring before an on-device render starts. */
  const prepareAbortRef = useRef<AbortController | null>(null);
  /** The server still holds the uploaded source, so a server render is possible. */
  const serverHasSourceRef = useRef(false);
  /** Uploading the video before a cloud render (route.uploadFirst) — Cancel aborts it. */
  const attachUploadRef = useRef<AbortController | null>(null);
  /** Audio-only project with no copy on this device: what the original file looked like. */
  const [missingSource, setMissingSource] = useState<{ size: number; durations: number[] } | null>(null);
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateError, setLocateError] = useState('');
  /** Bumped once the original is located, so AuthenticatedVideo re-reads the local copy. */
  const [videoSourceKey, setVideoSourceKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  // Time-readouts driven by direct DOM writes from the rAF loop (no re-render).
  const scrubberRef = useRef<HTMLInputElement>(null);
  const scrubberHeld = useRef(false);
  const clockRef = useRef<HTMLSpanElement>(null);
  const playheadRulerRef = useRef<HTMLDivElement>(null);
  const playheadTrackRef = useRef<HTMLDivElement>(null);
  /** Debounce timer for persisting per-word style edits. */
  const wordStyleSaveTimer = useRef<number | undefined>(undefined);
  /** Debounce timer for persisting the Blockbuster knobs (sliders fire per pixel). */
  const kineticSaveTimer = useRef<number | undefined>(undefined);
  // Mirror of `style` for pointer-up persistence (avoids stale closure values).
  const styleRef = useRef(style);
  styleRef.current = style;
  const showExportRef = useRef(showExport);
  showExportRef.current = showExport;

  // Export progress over websockets (only while the export panel is open —
  // closing the panel resets UI and ignores late progress events).
  useEffect(() => {
    const s = getSocket();
    const onProgress = (data: { percent: number }) => {
      if (!showExportRef.current || exportWhereRef.current === 'device') return;
      setExportStatus('rendering');
      setExportPercent(data.percent);
    };
    const onDone = () => {
      // The server releases its copy of the source after any export.
      serverHasSourceRef.current = false;
      if (!showExportRef.current || exportWhereRef.current === 'device') return;
      setExportStatus('done');
      setExportPercent(100);
    };
    const onError = (data: { message?: string }) => {
      if (!showExportRef.current || exportWhereRef.current === 'device') return;
      setExportStatus('error');
      setExportError(data.message || 'Export failed');
    };
    const onCancelled = () => {
      if (exportWhereRef.current === 'device') return;
      setExportStatus('idle');
      setExportPercent(0);
      setExportError('');
    };
    // The export ran, but something the user asked for could not be honoured
    // (today: text behind person on a server with no segmentation service).
    // Not an error — the file is fine — so it must not look like one.
    const onWarning = (data: { message?: string }) => {
      if (!showExportRef.current || !data?.message) return;
      setExportWarning(data.message);
    };
    s.on('export:progress', onProgress);
    s.on('export:done', onDone);
    s.on('export:error', onError);
    s.on('export:cancelled', onCancelled);
    s.on('export:warning', onWarning);
    return () => {
      s.off('export:progress', onProgress);
      s.off('export:done', onDone);
      s.off('export:error', onError);
      s.off('export:cancelled', onCancelled);
      s.off('export:warning', onWarning);
    };
  }, []);

  // Leaving the editor mid-render stops the on-device export (its worker would
  // otherwise keep the GPU busy for a result nobody can collect).
  useEffect(
    () => () => {
      prepareAbortRef.current?.abort();
      deviceExportRef.current?.cancel();
      attachUploadRef.current?.abort();
    },
    [],
  );

  // Land on the first caption so the overlay is visible (not silence / ended).
  const didSeekToCaption = useRef(false);
  useEffect(() => {
    didSeekToCaption.current = false;
  }, [id]);

  /** Pull final captions — status/duration/stage still come from the server,
   *  but captions themselves are local now (no Mongo Caption collection).
   *  `opts.captions`, when given, is the payload the caller already has
   *  fresh from a `captions:complete` socket event — use it directly instead
   *  of re-reading IndexedDB right after writing it. */
  const reloadFinalCaptions = useCallback(
    async (opts?: { fromComplete?: boolean; captions?: Caption[] }) => {
      if (!id) return;
      try {
        const r = await api.get(`/projects/${id}`);
        const status = r.data.project?.status as string | undefined;
        if (r.data.project?.video?.duration) setDuration(r.data.project.video.duration);
        if (r.data.project?.stage) setPipelineStage(r.data.project.stage);

        const done = ['ready', 'done', 'partial_error', 'error'].includes(status || '');
        if (done || opts?.fromComplete) {
          let caps = opts?.captions ?? (await getAllForProject(id));
          // Only a caller that already holds fresh captions (the socket event)
          // skips this; the polling safety net passes fromComplete too.
          if (done && !opts?.captions && caps.length === 0 && status !== 'error') {
            // Terminal server status but nothing found locally — this browser
            // missed the one-shot captions:complete socket event (or this is a
            // different browser than the one that generated them). Try the
            // server's caption copy, kept for 30 days or until the project's
            // last video is deleted.
            try {
              const fallback = await api.get(`/projects/${id}/captions-cache`);
              const fallbackCaps = (fallback.data?.captions || []) as Caption[];
              if (fallbackCaps.length) {
                await replaceAllForProject(id, fallbackCaps);
                caps = fallbackCaps;
              }
            } catch {
              /* fall through to the "no captions" error below */
            }
          }
          setCaptions(caps);
          setComplete(caps.length, caps.length === 0);
          setBusy('');
          setRebuildPercent(0);
          setProcessing(false);
          const transcriptWords = (r.data.project?.transcription?.words?.length as number | undefined) ?? 0;
          setCanRestoreCaptions(caps.length === 0 && transcriptWords > 0);
          if (status === 'partial_error' && r.data.project?.errorMessage) {
            setError(r.data.project.errorMessage);
            setHasFailedChunks(true);
          } else if (done && caps.length === 0 && status !== 'error') {
            // The transcript is the expensive part; if the server still has it,
            // the captions come back from it for free.
            setError(
              transcriptWords > 0
                ? 'The captions for this video are not on this device. Restore them from the saved transcript.'
                : 'No captions found - click Regenerate to create them again.',
            );
            setHasFailedChunks(false);
          } else {
            setHasFailedChunks(false);
          }
          const first = caps[0]?.start;
          if (typeof first === 'number' && videoRef.current) {
            videoRef.current.currentTime = Math.max(0, first + 0.05);
            didSeekToCaption.current = true;
          }
        } else if (['processing', 'transcribing', 'translating', 'uploaded'].includes(status || '')) {
          setProcessing(status !== 'uploaded');
        }
      } catch (err) {
        // Previously unguarded — a throw here (IndexedDB unavailable/quota
        // error, a 404 for a stale/foreign project id, a network blip) left
        // the editor silently stuck on blank/default state or, when called
        // from the polling safety-net below, left ProcessingOverlay spinning
        // forever with only a console-level unhandled rejection as any trace.
        console.error('reloadFinalCaptions failed', err);
        setError('Failed to load captions - try refreshing the page.');
        setBusy('');
        setRebuildPercent(0);
        setProcessing(false);
      }
    },
    [id, setCaptions, setComplete, setPipelineStage],
  );

  // Caption rebuild runs in the background on the server; listen for its
  // progress and completion so Generate works even for long conversions.
  useEffect(() => {
    if (!id) return;
    const s = getSocket();
    const onTranslate = (data: { percent?: number }) => {
      setBusy('rebuild');
      if (typeof data.percent === 'number') setRebuildPercent(data.percent);
    };
    const onComplete = (data: { captions?: Caption[] }) => {
      // The full caption set now arrives IN the socket event itself (no more
      // Mongo Caption collection to re-fetch via REST) — persist it locally
      // first, then reload from that. Still retry the status/duration GET
      // inside reloadFinalCaptions against a transient network/dev-server blip.
      void (async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (data.captions) await replaceAllForProject(id, data.captions);
            await reloadFinalCaptions({ fromComplete: true, captions: data.captions });
            return;
          } catch (err) {
            console.error('reloadFinalCaptions failed after captions:complete', {
              attempt,
              err,
            });
            if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
        setError('Captions finished but failed to load - refresh the page');
        setBusy('');
        setProcessing(false);
      })();
    };
    const onProjError = (data: { message?: string }) => {
      setError(data.message || 'Caption generation failed');
      setBusy('');
      setRebuildPercent(0);
      setProcessing(false);
    };
    const onStage = (p: { current: string; percent: number; message?: string }) => {
      setPipelineStage(p);
      setProcessing(p.current !== 'ready');
    };
    const onPartial = (p: { chunkIndex: number; captions: Caption[] }) =>
      receivePartialChunk(p.chunkIndex, p.captions);
    // Sources the browser can't decode natively (HEVC phone recordings, most
    // commonly) start out serving the original file — audio plays, no frame
    // — while the server transcodes a browser-safe copy in the background.
    // Once that lands, reload the <video> element so it picks up the copy
    // without the user needing to refresh the page.
    const onPreviewReady = () => {
      const v = videoRef.current;
      if (!v) return;
      const resumeAt = v.currentTime;
      const wasPlaying = !v.paused;
      const onLoadedMeta = () => {
        v.currentTime = resumeAt;
        if (wasPlaying) void v.play().catch(() => undefined);
        v.removeEventListener('loadedmetadata', onLoadedMeta);
      };
      v.addEventListener('loadedmetadata', onLoadedMeta);
      v.load();
    };
    // Text-behind-person matte progress (segmentation.service.ts).
    const onMasksProgress = (p: { percent?: number }) => {
      setMasks((m) => ({ ...m, status: 'running', error: undefined }));
      if (typeof p.percent !== 'number') return;
      setMasksPercent(p.percent);
      // Remember when this render actually began so the panel can say how much
      // longer, not just how far along. Anchored on the first progress event
      // rather than the enqueue, because queue time is not render time.
      if (p.percent > 0 && matteStartRef.current === null) {
        matteStartRef.current = { at: Date.now(), percent: p.percent };
      }
      const s = matteStartRef.current;
      if (s && p.percent > s.percent) {
        const elapsed = Date.now() - s.at;
        const done = p.percent - s.percent;
        setMatteEtaSec(Math.round((elapsed / done) * (100 - p.percent) / 1000));
      }
    };
    const onMasksDone = () => {
      setMasks({ status: 'done' });
      setMasksPercent(100);
      matteStartRef.current = null;
      setMatteEtaSec(null);
    };
    const onMasksError = (p: { message?: string }) =>
      setMasks({ status: 'failed', error: p.message || 'Person matte failed' });
    s.on('translation:progress', onTranslate);
    s.on('captions:complete', onComplete);
    s.on('project:error', onProjError);
    s.on('stage:update', onStage);
    s.on('captions:partial', onPartial);
    s.on('video:preview-ready', onPreviewReady);
    s.on('masks:progress', onMasksProgress);
    s.on('masks:done', onMasksDone);
    s.on('masks:error', onMasksError);
    return () => {
      s.off('translation:progress', onTranslate);
      s.off('captions:complete', onComplete);
      s.off('project:error', onProjError);
      s.off('stage:update', onStage);
      s.off('captions:partial', onPartial);
      s.off('video:preview-ready', onPreviewReady);
      s.off('masks:progress', onMasksProgress);
      s.off('masks:done', onMasksDone);
      s.off('masks:error', onMasksError);
    };
  }, [id, receivePartialChunk, reloadFinalCaptions, setPipelineStage]);

  // Safety net: if a socket event is missed, poll until the project is ready
  // so chunked generation always lands the full caption set.
  useEffect(() => {
    if (!id || (!processing && busy !== 'rebuild')) return;
    let cancelled = false;
    const tick = () => {
      void api
        .get(`/projects/${id}`)
        .then((r) => {
          if (cancelled) return;
          const status = r.data.project?.status as string;
          if (['ready', 'done', 'partial_error'].includes(status)) {
            void reloadFinalCaptions({ fromComplete: true });
          } else if (status === 'error') {
            setError(r.data.project?.errorMessage || 'Caption generation failed');
            setBusy('');
            setProcessing(false);
          } else if (r.data.project?.stage) {
            setPipelineStage(r.data.project.stage);
          }
        })
        .catch(() => undefined);
    };
    const t = window.setInterval(tick, 2500);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [id, processing, busy, reloadFinalCaptions, setPipelineStage]);

  // Safety net for the video-preview swap: 'video:preview-ready' (above)
  // covers the normal case, but a socket event can be missed (fired before
  // the client finished joining the project room, a brief reconnect, etc).
  // videoWidth stays 0 for as long as the browser hasn't decoded a single
  // frame — an unrecognized codec (HEVC) or a not-yet-ready preview both look
  // like that, so periodically nudge a reload until one actually paints.
  // First attempt waits 15s so a normal, merely-slow-to-buffer load isn't
  // interrupted mid-flight.
  useEffect(() => {
    if (!id) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;
    const t = window.setInterval(() => {
      attempts++;
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth > 0 || attempts > MAX_ATTEMPTS) {
        window.clearInterval(t);
        return;
      }
      v.load();
    }, 15000);
    return () => window.clearInterval(t);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    connectSocket();
    joinProjectRoom(id);
    void api.get(`/projects/${id}`).then(async (r) => {
      setProjectName(r.data.project.name || 'Project');
      // An audio-only upload's filePath is the audio track — nothing the server can render.
      const serverVideo = r.data.project.video;
      serverHasSourceRef.current =
        Boolean(serverVideo?.filePath) && serverVideo?.kind !== 'audio';
      if (serverVideo?.kind === 'audio') {
        void getSourceFile(id)
          .then((file) =>
            setMissingSource(
              file
                ? null
                : {
                    size: Number(serverVideo.originalSize) || 0,
                    durations: [serverVideo.originalDuration, serverVideo.duration]
                      .map(Number)
                      .filter((d) => d > 0),
                  },
            ),
          )
          .catch(() => undefined);
      }
      if (r.data.project.video?.duration) setDuration(r.data.project.video.duration);
      // Display size from upload probe (rotation-aware) — sizes the canvas
      // before the <video> element finishes loading metadata.
      const vw = Number(r.data.project.video?.width) || 0;
      const vh = Number(r.data.project.video?.height) || 0;
      if (vw > 0 && vh > 0) {
        savedVideoDims.current = { w: vw, h: vh };
        setVideoDims({ w: vw, h: vh });
      }
      const savedStyle = r.data.project.style || {};
      const settings = r.data.project.settings;
      if (r.data.project.masks?.status) setMasks(r.data.project.masks as MasksState);
      const rawBg = (savedStyle.backgroundColor as string) || 'rgba(0,0,0,0)';
      // Strip legacy opaque black caption boxes; keep white pill / custom fills.
      const isLegacyBlackBox =
        /^#000000$/i.test(rawBg) ||
        /^rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(rawBg) ||
        /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0\.[2-9]\d*|1(\.0)?)\s*\)$/i.test(rawBg);
      const savedAspect = String(savedStyle.aspectRatio || '');
      const aspectRatio =
        savedAspect && savedAspect !== 'original' ? savedAspect : DEFAULT_ASPECT;
      const merged = {
        ...savedStyle,
        backgroundColor: isLegacyBlackBox ? 'rgba(0,0,0,0)' : rawBg,
        activeFill: savedStyle.activeFill || 'transparent',
        textTransform: savedStyle.textTransform || 'none',
        aspectRatio,
        // Older projects stored the display behavior as settings.captionMode.
        displayMode:
          (savedStyle.displayMode as DisplayMode) || legacyModeToDisplay(settings?.captionMode),
        displayWords: savedStyle.displayWords || settings?.batchSize || 5,
      };
      // CapCut-style: always materialize X/Y % so preview and export share one
      // coordinate system (presets fill in when older projects have nulls).
      const anchor = resolveCaptionAnchor(merged);
      // Stacked templates preview in the exact mode they burn in.
      const forcedMode = stackedDisplayMode(merged.template as string);
      if (forcedMode) merged.displayMode = forcedMode;
      setStyle((s) => ({
        ...s,
        ...merged,
        offsetX: anchor.offsetX,
        offsetY: anchor.offsetY,
        position: (matchPositionPreset(anchor) ||
          merged.position ||
          'center') as StyleState['position'],
      }));
      // Persist hydrated anchors + default 9:16 when aspect was missing/original.
      const stylePatch: Record<string, unknown> = {};
      if (savedStyle.offsetX == null || savedStyle.offsetY == null) {
        stylePatch.offsetX = anchor.offsetX;
        stylePatch.offsetY = anchor.offsetY;
        stylePatch.position = matchPositionPreset(anchor) || merged.position || 'center';
      }
      if (!savedAspect || savedAspect === 'original') {
        stylePatch.aspectRatio = DEFAULT_ASPECT;
      }
      if (forcedMode && savedStyle.displayMode !== forcedMode) {
        stylePatch.displayMode = forcedMode;
      }
      if (Object.keys(stylePatch).length) {
        void api.patch(`/projects/${id}/style`, stylePatch).catch(() => undefined);
      }
      if (settings) {
        setOutputLanguage(settings.outputLanguage || 'keep_original');
      }
      spokenLanguageRef.current = {
        chosen: settings?.sourceLanguage,
        detected: r.data.project.transcription?.language,
      };
      // Freshly uploaded project, never transcribed — show the Prepare Your
      // Media popup so the user can pick languages and start transcription.
      const status = r.data.project.status as string;
      const caps = await getAllForProject(id);
      if (['uploaded', 'uploading'].includes(status)) {
        setShowPrepare(true);
        setCaptions(caps);
      } else if (['processing', 'transcribing', 'translating'].includes(status)) {
        // Pipeline already running (e.g. after a refresh) — resume streaming.
        // Do NOT finalize empty captions or late partials get dropped.
        beginGeneration();
        setProcessing(true);
        if (r.data.project.stage) setPipelineStage(r.data.project.stage);
      } else if (caps.length === 0 && ['ready', 'done', 'partial_error'].includes(status)) {
        // Finished while this page was closed (the one-shot captions:complete
        // event was missed): load the server's copy of the captions.
        void reloadFinalCaptions();
      } else {
        setCaptions(caps);
      }
    }).catch((err) => {
      // Previously unguarded — a throw here (deleted/foreign project id,
      // IndexedDB unavailable, a network blip) left the editor permanently
      // on default/blank state with no error banner and nothing distinct
      // from "still loading," discoverable only via an unhandled rejection
      // in the console.
      console.error('Failed to load project', err);
      setError('Failed to load this project - it may have been deleted, or try refreshing.');
    });
  }, [id, setCaptions, setPipelineStage, beginGeneration, reloadFinalCaptions]);

  useEffect(() => {
    if (didSeekToCaption.current || !captions.length) return;
    const v = videoRef.current;
    if (!v) return;
    const start = captions[0].start;
    const lastEnd = captions[captions.length - 1].end;
    const t = v.currentTime;
    const parkedOutside =
      !Number.isFinite(t) || t < start - 0.05 || t >= lastEnd - 0.05 || v.ended;
    if (parkedOutside) {
      v.currentTime = Math.max(0, start + 0.05);
    }
    didSeekToCaption.current = true;
  }, [captions]);

  // Fit the preview canvas to the stage at the chosen aspect ratio, so the
  // canvas (and caption placement) always matches what gets exported.
  const aspectNumber = resolvePreviewAspect(style.aspectRatio, videoDims);
  useEffect(() => {
    const el = stageCanvasRef.current;
    if (!el) return;
    const compute = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch || !aspectNumber || aspectNumber <= 0) return;
      let w = cw;
      let h = cw / aspectNumber;
      if (h > ch) {
        h = ch;
        w = ch * aspectNumber;
      }
      setWrapSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspectNumber]);

  // Keep a caption layer locked to the painted video frame (object-fit: contain).
  useEffect(() => {
    const wrap = videoWrapRef.current;
    const video = videoRef.current;
    if (!wrap) return;

    const measure = () => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (!cw || !ch) return;

      // Must match object-fit:contain math — use the element's intrinsic size
      // when available so the caption layer lines up with the painted frame.
      const vw = video?.videoWidth || videoDims?.w || 0;
      const vh = video?.videoHeight || videoDims?.h || 0;
      if (!vw || !vh) {
        setContentBox({ left: 0, top: 0, w: cw, h: ch });
        return;
      }

      const videoRatio = vw / vh;
      const wrapRatio = cw / ch;
      let width: number;
      let height: number;
      let left: number;
      let top: number;
      if (wrapRatio > videoRatio + 0.001) {
        // Pillarbox — letterbox left/right
        height = ch;
        width = ch * videoRatio;
        left = (cw - width) / 2;
        top = 0;
      } else if (videoRatio > wrapRatio + 0.001) {
        // Letterbox — bars top/bottom
        width = cw;
        height = cw / videoRatio;
        left = 0;
        top = (ch - height) / 2;
      } else {
        width = cw;
        height = ch;
        left = 0;
        top = 0;
      }
      setContentBox({
        left: Math.round(left),
        top: Math.round(top),
        w: Math.round(width),
        h: Math.round(height),
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    video?.addEventListener('loadedmetadata', measure);
    video?.addEventListener('loadeddata', measure);
    return () => {
      ro.disconnect();
      video?.removeEventListener('loadedmetadata', measure);
      video?.removeEventListener('loadeddata', measure);
    };
  }, [wrapSize, videoDims]);

  // Captions as they appear on the video for the chosen display template.
  // Derived locally from the canonical captions — switching templates is
  // instant and never calls the caption/AI APIs.
  const displayCaptions = useMemo(
    () => deriveDisplayCaptions(captions, style.displayMode, style.displayWords),
    [captions, style.displayMode, style.displayWords],
  );

  // The timeline always shows clean phrase blocks (deduped, non-overlapping)
  // regardless of the display template, so blocks stay readable.
  const timelineCaptions = useMemo(
    () => deriveDisplayCaptions(captions, 'phrase', style.displayWords),
    [captions, style.displayWords],
  );

  const timelineDuration = useMemo(() => {
    const lastEnd = captions.length ? captions[captions.length - 1].end : 0;
    // Some containers (fresh recordings, webm) report duration=Infinity/NaN;
    // an unbounded duration would hang the ruler-mark loop below.
    const dur = Number.isFinite(duration) ? duration : 0;
    const end = Number.isFinite(lastEnd) ? lastEnd : 0;
    return Math.max(dur, end, 1);
  }, [duration, captions]);

  // Live mirrors for the rAF loop so it never needs to re-subscribe.
  const captionsLive = useRef(captions);
  captionsLive.current = captions;
  const timelineDurationLive = useRef(timelineDuration);
  timelineDurationLive.current = timelineDuration;

  const MIN_PPS = 56;
  const [timelineWidth, setTimelineWidth] = useState(0);
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const measure = () => setTimelineWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pps = Math.max(MIN_PPS, (timelineWidth - 16) / timelineDuration);
  const ppsLive = useRef(pps);
  ppsLive.current = pps;
  const [timelineActiveIdx, setTimelineActiveIdx] = useState(-1);
  const timelineCaptionsLive = useRef(timelineCaptions);
  timelineCaptionsLive.current = timelineCaptions;

  // Playback tracking without re-rendering the page: the rAF loop writes the
  // clock / scrubber / playhead positions straight to the DOM, and only
  // touches React state when the active caption block changes (~every 1-2s).
  useEffect(() => {
    let raf = 0;
    let lastActive = -2;
    let lastTimelineActive = -2;
    let lastClock = '';
    let lastPx = -1;
    const tick = () => {
      // Schedule the next frame FIRST so an exception in a single frame can
      // never kill the loop (a dead loop = frozen playhead/clock/scrubber).
      raf = requestAnimationFrame(tick);
      try {
        const video = videoRef.current;
        const t = video?.currentTime ?? 0;
        const total = timelineDurationLive.current;

        const idx = findActiveCaption(captionsLive.current, t);
        if (idx !== lastActive) {
          lastActive = idx;
          setActiveIndex(idx);
        }
        const tlIdx = findActiveCaption(timelineCaptionsLive.current, t);
        if (tlIdx !== lastTimelineActive) {
          lastTimelineActive = tlIdx;
          setTimelineActiveIdx(tlIdx);
        }

        const clock = formatClock(t);
        if (clock !== lastClock && clockRef.current) {
          lastClock = clock;
          clockRef.current.textContent = clock;
        }

        const px = t * ppsLive.current;
        if (Math.abs(px - lastPx) > 0.25) {
          lastPx = px;
          if (playheadRulerRef.current) playheadRulerRef.current.style.left = `${px}px`;
          if (playheadTrackRef.current) playheadTrackRef.current.style.left = `${px}px`;
          // Keep the playhead in view while playing (the user scrolls freely
          // when paused).
          const scroller = timelineScrollRef.current;
          if (scroller && video && !video.paused) {
            const view = scroller.clientWidth;
            if (px < scroller.scrollLeft + 24 || px > scroller.scrollLeft + view - 48) {
              scroller.scrollLeft = Math.max(0, px - view * 0.2);
            }
          }
          const pct = Math.min(100, (t / total) * 100);
          const scrub = scrubberRef.current;
          if (scrub && !scrubberHeld.current) {
            scrub.value = String(Math.min(t, total));
            scrub.style.background = `linear-gradient(90deg, var(--cf-accent, var(--gold)) ${pct}%, var(--card-hover) ${pct}%)`;
          }
        }
      } catch {
        // Skip the bad frame; the next one recovers.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const activeCaption = activeIndex >= 0 ? captions[activeIndex] : undefined;

  const virtualizer = useVirtualizer({
    count: captions.length,
    getScrollElement: () => listRef.current,
    // Rows auto-measure (word chips make them variable height).
    estimateSize: () => 96,
    overscan: 8,
  });

  // Phrases list stays still during playback (auto-scrolling while playing
  // feels jumpy); when the video pauses or the user seeks, it jumps to the
  // caption at the playhead.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.activeElement;
    if (el && el.tagName === 'INPUT') return; // don't yank scroll while editing
    // NOTE: 'auto' (instant) on purpose — TanStack Virtual does not support
    // smooth scrolling with dynamically measured rows and it can wedge the
    // page in a scroll-correction loop.
    virtualizer.scrollToIndex(activeIndex, { align: 'center', behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, playing]);

  // Ruler marks spaced for readability at the current zoom (~every 90px).
  const ruler = useMemo(() => {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * pps >= 90) ?? 600;
    const marks: number[] = [];
    for (let t = 0; t <= timelineDuration; t += step) marks.push(t);
    return { step, marks };
  }, [timelineDuration, pps]);

  const seek = useCallback((seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime = seconds;
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      if (v.ended || (dur > 0 && v.currentTime >= dur - 0.08)) {
        const first = captionsLive.current[0]?.start ?? 0;
        v.currentTime = first > 0 ? first : 0;
      }
      void v.play();
    } else {
      v.pause();
    }
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || Infinity);
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const changeVolume = useCallback((value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
    setVolume(value);
    setMuted(v.muted);
  }, []);

  const cycleRate = useCallback(() => {
    const rates = [0.5, 1, 1.5, 2];
    const v = videoRef.current;
    if (!v) return;
    const next = rates[(rates.indexOf(v.playbackRate) + 1) % rates.length] ?? 1;
    v.playbackRate = next;
    setRate(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  }, []);

  // Spacebar play/pause (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        skip(-5);
      } else if (e.code === 'ArrowRight') {
        skip(5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skip]);

  function seekFromTimeline(e: React.MouseEvent<HTMLDivElement>) {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const seconds = (e.clientX - rect.left) / pps;
    seek(Math.min(timelineDuration, Math.max(0, seconds)));
  }

  // Stable callbacks (they read live captions via ref) so the memoized
  // CaptionOverlay / TimelineBlocks don't re-render on every page render.
  const saveCaption = useCallback(
    async (caption: Caption, text: string) => {
      if (!caption._id || !id) return;
      const updated = { ...caption, text };
      setCaptions(
        captionsLive.current.map((c) => (c._id === caption._id ? updated : c)),
      );
      await upsertOne(id, updated);
    },
    [id, setCaptions],
  );

  /**
   * Save text edited on a derived caption (video overlay / timeline block)
   * back into the canonical caption it came from.
   */
  const saveDerivedText = useCallback(
    (caption: DisplayCaption, text: string) => {
      const src = captionsLive.current.find((c) => c._id === (caption.sourceId ?? caption._id));
      if (!src) return; // spans several captions — edit in the Phrases panel
      if (src.text === caption.text) {
        void saveCaption(src, text);
        return;
      }
      const srcWords = src.text.split(/\s+/).filter(Boolean);
      const shownCount = caption.text.split(/\s+/).filter(Boolean).length;
      srcWords.splice(caption.wordOffset ?? 0, shownCount, ...text.split(/\s+/).filter(Boolean));
      void saveCaption(src, srcWords.join(' '));
    },
    [saveCaption],
  );

  /**
   * Delete a single word straight off the video preview (the × badge on the
   * selected word) — no trip to the Phrases panel. Uses the per-word
   * wordSources map (not sourceId/wordOffset, which only cover a display
   * caption backed by exactly one canonical caption) so this also works on
   * the common case where grouping merged words from several canonical
   * captions into the block currently on screen.
   */
  const deleteDerivedWord = useCallback(
    (caption: DisplayCaption, i: number) => {
      if (!id) return;
      const mapped = caption.wordSources?.[i];
      const srcId = mapped?.sourceId ?? caption.sourceId ?? caption._id;
      const srcIdx = mapped ? mapped.sourceIndex : i + (caption.wordOffset ?? 0);
      const src = srcId ? captionsLive.current.find((c) => c._id === srcId) : undefined;
      if (!src) return;
      const srcWords = src.text.split(/\s+/).filter(Boolean);
      if (srcIdx < 0 || srcIdx >= srcWords.length || srcWords.length <= 1) return;
      srcWords.splice(srcIdx, 1);
      const updated: Caption = {
        ...src,
        text: srcWords.join(' '),
        emphasis: src.emphasis ? src.emphasis.filter((_, wi) => wi !== srcIdx) : src.emphasis,
        wordStyles: src.wordStyles ? src.wordStyles.filter((_, wi) => wi !== srcIdx) : src.wordStyles,
      };
      setCaptions(captionsLive.current.map((c) => (c._id === src._id ? updated : c)));
      setSelectedWordIdx(null);
      setPhrasePickerOpen(false);
      void upsertOne(id, updated);
    },
    [id, setCaptions],
  );

  /**
   * Delete the whole caption chunk currently on screen (the "Delete" button
   * next to Apply To All in the resize/reposition confirm toolbar). Walks
   * every word in this display block via wordSources (not sourceIds alone —
   * a single canonical caption can straddle two adjacent display blocks when
   * a word-count/silence break lands mid-caption, so this only strips the
   * exact words that are actually part of THIS chunk) and drops any
   * canonical caption left with no words at all. Remaining captions are
   * renumbered so Phrases stays a clean, contiguous list.
   */
  const deleteDerivedChunk = useCallback(
    (caption: DisplayCaption) => {
      if (!id) return;
      const sources = caption.wordSources;
      if (!sources?.length) return;
      const removeBySource = new Map<string, Set<number>>();
      for (const w of sources) {
        if (!w.sourceId) continue;
        const set = removeBySource.get(w.sourceId) ?? new Set<number>();
        set.add(w.sourceIndex);
        removeBySource.set(w.sourceId, set);
      }
      if (!removeBySource.size) return;

      const kept: Caption[] = [];
      for (const c of captionsLive.current) {
        const remove = c._id ? removeBySource.get(c._id) : undefined;
        if (!remove) {
          kept.push(c);
          continue;
        }
        const words = c.text.split(/\s+/).filter(Boolean);
        const keptWords: string[] = [];
        const keptEmphasis: WordRole[] = [];
        const keptStyles: WordStyle[] = [];
        words.forEach((w, wi) => {
          if (remove.has(wi)) return;
          keptWords.push(w);
          keptEmphasis.push(c.emphasis?.[wi] ?? 'auto');
          keptStyles.push(c.wordStyles?.[wi] ?? {});
        });
        if (!keptWords.length) continue; // this canonical caption sat entirely inside the deleted chunk
        kept.push({
          ...c,
          text: keptWords.join(' '),
          emphasis: c.emphasis ? keptEmphasis : c.emphasis,
          wordStyles: c.wordStyles ? keptStyles : c.wordStyles,
        });
      }
      const renumbered = kept.map((c, i) => ({ ...c, sequence: i + 1 }));
      setCaptions(renumbered);
      setSelectedWordIdx(null);
      setPhrasePickerOpen(false);
      void replaceAllForProject(id, renumbered);
    },
    [id, setCaptions],
  );

  /** Click a word on the video → select it in the Phrases panel. Display
   *  captions are derived, so the click maps back to the canonical caption —
   *  via wordSources, since the clicked word may come from a different
   *  canonical caption than the display block's first word (merged group). */
  const overlayWordSelect = useCallback((caption: DisplayCaption, i: number) => {
    const mapped = caption.wordSources?.[i];
    setSelectedId(mapped?.sourceId ?? caption.sourceId ?? caption._id ?? null);
    setSelectedWordIdx(mapped ? mapped.sourceIndex : i + (caption.wordOffset ?? 0));
  }, []);

  /**
   * Apply a display change (template / words per caption) instantly and
   * persist it. This is a plain DB write — no caption regeneration, no AI.
   */
  function applyDisplay(patch: Partial<StyleState>) {
    // Merge into the full style before persisting so the DB always has a
    // complete template snapshot (not a partial that can leave displayMode stale).
    // Reset Antigravity-only fields unless the preset sets them explicitly.
    const next: StyleState = {
      ...styleRef.current,
      activeFill: 'transparent',
      textTransform: 'none' as const,
      ...patch,
    };
    // Same rule as the export: stacked templates own their display mode
    // (karaoke/word would flatten the hero/support sizing in the preview).
    const tpl = next.template;
    const forcedMode = stackedDisplayMode(tpl);
    if (forcedMode) next.displayMode = forcedMode;
    if (tpl === 'heroWord') {
      if (!next.highlightColor || next.highlightColor === '#FFFFFF') {
        next.highlightColor = '#FF2D9A';
      }
      next.fontWeight = 900;
      next.fontFamily = 'Montserrat';
    }
    setStyle(next);
    void api.patch(`/projects/${id}/style`, next).catch(() => undefined);
  }

  /**
   * Rebuild the captions. `retranscribe` false rebuilds them from the
   * transcript the server already has — no transcription, nothing to pay for —
   * which is what a project whose captions are missing from this device needs;
   * true re-transcribes the audio (a language change, or no transcript left).
   */
  async function rebuild(retranscribe = true) {
    setBusy('rebuild');
    setError('');
    setHasFailedChunks(false);
    setCanRestoreCaptions(false);
    setRebuildPercent(0);
    beginGeneration();
    setProcessing(true);
    setPipelineStage({
      current: retranscribe ? 'extracting' : 'translating',
      percent: 0,
      message: retranscribe ? 'Starting full re-transcription…' : 'Rebuilding captions from the transcript…',
    });
    didSeekToCaption.current = false;
    try {
      await api.post(`/projects/${id}/rebuild`, { outputLanguage, retranscribe });
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Rebuild failed',
      );
      setBusy('');
      setProcessing(false);
    }
  }

  /** Same full re-transcription as Regenerate Captions (the server has no
   *  cheaper partial-chunk path), but surfaced directly on the partial_error
   *  banner so a failed project has an obvious, one-click recovery action
   *  instead of requiring the user to find Regenerate in the Captions panel. */
  async function retryChunks() {
    setBusy('rebuild');
    setError('');
    setHasFailedChunks(false);
    setRebuildPercent(0);
    beginGeneration();
    setProcessing(true);
    setPipelineStage({ current: 'transcribing', percent: 0, message: 'Retrying failed parts…' });
    didSeekToCaption.current = false;
    try {
      await api.post(`/projects/${id}/retry-chunks`);
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Retry failed',
      );
      setBusy('');
      setProcessing(false);
    }
  }

  async function saveStyle() {
    await api.patch(`/projects/${id}/style`, style);
  }

  async function setWordRole(caption: Caption, index: number, role: WordRole) {
    if (!caption._id || !id) return;
    const wordCount = caption.text.split(/\s+/).filter(Boolean).length;
    const roles: WordRole[] = Array.from(
      { length: wordCount },
      (_, i) => caption.emphasis?.[i] ?? 'auto',
    );
    // Exactly one Hero and one Support per phrase (matches AI agent).
    if (role === 'hero' || role === 'small') {
      for (let i = 0; i < roles.length; i++) {
        if (roles[i] === role) roles[i] = 'auto';
      }
    }
    roles[index] = role;
    const updated = { ...caption, emphasis: roles };
    setCaptions(captions.map((c) => (c._id === caption._id ? updated : c)));
    await upsertOne(id, updated);
  }

  function setWordStyle(caption: Caption, index: number, patch: WordStyle) {
    if (!caption._id || !id) return;
    const wordCount = caption.text.split(/\s+/).filter(Boolean).length;
    const wordStyles: WordStyle[] = Array.from({ length: wordCount }, (_, i) => ({
      scale: caption.wordStyles?.[i]?.scale ?? null,
      color: caption.wordStyles?.[i]?.color ?? null,
    }));
    wordStyles[index] = { ...wordStyles[index], ...patch };
    const updated = { ...caption, wordStyles };
    setCaptions(captions.map((c) => (c._id === caption._id ? updated : c)));
    // Sliders/color pickers fire rapidly while dragging — debounce the save.
    if (wordStyleSaveTimer.current) window.clearTimeout(wordStyleSaveTimer.current);
    const projectId = id;
    wordStyleSaveTimer.current = window.setTimeout(() => {
      // Previously fire-and-forget with no .catch() — a failure (IndexedDB
      // quota/unavailable) left the edit showing as applied in the UI
      // (setCaptions above already ran) while never actually persisting,
      // silently reverting on next load with zero indication anything went
      // wrong.
      void upsertOne(projectId, updated).catch((err) => {
        console.error('Failed to save word style', err);
        setError('Failed to save style change - it may not persist after reload.');
      });
    }, 450);
  }

  async function resetWordRoles(caption: Caption) {
    if (!caption._id || !id) return;
    const updated = { ...caption, emphasis: [], wordStyles: [] };
    setCaptions(captions.map((c) => (c._id === caption._id ? updated : c)));
    await upsertOne(id, updated);
  }

  /**
   * Text-behind-person toggle. The server flips style.behindPerson and, the
   * first time it's turned on, renders the person matte in the background
   * (progress arrives over the masks:* socket events above).
   */
  async function toggleBehindPerson(enabled: boolean) {
    if (!id) return;
    setStyle((s) => ({ ...s, behindPerson: enabled }));
    setError('');
    // The person cut-out runs on this device — in the preview (MediaPipe) and
    // in the on-device export (lib/export/personMatte.ts) — so only the
    // setting needs saving. A server render builds its own matte when it runs.
    try {
      await api.patch(`/projects/${id}/style`, { behindPerson: enabled });
    } catch (e: unknown) {
      setStyle((s) => ({ ...s, behindPerson: !enabled }));
      const data = (e as { response?: { data?: { message?: string } } })?.response?.data;
      setError(data?.message || 'Could not update text behind person');
    }
  }

  /**
   * The matte is actually being built right now — 'queued' before the worker
   * picks it up, 'running' once frames are flowing. Anything else (idle, done,
   * failed) is a sentence, not a bar.
   */
  const matteBusy: 'queued' | 'running' | null =
    masks.status === 'queued' || masks.status === 'running' ? masks.status : null;

  /** "about 40s left" / "about 2m left" — only once the estimate is worth showing. */
  const matteEtaLabel = (() => {
    if (matteEtaSec === null || matteEtaSec < 2) return '';
    return matteEtaSec < 90
      ? `- about ${matteEtaSec}s left`
      : `- about ${Math.round(matteEtaSec / 60)}m left`;
  })();

  const masksHint = (() => {
    if (!style.behindPerson) {
      return 'Cuts the video around the person so captions sit behind them. Only the stretches where a phrase sits behind the person are processed.';
    }
    switch (masks.status) {
      case 'queued':
        return 'Preparing the person matte - queued…';
      case 'running':
        return `Preparing the person matte… ${masksPercent}%`;
      case 'done':
        return 'Matte ready. The preview cut-out is approximate; the export uses the high-quality matte.';
      case 'failed':
        return `Matte failed: ${masks.error || 'unknown error'}. Export again, or turn the toggle off and on, to retry.`;
      default:
        return 'Preparing the person matte…';
    }
  })();

  /** Current value of one Blockbuster knob, falling back to the authored default. */
  function kineticParam(key: keyof KineticParams): number {
    const v = style.kinetic?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : KINETIC_PARAM_DEFAULTS[key];
  }

  /**
   * Update the Blockbuster knobs (`null` = back to the authored look). The
   * preview follows immediately; the PATCH is debounced because range inputs
   * fire on every pixel of a drag.
   */
  function setKineticParams(patch: Partial<KineticParams> | null) {
    const kinetic: KineticParams = patch
      ? { ...KINETIC_PARAM_DEFAULTS, ...(styleRef.current.kinetic ?? {}), ...patch }
      : { ...KINETIC_PARAM_DEFAULTS };
    setStyle((s) => ({ ...s, kinetic }));
    if (kineticSaveTimer.current) window.clearTimeout(kineticSaveTimer.current);
    kineticSaveTimer.current = window.setTimeout(() => {
      void api.patch(`/projects/${id}/style`, { kinetic }).catch((err) => {
        console.error('Failed to save kinetic style', err);
        setError('Failed to save style change - it may not persist after reload.');
      });
    }, 450);
  }

  /**
   * Commit a whole-chunk drag-resize and/or reposition from the video
   * overlay: either just the caption(s) behind the resized/moved display
   * block ("Current Preset"), or every caption in the project ("Apply To All").
   */
  async function handleChunkStyleCommit(
    caption: DisplayCaption,
    patch: { sizeScale?: number; offsetX?: number; offsetY?: number; behindPerson?: boolean | null },
    scope: 'chunk' | 'all',
  ) {
    if (!id) return;
    const targetIds =
      scope === 'chunk'
        ? caption.sourceIds?.length
          ? caption.sourceIds
          : [caption.sourceId ?? caption._id].filter((v): v is string => !!v)
        : captions.map((c) => c._id).filter((v): v is string => !!v);
    if (!targetIds.length) return;
    const idSet = new Set(targetIds);
    const updatedCaptions = captions.map((c) => (c._id && idSet.has(c._id) ? { ...c, ...patch } : c));
    setCaptions(updatedCaptions);
    await Promise.all(
      updatedCaptions.filter((c) => c._id && idSet.has(c._id)).map((c) => upsertOne(id, c)),
    );
  }

  /**
   * Push one phrase behind the speaker, or pull it back in front.
   *
   * Stored per caption as a tri-state: null follows the project's
   * style.behindPerson, true/false override it. That mirrors how sizeScale and
   * offsetX/offsetY already work, so an untouched chunk keeps behaving exactly
   * as it did before this control existed. The export turns the same values
   * into ffmpeg `enable=` windows (behindPersonRanges in export.service.ts).
   */
  async function setChunkBehindPerson(captionId: string, value: boolean | null) {
    if (!id) return;
    const updated = captions.map((c) => (c._id === captionId ? { ...c, behindPerson: value } : c));
    setCaptions(updated);
    const target = updated.find((c) => c._id === captionId);
    if (target) await upsertOne(id, target);
    // Nothing to request from the server: the cut-out for this phrase is
    // computed on this device, in the preview and in the on-device export.
  }

  const openExportModal = useCallback(() => setShowExport(true), []);
  const closeExportModal = useCallback(() => {
    const wasRendering = exportStatus === 'rendering';
    setShowExport(false);
    // Clear render UI so reopening isn't stuck on "Rendering N%".
    setExportStatus('idle');
    setExportPercent(0);
    setExportError('');
    setExportWarning('');
    setExportDetail('');
    // Actually stop the render — closing the panel is Cancel.
    const attachUpload = attachUploadRef.current;
    if (attachUpload) {
      // Still uploading the video for a cloud render — nothing is rendering yet.
      attachUploadRef.current = null;
      attachUpload.abort();
    } else if (wasRendering && prepareAbortRef.current) {
      prepareAbortRef.current.abort();
    } else if (wasRendering && deviceExportRef.current) {
      deviceExportRef.current.cancel();
    } else if (wasRendering && id) {
      void api.post(`/projects/${id}/export/cancel`).catch(() => undefined);
    }
  }, [exportStatus, id]);
  const downloadSrt = useCallback(() => {
    if (!id) return;
    const srt = captionsToSrt(captionsLive.current);
    const blob = new Blob([srt], { type: 'application/x-subrip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captions-${id}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [id]);

  useEffect(() => {
    useEditorChromeStore.getState().setChrome({
      active: true,
      onExport: openExportModal,
      onDownloadSrt: downloadSrt,
    });
    return () => useEditorChromeStore.getState().clearChrome();
  }, [openExportModal, downloadSrt]);

  /**
   * Render on this device (WebCodecs worker). Returns 'done' or 'stop' when
   * the export is settled, 'retry' when the render failed in a way another
   * attempt on this device can fix, 'fallback' only when the admin turned
   * device exports off. A failed device render no longer moves to the server
   * (see the commented block in the catch below). Plan errors from the
   * authorize call are rethrown so the caller shows the pricing popup.
   */
  async function renderOnDevice(
    route: Extract<ExportRoute, { path: 'device' }>,
    styleSnap: StyleState,
    attempt = 1,
  ): Promise<'done' | 'stop' | 'retry' | 'fallback'> {
    if (!id) return 'stop';
    setExportWhere('device');
    setExportDetail('Checking your plan…');
    try {
      await authorizeDeviceExport(id, {
        quality: exportQuality,
        format: exportFormat,
        template: styleSnap.template,
        width: route.width,
        height: route.height,
      });
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'CLIENT_EXPORT_DISABLED') {
        setExportWhere('server');
        return 'fallback';
      }
      throw err;
    }

    await evictOldExportsIfNeeded(80).catch(() => 0);
    const exportId = crypto.randomUUID();
    const prepare = new AbortController();
    prepareAbortRef.current = prepare;
    let handle: DeviceExportHandle | null = null;
    // Keep a phone awake for the render, and warn before the tab is closed.
    type WakeLock = { release(): Promise<void> };
    const wakeLock = await (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } })
      .wakeLock?.request('screen')
      .catch(() => null);
    const warnBeforeLeaving = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    try {
      // Non-kinetic templates first measure the preview's own caption layout
      // in this document (a few seconds for a long video).
      const job = await buildDeviceExportJob({
        exportId,
        source: route.source,
        width: route.width,
        height: route.height,
        durationSec: route.durationSec,
        format: exportFormat,
        style: styleSnap,
        captions,
        frameRate: exportFrameRate,
        signal: prepare.signal,
        onPrepare: (done, total) => {
          setExportDetail(`Preparing captions… ${done}/${total}`);
          setExportPercent(Math.round((done / Math.max(1, total)) * 3));
        },
      }).catch((err) => {
        throw prepare.signal.aborted
          ? new DeviceExportError('CANCELLED', 'Export cancelled')
          : new DeviceExportError('FAILED', `Couldn’t prepare the captions: ${err instanceof Error ? err.message : String(err)}`);
      });
      if (prepareAbortRef.current === prepare) prepareAbortRef.current = null;
      const startedAt = performance.now();
      handle = startDeviceExport(job, (p) => {
        setExportPercent(Math.max(0, Math.min(99, Math.round(p.percent))));
        setExportDetail(describeDeviceProgress(p, startedAt));
      });
      deviceExportRef.current = handle;
      const result = await handle.promise;
      const meta = { quality: exportQuality, format: exportFormat, template: styleSnap.template };
      const language = captionLanguageLabel(
        spokenLanguageRef.current.chosen,
        spokenLanguageRef.current.detected,
        outputLanguage,
      );
      await saveDeviceExportRecord({ id: exportId, projectId: id, title: projectName, ...meta, result, language }).catch(
        (err) => console.warn('[export] could not list the render in Recent exports', err),
      );
      try {
        await completeDeviceExport(id, result, { ...meta, templateKey: styleSnap.templateKey });
        serverHasSourceRef.current = false;
      } catch (err) {
        // The file is fine and on this device; only the bookkeeping missed.
        console.warn('[export] server did not record the finished render', err);
      }
      setSavedAs('');
      setDeviceResult({
        id: exportId,
        opfsPath: result.outputPath,
        fileName: exportFileName(projectName, exportQuality, exportFormat),
        renderMs: result.renderMs,
        sizeBytes: result.sizeBytes,
      });
      if (route.notes.length) setExportWarning(route.notes.join(' '));
      setExportDetail('');
      setExportPercent(100);
      setExportStatus('done');
      return 'done';
    } catch (err) {
      const e = err instanceof DeviceExportError ? err : new DeviceExportError('FAILED', String(err));
      if (e.code === 'CANCELLED') {
        void reportDeviceExportFailure(id, { code: e.code, message: e.message, fallback: false });
        return 'stop';
      }
      console.warn(`[export] on-device render failed (${e.code}, attempt ${attempt})`, e.message);
      // Awaited: a retry re-authorizes, and a late failure report would mark
      // that new render as failed on the server.
      await reportDeviceExportFailure(id, { code: e.code, message: e.message, fallback: false }).catch(() => undefined);
      setExportDetail('');
      setExportPercent(0);

      // SERVER FALLBACK (disabled): a failed device render used to continue on
      // the server, uploading this device's copy of the video first
      // (startExport). Kept for reference; re-enable by restoring these lines
      // and the 'fallback' handling in startExport.
      //   setExportWhere('server');
      //   return 'fallback';

      // Retrying can't fix a full disk or a video this browser can't decode.
      const retryable = e.code !== 'STORAGE' && e.code !== 'UNSUPPORTED';
      if (retryable && attempt < DEVICE_RENDER_ATTEMPTS) return 'retry';
      setExportStatus('error');
      setExportError(
        e.code === 'STORAGE'
          ? 'Not enough free storage to save the video. Delete some videos from Recent Videos and try again.'
          : e.code === 'UNSUPPORTED'
            ? 'This browser can’t export this video. Try the latest Chrome or Edge on a computer.'
            : 'Export failed. Please try again.',
      );
      return 'stop';
    } finally {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      void wakeLock?.release().catch(() => undefined);
      if (prepareAbortRef.current === prepare) prepareAbortRef.current = null;
      if (handle && deviceExportRef.current === handle) deviceExportRef.current = null;
    }
  }

  /** "Locate file" on an audio-only project: accept the original only if it matches, keep it on this device. */
  async function locateOriginal(file: File) {
    if (!id || !missingSource) return;
    setLocateBusy(true);
    setLocateError('');
    try {
      const probe = await probeMediaFile(file);
      if (!probe?.hasVideo) {
        setLocateError('That file isn’t a video this browser can read.');
        return;
      }
      const sizeOk =
        !missingSource.size || Math.abs(file.size - missingSource.size) <= missingSource.size * 0.01;
      const durationOk =
        !missingSource.durations.length ||
        missingSource.durations.some((d) => Math.abs(probe.duration - d) <= 0.5);
      if (!sizeOk || !durationOk) {
        const expected = [
          missingSource.size ? formatBytes(missingSource.size) : '',
          missingSource.durations.length ? formatSeconds(missingSource.durations[0]) : '',
        ]
          .filter(Boolean)
          .join(', ');
        setLocateError(`That doesn’t look like the original video${expected ? ` (expected ${expected})` : ''}.`);
        return;
      }
      await storeSourceFile(id, file, probe);
      setMissingSource(null);
      setVideoSourceKey((k) => k + 1);
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Couldn’t load that file');
    } finally {
      setLocateBusy(false);
    }
  }

  async function startExport() {
    setExportError('');
    setExportWarning('');
    setExportPercent(0);
    setExportStatus('rendering');
    setExportDetail('');
    setDeviceResult(null);
    setExportWhere(null);
    try {
      const live = styleRef.current;
      const aspectForBurn =
        live.aspectRatio && live.aspectRatio !== 'original'
          ? live.aspectRatio
          : DEFAULT_ASPECT;
      // Explicit full snapshot — every field the burn-in needs.
      const styleSnap: StyleState = {
        template: live.template || 'classic',
        fontFamily: live.fontFamily || 'Montserrat',
        fontSize: Number(live.fontSize) || 48,
        fontWeight: Number(live.fontWeight) || 700,
        color: live.color || '#FFFFFF',
        backgroundColor: live.backgroundColor || 'rgba(0,0,0,0)',
        highlightColor: live.highlightColor || '#FFC43D',
        activeFill: live.activeFill || 'transparent',
        textTransform: live.textTransform || 'none',
        position: live.position || 'bottom',
        offsetX: typeof live.offsetX === 'number' ? live.offsetX : 50,
        offsetY: typeof live.offsetY === 'number' ? live.offsetY : 72,
        animation: live.animation || 'fade',
        aspectRatio: aspectForBurn,
        displayMode: live.displayMode || 'phrase',
        displayWords: Number(live.displayWords) || 5,
        kinetic: live.kinetic,
        behindPerson: !!live.behindPerson,
        // Older projects saved no key: match the look to a card ("" = custom look).
        templateKey: matchTemplateKey(live) ?? '',
      };
      // Mirror live editor rules only — do NOT inflate fontSize/weight here
      // (that made burn-in look different from the preview the user approved).
      const forcedExportMode = stackedDisplayMode(styleSnap.template);
      if (forcedExportMode) styleSnap.displayMode = forcedExportMode;
      if (styleSnap.template === 'heroWord') {
        if (!styleSnap.highlightColor || styleSnap.highlightColor === '#FFFFFF') {
          styleSnap.highlightColor = '#FF2D9A';
        }
        styleSnap.fontWeight = styleSnap.fontWeight || 900;
        styleSnap.fontFamily = 'Montserrat';
      }
      // Captions no longer live in Mongo — this is the export's SOLE caption
      // source (not an override of a DB read), so it must be the full shape.
      const captionsSnap = captions
        .filter((c) => c._id)
        .map((c) => ({
          _id: c._id as string,
          sequence: c.sequence,
          start: c.start,
          end: c.end,
          text: c.text,
          originalText: c.originalText,
          words: c.words,
          emphasis: c.emphasis,
          wordStyles: c.wordStyles,
          sizeScale: c.sizeScale,
          behindPerson: c.behindPerson ?? null,
          offsetX: c.offsetX,
          offsetY: c.offsetY,
        }));
      // Always persist + send concrete aspect (9:16 / 16:9) — never "original".
      setStyle((s) => ({ ...s, aspectRatio: aspectForBurn }));
      await api.patch(`/projects/${id}/style`, styleSnap);

      const route = await chooseExportRoute({
        projectId: id!,
        clientExportEnabled: flags.clientExportEnabled,
        serverHasSource: serverHasSourceRef.current,
        style: styleSnap,
        captions,
        quality: exportQuality,
        format: exportFormat,
        fallbackDims: savedVideoDims.current
          ? { width: savedVideoDims.current.w, height: savedVideoDims.current.h }
          : undefined,
      });
      console.info('[export] route:', route.path, route.path === 'device' ? `${route.width}x${route.height}` : route.reason);
      if (route.path === 'device') {
        // Failed renders retry on this device instead of moving to the server.
        let outcome = await renderOnDevice(route, styleSnap, 1);
        for (let attempt = 2; outcome === 'retry' && attempt <= DEVICE_RENDER_ATTEMPTS; attempt++) {
          setExportDetail('Retrying…');
          outcome = await renderOnDevice(route, styleSnap, attempt);
        }
        // Only the admin switch (CLIENT_EXPORT_DISABLED) still continues on the server.
        if (outcome !== 'fallback') return;
      } else if (route.path === 'none') {
        setExportStatus('error');
        setExportError(
          'The original video file is needed to export this project. Use “Locate file” above the preview, or upload the video again.',
        );
        return;
      }

      // A failed or handed-over device render continues on the server, which
      // may first need this device's copy of the video.
      const uploadFirst =
        route.path === 'server' ? route.uploadFirst : serverHasSourceRef.current ? undefined : route.source;
      if (uploadFirst) {
        // The server has no copy of the video (audio-only upload, or released
        // after an export) — send this device's copy before it can render.
        const upload = new AbortController();
        attachUploadRef.current = upload;
        const uploading = (pct: number) => `Preparing export… ${pct}%`;
        setExportDetail(uploading(0));
        try {
          await uploadVideoToProject(
            id!,
            uploadFirst,
            (p) => {
              setExportPercent(p.percent);
              setExportDetail(uploading(p.percent));
            },
            upload.signal,
          );
        } catch (err) {
          // Cancel closed and reset the modal already.
          if (upload.signal.aborted) return;
          throw err;
        } finally {
          if (attachUploadRef.current === upload) attachUploadRef.current = null;
        }
        serverHasSourceRef.current = true;
        setExportPercent(0);
        setExportDetail('');
      }

      setExportWhere('server');
      await api.post(`/projects/${id}/export`, {
        quality: exportQuality,
        format: exportFormat,
        captionMode: 'burned',
        style: styleSnap,
        captions: captionsSnap,
      });
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { message?: string; code?: string } } })?.response?.data;
      const planErr = resolvePlanError(data);
      if (planErr?.showUpgrade) {
        // Free-plan export quota is exhausted — surface the pricing popup
        // in place of the export modal instead of a dead-end error banner.
        setShowExport(false);
        setExportStatus('idle');
        setExportPlanError(planErr);
        return;
      }
      setExportStatus('error');
      setExportError(data?.message || 'Export failed');
    }
  }

  async function downloadVideo() {
    if (!id) return;
    setDownloading(true);
    setDownloadError('');
    if (deviceResult) {
      try {
        await downloadLocalFile(deviceResult.opfsPath, deviceResult.fileName);
        setSavedAs(deviceResult.fileName);
        void markExportDownloaded(deviceResult.id, deviceResult.fileName).catch(() => undefined);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Download failed - try again');
      } finally {
        setDownloading(false);
      }
      return;
    }
    try {
      // Cheap JSON check first — a plain navigation (below) can't report a
      // JSON error back to this code, so if the export record already
      // expired, clicking Download would otherwise just silently hand the
      // browser a JSON error file instead of the video with no feedback.
      const { data } = await api.get(`/projects/${id}`);
      if (data.project?.export?.status !== 'done') {
        throw new Error('Export is no longer available - render again');
      }
      // Hand the actual (often tens-of-MB) transfer to the browser's native
      // download manager via a direct navigation instead of buffering the
      // whole file into a JS Blob through XHR — the blob/XHR path was
      // failing with an opaque "Network Error" on real exports. The
      // httpOnly auth cookie still rides along on this top-level GET
      // (SameSite is 'lax' in dev, 'strict' same-site or 'none' cross-site
      // in production — all of which permit cookies on an anchor-triggered
      // navigation like this).
      const a = document.createElement('a');
      a.href = `${API_URL}/api/export/${id}/download?type=video`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('Video download failed', err);
      setDownloadError(err instanceof Error ? err.message : 'Download failed - try again');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="studio">
      {error && (
        <div className="error-banner studio-error">
          <span>{error}</span>
          {hasFailedChunks && (
            <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void retryChunks()}>
              Retry failed parts
            </button>
          )}
          {canRestoreCaptions && !hasFailedChunks && (
            <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void rebuild(false)}>
              Restore captions
            </button>
          )}
        </div>
      )}

      <div className={`studio-body ${drawerOpen ? 'drawer-open' : 'drawer-closed'}`}>
        <div className={`studio-drawer ${drawerOpen ? 'is-open' : 'is-closed'}`}>
        <nav className="studio-rail">
          {RAIL_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item ${drawerOpen && panel === item.id ? 'active' : ''}`}
              onClick={() => {
                // Clicking the active tool again tucks the drawer away.
                if (drawerOpen && panel === item.id) setDrawerOpen(false);
                else {
                  setPanel(item.id);
                  setDrawerOpen(true);
                }
              }}
              title={item.label}
            >
              <RailIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
          <div className="rail-spacer" />
          <button
            type="button"
            className="rail-item rail-collapse"
            title={drawerOpen ? 'Hide panel' : 'Show panel'}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: drawerOpen ? 'none' : 'scaleX(-1)' }}
            >
              <path d="m14 7-5 5 5 5" />
            </svg>
            <span>{drawerOpen ? 'Hide' : 'Show'}</span>
          </button>

          <div className="rail-account">
            <button
              type="button"
              ref={accountBtnRef}
              className={`rail-account-trigger ${accountMenuOpen ? 'is-open' : ''}`}
              title={user?.name}
              onClick={() => setAccountMenuOpen((v) => !v)}
            >
              <span className="rail-account-avatar">{(user?.name || '?')[0]?.toUpperCase()}</span>
              <span className="rail-account-name">{user?.name}</span>
            </button>
            {accountMenuOpen && accountMenuPos && (
              <div
                className="rail-account-menu"
                ref={accountMenuRef}
                style={{ left: accountMenuPos.left, bottom: accountMenuPos.bottom }}
              >
                <PlanBadge
                  plan={user?.plan}
                  planName={user?.planName}
                  onUpgradeClick={() => {
                    setAccountMenuOpen(false);
                    setPricingOpen(true);
                  }}
                />
                <button
                  type="button"
                  className="rail-account-menu-logout"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Log out
                </button>
              </div>
            )}
          </div>
        </nav>

        {drawerOpen && (
        <aside className="studio-panel">
          {panel === 'captions' && (
            <>
              <div className="panel-header">
                <h3>Captions</h3>
                <span className="panel-count">{captions.length} items</span>
              </div>
              <div className="captions-tools">
              <div className="panel-controls">
                <label>
                  Language
                  <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)}>
                    <option value="keep_original">Keep original</option>
                    <option value="roman_urdu">Urdish</option>
                    <option value="roman_punjabi">Roman Punjabi</option>
                    <option value="english">English</option>
                    <option value="urdu">Urdu (اردو)</option>
                    <option value="hindi">Hindi</option>
                    <option value="arabic">Arabic</option>
                    <option value="german">German</option>
                    <option value="spanish">Spanish</option>
                    <option value="french">French</option>
                    <option value="turkish">Turkish</option>
                  </select>
                </label>
                <button type="button" className="btn primary full" disabled={!!busy} onClick={() => void rebuild()}>
                  {busy === 'rebuild'
                    ? rebuildPercent > 0
                      ? `Generating… ${rebuildPercent}%`
                      : 'Generating…'
                    : 'Regenerate Captions'}
                </button>
                <p className="muted tiny">
                  Use after changing language or if captions are missing parts of the video.
                </p>
              </div>
              </div>
            </>
          )}

          {panel === 'text' && (
            <>
              <div className="panel-header">
                <h3>Text</h3>
              </div>
              <div className="panel-scroll">
                <div className="props-section">
                  <h4 className="props-heading">Text</h4>
                  <label className="props-field">
                    Font
                    <select
                      value={style.fontFamily}
                      onChange={(e) => setStyle({ ...style, fontFamily: e.target.value })}
                    >
                      {FONT_GROUPS.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.fonts.map((f) => (
                            <option key={f} value={f} style={{ fontFamily: f }}>
                              {f}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <div className="font-preview" style={{ fontFamily: style.fontFamily }}>
                    Zindagi tab badalti hai
                  </div>
                  <label className="props-field">
                    <span>
                      Size <span className="gold-value">{style.fontSize}px</span>
                    </span>
                    <input
                      type="range"
                      min={24}
                      max={96}
                      value={style.fontSize}
                      onChange={(e) => setStyle({ ...style, fontSize: Number(e.target.value) })}
                    />
                  </label>
                  <label className="props-field">
                    Color
                    <button
                      type="button"
                      className="swatch"
                      style={{ background: style.color }}
                      onClick={() => setShowPicker((s) => !s)}
                    />
                  </label>
                  {showPicker && (
                    <HexColorPicker color={style.color} onChange={(color) => setStyle({ ...style, color })} />
                  )}
                  <label className="props-field">
                    Highlight color
                    <div className="word-swatches">
                      {HIGHLIGHT_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`word-swatch ${
                            style.highlightColor.toUpperCase() === color ? 'active' : ''
                          }`}
                          style={{ background: color }}
                          title={color}
                          onClick={() => applyDisplay({ highlightColor: color })}
                        />
                      ))}
                      <button
                        type="button"
                        className={`word-swatch custom ${showHlPicker ? 'active' : ''}`}
                        title="Custom highlight color"
                        onClick={() => setShowHlPicker((v) => !v)}
                      >
                        +
                      </button>
                    </div>
                  </label>
                  {showHlPicker && (
                    <HexColorPicker
                      color={style.highlightColor}
                      onChange={(highlightColor) => setStyle({ ...style, highlightColor })}
                    />
                  )}
                  <p className="muted tiny">
                    Used for hero words, the karaoke highlight and marked words.
                  </p>
                </div>
                <div className="props-section">
                  <h4 className="props-heading">Layout</h4>
                  <label className="props-field">
                    Position
                    <select
                      value={
                        matchPositionPreset(resolveCaptionAnchor(style)) ?? 'custom'
                      }
                      onChange={(e) => {
                        if (e.target.value === 'custom') return;
                        const position = e.target.value as CaptionPosition;
                        // Always write concrete X/Y % (CapCut-style). Export
                        // maps these to pixels — never a separate "preset only"
                        // code path that can drift from the preview.
                        applyDisplay({
                          position,
                          ...POSITION_PRESETS[position],
                        });
                      }}
                    >
                      <option value="top">Top</option>
                      <option value="center">Middle center</option>
                      <option value="bottom">Bottom</option>
                      {matchPositionPreset(resolveCaptionAnchor(style)) == null && (
                        <option value="custom">Custom (dragged)</option>
                      )}
                    </select>
                  </label>
                  <p className="muted tiny">
                    Tip: drag the caption directly on the video to place it anywhere.
                  </p>
                  <label className="props-field">
                    Animation
                    <select
                      value={style.animation}
                      onChange={(e) => applyDisplay({ animation: e.target.value })}
                    >
                      <option value="none">None</option>
                      <option value="fade">Fade</option>
                      <option value="pop">Pop</option>
                      <option value="slideUp">Slide up</option>
                      <option value="typewriter">Typewriter</option>
                      <option value="bounce">Bounce</option>
                    </select>
                  </label>
                </div>
                {isKineticTemplate(style.template) && (
                  <div className="props-section">
                    <h4 className="props-heading">Kinetic</h4>
                    <label className="props-field props-toggle">
                      <span>Text behind person</span>
                      <input
                        type="checkbox"
                        checked={!!style.behindPerson}
                        onChange={(e) => void toggleBehindPerson(e.target.checked)}
                      />
                    </label>
                    {/* Building the matte takes about a minute a clip, and
                        without a bar it reads as a hang. Same widget the
                        export uses, so the two feel like one thing. */}
                    {matteBusy && (
                      <div className="export-progress">
                        <div className="progress-bar thin">
                          <div style={{ width: `${matteBusy === 'queued' ? 0 : masksPercent}%` }} />
                        </div>
                        <span className="muted tiny">
                          {matteBusy === 'queued'
                            ? 'Preparing the person matte - queued…'
                            : `Preparing the person matte… ${masksPercent}%${matteEtaLabel}`}
                        </span>
                      </div>
                    )}
                    {!matteBusy && <p className="muted tiny">{masksHint}</p>}
                    <p className="muted tiny">
                      This sets the default for every phrase. Each row in the Phrases list has its
                      own Behind/Front button, so you can send just one phrase behind the speaker
                      without turning it on everywhere.
                    </p>
                    {style.template === 'blockbuster' && (
                      <>
                    <h4 className="props-heading">Blockbuster</h4>
                    <label className="props-field">
                      <span>
                        Glow <span className="gold-value">{Math.round(kineticParam('glow') * 100)}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        step={5}
                        value={Math.round(kineticParam('glow') * 100)}
                        onChange={(e) => setKineticParams({ glow: Number(e.target.value) / 100 })}
                      />
                    </label>
                    <label className="props-field">
                      <span>
                        Letter spacing{' '}
                        <span className="gold-value">{Math.round(kineticParam('letterSpacing') * 100)}</span>
                      </span>
                      <input
                        type="range"
                        min={-5}
                        max={30}
                        step={1}
                        value={Math.round(kineticParam('letterSpacing') * 100)}
                        onChange={(e) =>
                          setKineticParams({ letterSpacing: Number(e.target.value) / 100 })
                        }
                      />
                    </label>
                    <label className="props-field">
                      <span>
                        Tilt <span className="gold-value">{kineticParam('tilt')}°</span>
                      </span>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        step={0.5}
                        value={kineticParam('tilt')}
                        onChange={(e) => setKineticParams({ tilt: Number(e.target.value) })}
                      />
                    </label>
                    <label className="props-field">
                      <span>
                        Script size{' '}
                        <span className="gold-value">{Math.round(kineticParam('scriptScale') * 100)}%</span>
                      </span>
                      <input
                        type="range"
                        min={50}
                        max={200}
                        step={5}
                        value={Math.round(kineticParam('scriptScale') * 100)}
                        onChange={(e) =>
                          setKineticParams({ scriptScale: Number(e.target.value) / 100 })
                        }
                      />
                    </label>
                    <button type="button" className="btn ghost full" onClick={() => setKineticParams(null)}>
                      Reset to template
                    </button>
                    <p className="muted tiny">
                      Color sets the script line; Highlight color sets the heading and its glow.
                    </p>
                      </>
                    )}
                  </div>
                )}
                <div className="props-section">
                  <button type="button" className="btn primary full" onClick={() => void saveStyle()}>
                    Save Style
                  </button>
                </div>
              </div>
            </>
          )}

          {panel === 'templates' && (
            <>
              <div className="panel-header">
                <h3>Templates</h3>
                <span className="panel-count">{templateCards.length} unique</span>
              </div>
              <div className="panel-scroll">
                <div className="templates-head">
                  {/* <h4>Caption Templates</h4> */}
                  {/* <span className="muted tiny">Each style has a clear job · instant</span> */}
                </div>
                <div className="templates-list">
                  {templateCards.map((t) => {
                    const isActive =
                      style.displayMode === t.preset.displayMode &&
                      style.template === t.preset.template &&
                      style.animation === (t.preset.animation || style.animation) &&
                      (style.fontFamily || '') === (t.preset.fontFamily || '') &&
                      (style.highlightColor || '').toUpperCase() ===
                        (t.preset.highlightColor || '').toUpperCase();
                    return (
                      <TemplateCard
                        key={t.key}
                        t={t}
                        isActive={isActive}
                        onApply={() => applyDisplay({ ...t.preset, templateKey: t.key })}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {panel === 'media' && (
            <>
              <div className="panel-header">
                <h3>Media</h3>
              </div>
              <div className="panel-controls">
                <div className="media-card">
                  <div className="media-thumb">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m10 9 5 3-5 3V9Z" />
                    </svg>
                  </div>
                  <div>
                    <strong className="media-name">{projectName}</strong>
                    <p className="muted tiny">{duration ? `${formatClock(duration)} · source video` : 'Source video'}</p>
                  </div>
                </div>
                <p className="muted tiny">Secure stream - authenticated with your session token.</p>
              </div>
            </>
          )}

          {panel !== 'captions' && panel !== 'text' && panel !== 'media' && panel !== 'templates' && (
            <>
              <div className="panel-header">
                <h3>{RAIL_ITEMS.find((r) => r.id === panel)?.label}</h3>
              </div>
              <div className="panel-empty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="m12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8L12 3Z" />
                </svg>
                <p>Coming soon</p>
                <span className="muted tiny">This tool is on the roadmap.</span>
              </div>
            </>
          )}
        </aside>
        )}
        </div>

        <div className="studio-main">
        <div className="studio-main-top">
        <main className="studio-stage" ref={stageRef}>
          <div className="stage-canvas" ref={stageCanvasRef}>
          <div
            className="video-wrap"
            ref={videoWrapRef}
            style={{
              ...(wrapSize
                ? { width: wrapSize.w, height: wrapSize.h }
                : aspectNumber
                  ? {
                      aspectRatio: String(aspectNumber),
                      height: '100%',
                      width: 'auto',
                      maxWidth: '100%',
                    }
                  : { height: '100%', width: 'auto', maxWidth: '100%' }),
              ...(aspectNumber
                ? ({ ['--preview-ar']: String(aspectNumber) } as CSSProperties)
                : null),
            }}
          >
            <div className="video-filename-pill">
              <span className="video-filename-dot" />
              <span className="video-filename-name">{projectName}</span>
              <span className="video-filename-saved">· Saved</span>
            </div>
            <video
              ref={videoRef}
              playsInline
              // CORS-readable with the auth cookie, so the text-behind-person
              // preview can read its pixels (MediaPipe) without tainting the
              // canvas. The API already answers with credentialed CORS headers
              // for every route (cors({ credentials: true }) in server/index.ts).
              crossOrigin="use-credentials"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                if (!duration && e.currentTarget.duration) setDuration(e.currentTarget.duration);
                if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
                  setVideoDims(
                    preferDisplayDims(
                      {
                        w: e.currentTarget.videoWidth,
                        h: e.currentTarget.videoHeight,
                      },
                      savedVideoDims.current,
                    ),
                  );
                }
              }}
            />
            <AuthenticatedVideo key={videoSourceKey} id={id!} videoRef={videoRef} />
            {missingSource && (
              <div className="warn-banner local-source-banner" role="status">
                <span>
                  The original video file isn’t loaded. Locate it to preview and export this project.
                </span>
                <label className={`btn${locateBusy ? ' is-busy' : ''}`}>
                  {locateBusy ? 'Checking…' : 'Locate file'}
                  <input
                    type="file"
                    accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.flv"
                    hidden
                    disabled={locateBusy}
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      e.target.value = '';
                      if (picked) void locateOriginal(picked);
                    }}
                  />
                </label>
                {locateError && <span className="local-source-error">{locateError}</span>}
              </div>
            )}
            {(processing || busy === 'rebuild') && (
              <ProcessingOverlay
                stage={
                  processing
                    ? pipelineStage
                    : { current: 'translating', percent: rebuildPercent }
                }
              />
            )}
            {/* Captions size to the painted video frame, not pillarbox bars. */}
            <div
              className="video-caption-layer"
              ref={captionLayerRef}
              style={
                contentBox
                  ? {
                      left: contentBox.left,
                      top: contentBox.top,
                      width: contentBox.w,
                      height: contentBox.h,
                    }
                  : undefined
              }
            >
              {isKineticTemplate(style.template) ? (
                // Per-letter templates own the whole frame, so they replace the
                // DOM overlay entirely rather than rendering inside its box.
                // Word selection, drag-to-move and per-word styling do not
                // apply here — see KINETIC_TEMPLATES.md.
                <KineticCaptionLayer
                  captions={displayCaptions}
                  videoRef={videoRef}
                  template={style.template}
                  color={style.color}
                  highlightColor={style.highlightColor}
                  fontSize={style.fontSize}
                  params={style.kinetic}
                  behindPerson={!!style.behindPerson}
                  onChunkStyleCommit={handleChunkStyleCommit}
                />
              ) : (
                <CaptionOverlay
                  captions={displayCaptions}
                  videoRef={videoRef}
                  wrapRef={captionLayerRef}
                  style={style}
                  displayMode={style.displayMode}
                  selectedCaptionId={panel === 'captions' ? selectedId : null}
                  selectedWordIdx={selectedWordIdx}
                  onWordSelect={overlayWordSelect}
                  onWordDelete={deleteDerivedWord}
                  onSaveText={saveDerivedText}
                  onChunkStyleCommit={handleChunkStyleCommit}
                  onChunkDelete={deleteDerivedChunk}
                />
              )}
            </div>
          </div>
          </div>

          <div className="player-bar">
            {/* Uncontrolled: the rAF loop writes value + fill directly to the DOM. */}
            <input
              ref={scrubberRef}
              className="scrubber"
              type="range"
              min={0}
              max={timelineDuration}
              step={0.01}
              defaultValue={0}
              onChange={(e) => seek(Number(e.target.value))}
              onPointerDown={() => {
                scrubberHeld.current = true;
              }}
              onPointerUp={() => {
                scrubberHeld.current = false;
              }}
              style={{
                background: `linear-gradient(90deg, var(--cf-accent, var(--gold)) 0%, var(--card-hover) 0%)`,
              }}
            />
            <div className="player-controls">
              <span className="player-time">
                <span className="gold-value" ref={clockRef}>
                  {formatClock(0)}
                </span>
                <span className="muted"> / {formatClock(timelineDuration)}</span>
              </span>
              <div className="player-group transport">
                <button type="button" className="player-btn" title="Back 5s (←)" onClick={() => skip(-5)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 17 6 12l5-5M18 17l-5-5 5-5" />
                  </svg>
                </button>
                <button type="button" className="player-btn play" title="Play / Pause (Space)" onClick={togglePlay}>
                  {playing ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                    </svg>
                  )}
                </button>
                <button type="button" className="player-btn" title="Forward 5s (→)" onClick={() => skip(5)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
                  </svg>
                </button>
              </div>
              <div className="player-group">
                <select
                  className="aspect-select"
                  title="Aspect ratio of the preview and exported video"
                  value={
                    style.aspectRatio && style.aspectRatio !== 'original'
                      ? style.aspectRatio
                      : DEFAULT_ASPECT
                  }
                  onChange={(e) => {
                    const aspectRatio = e.target.value;
                    setStyle((s) => ({ ...s, aspectRatio }));
                    void api.patch(`/projects/${id}/style`, { aspectRatio });
                  }}
                >
                  {ASPECT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="player-btn speed" title="Playback speed" onClick={cycleRate}>
                  {rate}x
                </button>
                <button type="button" className="player-btn" title="Mute" onClick={toggleMute}>
                  {muted || volume === 0 ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H3v6h3l5 4V5ZM22 9l-6 6M16 9l6 6" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.4 6a9 9 0 0 1 0 12" />
                    </svg>
                  )}
                </button>
                <input
                  className="volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                />
                <button type="button" className="player-btn" title="Fullscreen" onClick={toggleFullscreen}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Phrases: always-visible right panel */}
        <aside className="phrases-panel">
          <div className="panel-header">
            <h3>Phrases</h3>
            <span className="panel-count">{captions.length} items</span>
          </div>
          <div className="panel-list" ref={listRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const c = captions[row.index];
                const words = c.text.split(/\s+/).filter(Boolean);
                const isSelected = Boolean(selectedId && selectedId === c._id);
                const wordSel = isSelected ? selectedWordIdx : null;
                const editingText = Boolean(phraseEditingId && phraseEditingId === c._id);
                return (
                  <div
                    key={c._id || row.index}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className={`caption-row ${activeCaption?._id === c._id ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${row.start}px)`,
                    }}
                    onClick={() => {
                      setSelectedId(c._id || null);
                      setSelectedWordIdx(null);
                      seek(c.start);
                    }}
                  >
                    <div className="caption-meta">
                      <span className="caption-seq">#{c.sequence}</span>
                      <span className="time">
                        {formatClock(c.start)} → {formatClock(c.end)}
                      </span>
                      <span className="phrase-count">{words.length} words</span>
                      {isKineticTemplate(style.template) &&
                        (() => {
                          // Effective depth: the chunk's own choice, else the
                          // project default. Shown for every phrase regardless
                          // of that default — this button IS how you send one
                          // phrase behind the speaker.
                          const behind = c.behindPerson ?? !!style.behindPerson;
                          return (
                            <button
                              type="button"
                              className={`chunk-depth ${behind ? 'behind' : 'front'}`}
                              title={
                                behind
                                  ? 'This phrase is drawn BEHIND the speaker. Click to bring it in front.'
                                  : 'This phrase is drawn IN FRONT of the speaker. Click to send it behind.'
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!c._id) return;
                                // Explicit true/false, never null: with the
                                // project default off, "behind" has to mean
                                // behind rather than "inherit, i.e. front".
                                void setChunkBehindPerson(c._id, !behind);
                              }}
                            >
                              {behind ? '⬤ Behind' : '○ Front'}
                            </button>
                          );
                        })()}
                    </div>
                    {editingText ? (
                      <input
                        autoFocus
                        defaultValue={c.text}
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            e.currentTarget.value = c.text;
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          setPhraseEditingId(null);
                          if (text && text !== c.text) void saveCaption(c, text);
                        }}
                      />
                    ) : (
                      <div className="phrase-words">
                        {words.map((w, i) => {
                          const role: WordRole = c.emphasis?.[i] ?? 'auto';
                          const ws = c.wordStyles?.[i];
                          return (
                            <button
                              key={`${i}-${w}`}
                              type="button"
                              className={`word-chip role-${role} ${wordSel === i ? 'selected' : ''}`}
                              style={ws?.color ? { color: ws.color } : undefined}
                              title="Click to style this word"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(c._id || null);
                                setSelectedWordIdx(wordSel === i ? null : i);
                                setPhrasePickerOpen(false);
                                seek(c.start);
                              }}
                            >
                              {role === 'hero' && <span className="word-chip-role">Hero</span>}
                              {role === 'small' && <span className="word-chip-role">Support</span>}
                              {w}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {(() => {
            const dockCaption = captions.find((c) => c._id === selectedId);
            const dockWord =
              dockCaption && selectedWordIdx != null
                ? dockCaption.text.split(/\s+/).filter(Boolean)[selectedWordIdx]
                : null;
            if (!dockCaption || selectedWordIdx == null || dockWord == null) return null;
            const selRole: WordRole = dockCaption.emphasis?.[selectedWordIdx] ?? 'auto';
            return (
              <div className="phrase-dock">
                <div className="phrase-dock-head">
                  <div className="phrase-dock-title">
                    <span className="phrase-dock-label">Word</span>
                    <strong>{dockWord}</strong>
                    <span className="muted tiny">#{dockCaption.sequence}</span>
                  </div>
                  <button
                    type="button"
                    className="phrase-btn close"
                    title="Close"
                    onClick={() => {
                      setSelectedWordIdx(null);
                      setPhrasePickerOpen(false);
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="phrase-actions">
                  <button
                    type="button"
                    className="phrase-btn"
                    title="Edit the caption text"
                    onClick={() => {
                      setPhraseEditingId(dockCaption._id || null);
                      setSelectedWordIdx(null);
                      setPhrasePickerOpen(false);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`phrase-btn role ${selRole === 'hero' ? 'active hero' : ''}`}
                    title="Make this word the big highlighted one"
                    onClick={() =>
                      void setWordRole(
                        dockCaption,
                        selectedWordIdx,
                        selRole === 'hero' ? 'auto' : 'hero',
                      )
                    }
                  >
                    Hero
                  </button>
                  <button
                    type="button"
                    className={`phrase-btn role ${selRole === 'small' ? 'active support' : ''}`}
                    title="Support - same large size as Hero, plain white (italic)"
                    onClick={() =>
                      void setWordRole(
                        dockCaption,
                        selectedWordIdx,
                        selRole === 'small' ? 'auto' : 'small',
                      )
                    }
                  >
                    Support
                  </button>
                  <button
                    type="button"
                    className={`phrase-btn role ${selRole === 'normal' ? 'active simple' : ''}`}
                    title="Keep this word plain"
                    onClick={() =>
                      void setWordRole(
                        dockCaption,
                        selectedWordIdx,
                        selRole === 'normal' ? 'auto' : 'normal',
                      )
                    }
                  >
                    Simple
                  </button>
                </div>
                <div className="phrase-tools">
                  <div className="word-tools-row">
                    <span className="word-tools-label">
                      Size{' '}
                      <span className="gold-value">
                        {dockCaption.wordStyles?.[selectedWordIdx]?.scale ?? 100}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min={50}
                      max={250}
                      step={5}
                      value={dockCaption.wordStyles?.[selectedWordIdx]?.scale ?? 100}
                      onChange={(e) =>
                        setWordStyle(dockCaption, selectedWordIdx, {
                          scale: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="word-tools-row">
                    <span className="word-tools-label">Color</span>
                    <div className="word-swatches">
                      {WORD_COLOR_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`word-swatch ${
                            dockCaption.wordStyles?.[selectedWordIdx]?.color?.toUpperCase() ===
                            color
                              ? 'active'
                              : ''
                          }`}
                          style={{ background: color }}
                          title={color}
                          onClick={() => setWordStyle(dockCaption, selectedWordIdx, { color })}
                        />
                      ))}
                      <button
                        type="button"
                        className={`word-swatch custom ${phrasePickerOpen ? 'active' : ''}`}
                        title="Custom color"
                        onClick={() => setPhrasePickerOpen((v) => !v)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {phrasePickerOpen && (
                    <HexColorPicker
                      className="word-color-picker"
                      color={dockCaption.wordStyles?.[selectedWordIdx]?.color || '#FFC43D'}
                      onChange={(color) => setWordStyle(dockCaption, selectedWordIdx, { color })}
                    />
                  )}
                  <div className="word-tools-row phrase-dock-footer">
                    <button
                      type="button"
                      className="phrase-btn"
                      title="Remove this word's custom size, color and role"
                      onClick={() => {
                        setWordStyle(dockCaption, selectedWordIdx, { scale: null, color: null });
                        if (selRole !== 'auto') {
                          void setWordRole(dockCaption, selectedWordIdx, 'auto');
                        }
                      }}
                    >
                      Clear word
                    </button>
                    <button
                      type="button"
                      className="phrase-btn"
                      title="Remove custom styles from every word in this caption"
                      onClick={() => {
                        setSelectedWordIdx(null);
                        setPhrasePickerOpen(false);
                        void resetWordRoles(dockCaption);
                      }}
                    >
                      Reset caption
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </aside>
        </div>

      <footer className="studio-timeline">
        <div className="timeline-scroll" ref={timelineScrollRef}>
          <div
            className="timeline-content"
            ref={timelineRef}
            style={{ width: Math.ceil(timelineDuration * pps) }}
          >
            <div className="timeline-ruler" onClick={seekFromTimeline}>
              {ruler.marks.map((t) => (
                <span key={t} className="ruler-mark" style={{ left: t * pps }}>
                  {formatClock(t).replace(/\.\d+$/, '')}
                </span>
              ))}
              <div className="playhead" ref={playheadRulerRef} style={{ left: 0 }} />
            </div>
            <div className="timeline-track" onClick={seekFromTimeline}>
              <TimelineBlocks
                captions={timelineCaptions}
                activeId={timelineActiveIdx >= 0 ? timelineCaptions[timelineActiveIdx]?._id : undefined}
                pps={pps}
                onSeek={seek}
                onEdit={saveDerivedText}
              />
              <div className="playhead tall" ref={playheadTrackRef} style={{ left: 0 }} />
            </div>
          </div>
        </div>
      </footer>
        </div>
      </div>

      {showPrepare && id && (
        <PrepareMediaModal
          projectId={id}
          onClose={() => setShowPrepare(false)}
          onStarted={() => {
            setShowPrepare(false);
            beginGeneration();
            setProcessing(true);
            setPipelineStage({ current: 'extracting', percent: 0 });
            didSeekToCaption.current = false;
          }}
        />
      )}

      {showExport && (
        <div className="modal-backdrop" onClick={closeExportModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Export Video</h3>
              <button type="button" className="modal-close" onClick={closeExportModal}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <label className="props-field">
                Resolution
                <select
                  value={exportQuality}
                  onChange={(e) => setExportQuality(e.target.value as typeof exportQuality)}
                  disabled={exportStatus === 'rendering'}
                >
                  <option value="720p">720p - HD</option>
                  <option value="1080p">1080p - Full HD</option>
                  <option value="2K">2K - 1440p</option>
                  {/* Admin toggles this via System > Flags > 4K export enabled */}
                  {flags.export4kEnabled && <option value="4K">4K - 2160p</option>}
                </select>
              </label>
              <label className="props-field">
                Format
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  disabled={exportStatus === 'rendering'}
                >
                  <option value="mp4">MP4 (H.264) - recommended</option>
                  <option value="webm">WebM (VP9)</option>
                </select>
              </label>
              <label className="props-field">
                Frame rate
                <select
                  value={exportFrameRate}
                  onChange={(e) => setExportFrameRate(e.target.value as typeof exportFrameRate)}
                  disabled={exportStatus === 'rendering'}
                >
                  <option value="fast">30 FPS - Faster Export</option>
                  <option value="original">60 FPS - Slower Export</option>
                </select>
              </label>
              <p className="muted tiny">
                Captions are burned into the video with your current template and word styles.
              </p>

              {/* The matte has to finish before an export with text-behind-person
                  can run. Showing its progress HERE is the point: this is where
                  someone waits, and a bare "still being prepared" gives no idea
                  whether that means seconds or an hour. */}
              {matteBusy && exportStatus !== 'rendering' && (
                <div className="export-progress">
                  <div className="progress-bar thin">
                    <div style={{ width: `${matteBusy === 'queued' ? 0 : masksPercent}%` }} />
                  </div>
                  <span className="muted tiny">
                    {matteBusy === 'queued'
                      ? 'Preparing the person matte - queued…'
                      : `Preparing the person matte… ${masksPercent}%${matteEtaLabel}. Export once it finishes.`}
                  </span>
                </div>
              )}

              {exportStatus === 'rendering' && (
                <div className="export-progress">
                  <div className="progress-bar">
                    <div style={{ width: `${exportPercent}%` }} />
                  </div>
                  <span className="muted tiny">
                    {exportWhere === 'server' && !exportDetail
                      ? `Rendering… ${exportPercent}%`
                      : exportDetail || (exportWhere ? `Rendering… ${exportPercent}%` : 'Preparing…')}
                  </span>
                </div>
              )}

              {exportStatus === 'error' && <div className="error-banner">{exportError}</div>}

              {/* The render still succeeded — a note, not a failure. */}
              {exportWarning && exportStatus !== 'error' && (
                <div className="warn-banner">{exportWarning}</div>
              )}

              {exportStatus === 'done' && (
                <div className="export-done">
                  <span className="gold-value">Render complete!</span>
                  <span className="muted tiny">
                    {deviceResult
                      ? `Rendered in ${formatSeconds(deviceResult.renderMs / 1000)} · ${formatBytes(deviceResult.sizeBytes)} · also saved under Recent exports`
                      : 'Your video is ready.'}
                  </span>
                  <button
                    type="button"
                    className="btn primary full"
                    disabled={downloading}
                    onClick={() => void downloadVideo()}
                  >
                    {downloading ? 'Downloading…' : `Download ${exportQuality} ${exportFormat.toUpperCase()}`}
                  </button>
                  {savedAs && (
                    <span className="export-saved-path" title={`Downloads/${savedAs}`}>
                      Saved to <strong>Downloads</strong> › {savedAs}
                    </span>
                  )}
                  {downloadError && <div className="error-banner">{downloadError}</div>}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                onClick={closeExportModal}
              >
                {exportStatus === 'rendering' ? 'Cancel' : 'Close'}
              </button>
              <button
                type="button"
                className="btn export"
                disabled={exportStatus === 'rendering'}
                onClick={() => void startExport()}
              >
                {exportStatus === 'rendering'
                  ? `Rendering ${exportPercent}%`
                  : exportStatus === 'done'
                    ? 'Render Again'
                    : 'Start Export'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PricingModal
        open={!!exportPlanError || pricingOpen}
        reason={exportPlanError}
        onClose={() => {
          setExportPlanError(null);
          setPricingOpen(false);
        }}
      />
    </div>
  );
}

const WORD_COLOR_SWATCHES = [
  '#FFC43D',
  '#FFFFFF',
  '#FF5A5A',
  '#4EA3FF',
  '#2ECC71',
  '#C77DFF',
  '#FF9F45',
];

const TimelineBlocks = memo(function TimelineBlocks({
  captions,
  activeId,
  pps,
  onSeek,
  onEdit,
}: {
  captions: DisplayCaption[];
  activeId?: string;
  /** Timeline zoom: pixels per second. */
  pps: number;
  onSeek: (seconds: number) => void;
  onEdit: (caption: DisplayCaption, text: string) => void;
}) {
  // Caption being edited in place after a double-click, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <>
      {captions.map((c) => {
        const editing = editingId != null && editingId === c._id;
        return (
          <div
            key={c._id || c.sequence}
            role="button"
            className={`timeline-block ${activeId === c._id ? 'active' : ''} ${editing ? 'editing' : ''}`}
            style={{
              left: c.start * pps + 1,
              width: Math.max(30, (c.end - c.start) * pps - 3),
            }}
            title={editing ? undefined : `${c.text} - double-click to edit`}
            onClick={(e) => {
              e.stopPropagation();
              if (!editing) onSeek(c.start);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingId(c._id || null);
            }}
          >
            {editing ? (
              <input
                autoFocus
                defaultValue={c.text}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = c.text;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  setEditingId(null);
                  if (text && text !== c.text) onEdit(c, text);
                }}
              />
            ) : (
              c.text
            )}
          </div>
        );
      })}
    </>
  );
});

function AuthenticatedVideo({
  id,
  videoRef,
}: {
  id: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const serverSrc = `${API_URL}/api/projects/${id}/video`;
    let cancelled = false;
    let objectUrl: string | null = null;
    // A source kept on this device (localMedia.ts / OPFS) plays straight from
    // disk — no streaming, no auth cookie, and it keeps working after the
    // server's copy is deleted. The server stream stays the fallback: projects
    // uploaded on another device, a cleared OPFS, or a codec this browser
    // cannot play (the server transcodes a preview for those — onPreviewReady).
    const streamFromServer = () => {
      if (!cancelled && v.src !== serverSrc) v.src = serverSrc;
    };
    const dropLocal = () => {
      v.removeEventListener('error', onLocalError);
      v.removeEventListener('loadedmetadata', onLocalMetadata);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const onLocalError = () => {
      // The file is here but this engine cannot open it — hand over.
      dropLocal();
      streamFromServer();
    };
    const onLocalMetadata = () => {
      // Metadata loaded but no decodable video track (HEVC without hardware
      // support plays audio only, silently, with videoWidth 0) — hand over.
      if (v.videoWidth === 0) onLocalError();
    };
    void getSourceFile(id)
      .then((file) => {
        if (cancelled) return;
        if (!file) return streamFromServer();
        objectUrl = URL.createObjectURL(file);
        v.addEventListener('error', onLocalError);
        v.addEventListener('loadedmetadata', onLocalMetadata);
        v.src = objectUrl;
      })
      .catch(streamFromServer);
    return () => {
      cancelled = true;
      dropLocal();
    };
  }, [id, videoRef]);
  return null;
}
