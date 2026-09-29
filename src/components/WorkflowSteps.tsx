import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, FileVideo, Gauge, Monitor } from 'lucide-react';
import { useScrollHold } from '../lib/useScrollHold';

/**
 * "How it works" — five mini-UI cards over a step line.
 *
 * Every card shows the real product: the upload copy and formats from
 * UploadPage, an Urdish transcript, a caption in the editor's Word Pop
 * look, the editor's own template names, and the Export Video dialog's
 * actual quality / format / frame-rate options and button label.
 *
 * Motion, in two layers:
 *  - Entrance (`is-live`, once): the line fills left to right and each step
 *    lights up in turn — card rises, badge flips from outline to filled,
 *    node pops, title and body fade up. Every delay derives from --i.
 *  - Life (`is-visible`, while on screen): the cards work on one shared
 *    six-second cycle — a clip drops into the upload zone, the playhead
 *    scrubs the waveform while a cursor follows the transcript line by
 *    line, the caption highlight hops word to word, a cursor walks the
 *    template list, the export renders and its button lights — plus card
 *    float, a spark on the line that flashes each node it passes, marching
 *    chevrons and the icon gestures. Highlights that move are single
 *    sliding elements (transforms), not per-row colour changes, and the
 *    icon gestures move whole elements, so the loops stay on the
 *    compositor. Row/word/step indexes ride on --k.
 */

/** A caption-free still from the templates showcase's original clip
 *  (public/landing/templates/_originals/tpl-2.mp4), so the cards show the
 *  video before captions and the caption card can draw its own. */
const FRAME_SRC = '/landing/workflow/frame-raw.jpg';

const TRANSCRIPT = [
  { t: '00:20', text: 'Subah subah chai peeyo,' },
  { t: '00:23', text: 'aur kaam pe niklo' },
  { t: '00:26', text: 'tension-free ho ke.' },
  { t: '00:28', text: 'Chalo, shuru karte hain.' },
];

/** The caption card speaks the second transcript line, word by word,
 *  set on two lines like the editor's two-line captions. */
const CAPTION_WORDS = ['aur', 'kaam', 'pe', 'niklo'];
const CAPTION_LINES = [[0, 1, 2], [3]];

/** Editor templates, ids and names as in captionTemplates.ts. */
const STYLE_OPTIONS = [
  { id: 'tiktok-classic', name: 'TikTok Classic' },
  { id: 'roboto-word', name: 'Roboto Word Pop' },
  { id: 'tiktok-pill', name: 'TikTok Pill' },
  { id: 'clean-white', name: 'Clean White' },
  { id: 'poppins-bold', name: 'Poppins Bold' },
];

/** Deterministic waveform so the card looks the same on every load. */
const WAVE = Array.from({ length: 42 }, (_, i) => {
  const a = Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
  return Math.round(18 + a * 78);
});

/** Bar heights (px) of the transcribe node icon, lucide audio-lines. */
const ICON_BARS = [3, 11, 18, 7, 13, 3];

const indexVar = (name: '--i' | '--k', value: number) => ({ [name]: value }) as CSSProperties;

/* ── Icons: lucide geometry. Moving parts are their own elements so their
   gestures are element transforms, not SVG-internal ones. ── */

const svgProps = {
  viewBox: '0 0 24 24',
  width: 26,
  height: 26,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function UploadIcon() {
  return (
    <span className="lp-flow-ico">
      <svg {...svgProps}>
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      </svg>
      <svg {...svgProps} className="lp-flow-ico-lift">
        <path d="M12 12v9" />
        <path d="m16 16-4-4-4 4" />
      </svg>
    </span>
  );
}

function TranscribeIcon() {
  return (
    <span className="lp-flow-ico lp-flow-ico-bars" aria-hidden="true">
      {ICON_BARS.map((h, i) => (
        <span key={i} className="lp-flow-ico-bar" style={{ height: h, ...indexVar('--k', i) }} />
      ))}
    </span>
  );
}

function CaptionsIcon() {
  return (
    <span className="lp-flow-ico">
      <svg {...svgProps}>
        <rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
        {['M7 11h2', 'M13 11h4', 'M7 15h4', 'M15 15h2'].map((d, i) => (
          <path key={d} d={d} className="lp-flow-ico-type" style={indexVar('--k', i)} />
        ))}
      </svg>
    </span>
  );
}

function StyleIcon() {
  return (
    <span className="lp-flow-ico lp-flow-ico-aa" aria-hidden="true">
      <span className="lp-flow-ico-aa-sans">Aa</span>
      <span className="lp-flow-ico-aa-serif">Aa</span>
    </span>
  );
}

function ExportIcon() {
  return (
    <span className="lp-flow-ico">
      <svg {...svgProps}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      </svg>
      <svg {...svgProps} className="lp-flow-ico-drop">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
      </svg>
    </span>
  );
}

/* ── Cards ── */

function UploadCard() {
  return (
    <div className="lp-flow-ui">
      <div className="lp-flow-thumb">
        <img src={FRAME_SRC} alt="" loading="lazy" />
        <span className="lp-flow-play" aria-hidden="true" />
      </div>
      <div className="lp-flow-drop">
        <svg {...svgProps} width={22} height={22}>
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
          <path d="M12 12v9" />
          <path d="m16 16-4-4-4 4" />
        </svg>
        <b>Drag &amp; drop a video, or click to browse</b>
        <small>MP4, MOV, AVI, MKV, WEBM</small>
        <span className="lp-flow-chip" aria-hidden="true">
          podcast-clip.mp4
        </span>
      </div>
    </div>
  );
}

function TranscribeCard() {
  return (
    <div className="lp-flow-ui">
      <div className="lp-flow-wave" aria-hidden="true">
        <div className="lp-flow-wave-layer">
          <div className="lp-flow-wave-inner">
            {WAVE.map((h, i) => (
              <span key={i} className="lp-flow-wave-bar" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="lp-flow-wave-layer is-played">
          <div className="lp-flow-wave-inner">
            {WAVE.map((h, i) => (
              <span key={i} className="lp-flow-wave-bar" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="lp-flow-scrub">
          <span className="lp-flow-time">
            {TRANSCRIPT.map((line, k) => (
              <span key={line.t} style={indexVar('--k', k)}>
                {line.t}
              </span>
            ))}
          </span>
          <span className="lp-flow-playhead" />
        </div>
      </div>
      <ul className="lp-flow-lines">
        <span className="lp-flow-lines-cursor" aria-hidden="true" />
        {TRANSCRIPT.map((line) => (
          <li key={line.t}>
            <span className="lp-flow-line-time">{line.t}</span>
            <span className="lp-flow-line-text">{line.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CaptionsCard() {
  return (
    <div className="lp-flow-ui">
      <div className="lp-flow-frame">
        <img src={FRAME_SRC} alt="" loading="lazy" />
        <i className="lp-flow-corner is-tl" aria-hidden="true" />
        <i className="lp-flow-corner is-tr" aria-hidden="true" />
        <i className="lp-flow-corner is-bl" aria-hidden="true" />
        <i className="lp-flow-corner is-br" aria-hidden="true" />
        <p className="lp-flow-caption">
          {CAPTION_LINES.map((line, l) => (
            <span key={l} className="lp-flow-caption-line">
              {line.map((k) => (
                <span
                  key={CAPTION_WORDS[k]}
                  className={`lp-flow-word${k === CAPTION_WORDS.length - 1 ? ' is-on' : ''}`}
                  style={indexVar('--k', k)}
                >
                  {CAPTION_WORDS[k]}
                </span>
              ))}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

function StyleCard() {
  return (
    <div className="lp-flow-ui">
      <ul className="lp-flow-styles">
        <span className="lp-flow-styles-cursor" aria-hidden="true" />
        <span className="lp-flow-styles-check" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
        {STYLE_OPTIONS.map((opt) => (
          <li key={opt.id}>
            <span className={`lp-flow-aa lp-flow-aa-${opt.id}`} aria-hidden="true">
              Aa
            </span>
            <span className="lp-flow-style-name">{opt.name}</span>
            <span className="lp-flow-radio" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExportCard() {
  return (
    <div className="lp-flow-ui">
      <p className="lp-flow-export-title">Export Video</p>
      <dl className="lp-flow-fields">
        <div>
          <Monitor size={14} strokeWidth={2} aria-hidden="true" />
          <dt>Quality</dt>
          <dd>1080p - Full HD</dd>
        </div>
        <div>
          <FileVideo size={14} strokeWidth={2} aria-hidden="true" />
          <dt>Format</dt>
          <dd>MP4 (H.264)</dd>
        </div>
        <div>
          <Gauge size={14} strokeWidth={2} aria-hidden="true" />
          <dt>Frame rate</dt>
          <dd>30 FPS - Faster Export</dd>
        </div>
      </dl>
      <div className="lp-flow-render" aria-hidden="true">
        <span className="lp-flow-render-label">
          <span>Rendering</span>
          <span>Ready</span>
        </span>
        <span className="lp-flow-render-bar">
          <span className="lp-flow-render-fill" />
        </span>
      </div>
      <span className="lp-flow-export-btn">
        <svg {...svgProps} width={16} height={16}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
        </svg>
        Download 1080p MP4
      </span>
    </div>
  );
}

const STEPS: Array<{ id: string; title: string; body: string; icon: ReactNode; card: ReactNode }> = [
  { id: 'upload', title: 'Upload', body: 'Upload your video or audio file.', icon: <UploadIcon />, card: <UploadCard /> },
  { id: 'transcribe', title: 'Transcribe', body: 'We transcribe your content in seconds.', icon: <TranscribeIcon />, card: <TranscribeCard /> },
  { id: 'captions', title: 'Generate Captions', body: 'AI generates accurate captions instantly.', icon: <CaptionsIcon />, card: <CaptionsCard /> },
  { id: 'style', title: 'Style', body: 'Choose a style that fits your content.', icon: <StyleIcon />, card: <StyleCard /> },
  { id: 'export', title: 'Export', body: 'Export and share your content.', icon: <ExportIcon />, card: <ExportCard /> },
];

export function WorkflowSteps() {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [visible, setVisible] = useState(false);
  const held = useScrollHold();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.25) setLive(true);
      },
      { threshold: [0, 0.25] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-flow${live ? ' is-live' : ''}${visible && !held ? ' is-visible' : ''}`}
      style={{ '--steps': STEPS.length } as CSSProperties}
    >
      <ol className="lp-flow-list">
        {STEPS.map((step, i) => (
          <li key={step.id} className="lp-flow-step" style={indexVar('--i', i)}>
            <div className="lp-flow-card">{step.card}</div>
            <div className="lp-flow-node-wrap">
              <span className="lp-flow-badge">{String(i + 1).padStart(2, '0')}</span>
              <span className="lp-flow-node">{step.icon}</span>
              {i < STEPS.length - 1 && (
                <span className="lp-flow-chevron" aria-hidden="true">
                  »
                </span>
              )}
              {i === 0 && <span className="lp-flow-pulse" aria-hidden="true" />}
            </div>
            <h3 className="lp-flow-title">{step.title}</h3>
            <p className="lp-flow-desc">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
