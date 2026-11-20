/**
 * HelperInstallModal — pops up when a YouTube link is pasted and Asaan Caption
 * Helper (the small Windows app that fetches YouTube on the user's computer)
 * isn't running. It walks through download → open, watches for the helper,
 * and hands back as soon as it answers, so the page carries on by itself.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, CircleNotch, Desktop, DownloadSimple, Play, X } from '@phosphor-icons/react';
import {
  HELPER_DOWNLOAD_URL,
  HELPER_LAUNCH_URL,
  findHelper,
  helperSupportedHere,
  type HelperStatus,
} from '../../lib/helper/helper';

interface Props {
  /** 'outdated': a helper answers but is too old (the same download updates it). */
  reason: 'missing' | 'outdated';
  onConnected(status: HelperStatus): void;
  onClose(): void;
}

type Blocked = 'denied' | 'prompt' | null;

/** Chrome asks before a website may talk to apps on this computer; tell the user when it's blocked or pending. */
async function localAccessState(): Promise<Blocked> {
  for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      if (status.state === 'denied' || status.state === 'prompt') return status.state;
      return null;
    } catch {
      // This browser doesn't know that permission name: try the next.
    }
  }
  return null;
}

export function HelperInstallModal({ reason, onConnected, onClose }: Props) {
  const supported = helperSupportedHere();
  const [downloaded, setDownloaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const primary = useRef<HTMLAnchorElement>(null);
  const handedBack = useRef(false);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Watch for the helper until it answers, then carry on.
  useEffect(() => {
    if (!supported) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const status = await findHelper();
      if (stopped) return;
      if (status?.ready && !status.outdated) {
        setConnected(true);
        timer = setTimeout(() => {
          if (stopped || handedBack.current) return;
          handedBack.current = true;
          onConnected(status);
        }, 900);
        return;
      }
      setBlocked(await localAccessState());
      if (!stopped) timer = setTimeout(check, 2000);
    };
    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [supported, onConnected]);

  const title = reason === 'outdated' ? 'Update Asaan Caption Helper' : 'One quick step for YouTube links';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card helper-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="helper-modal-title"
        aria-describedby="helper-modal-intro"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="helper-modal-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          {!supported ? (
            <>
              <p id="helper-modal-intro" className="helper-intro">
                YouTube links work through Asaan Caption Helper, a small free app for <strong>Windows computers</strong>.
              </p>
              <p className="muted tiny">
                Open this page on a Windows computer, or download the video yourself and upload the file here instead.
              </p>
              <div className="clip-render-actions">
                <button type="button" className="btn" onClick={onClose}>
                  OK
                </button>
              </div>
            </>
          ) : (
            <>
              <p id="helper-modal-intro" className="helper-intro">
                {reason === 'outdated'
                  ? 'A newer version of the helper is needed. Install it over the old one: it takes a few seconds.'
                  : 'Asaan Caption Helper gets the video’s audio and your chosen clips straight from YouTube on this computer, so nothing waits on our servers. Install it once and every link after this just works.'}
              </p>

              <ol className="helper-steps">
                <li className={`helper-step${downloaded ? ' is-done' : ' is-current'}`}>
                  <span className="helper-step-num" aria-hidden="true">
                    {downloaded ? <CheckCircle size={18} weight="fill" /> : 1}
                  </span>
                  <div className="helper-step-body">
                    <a
                      ref={primary}
                      className="btn helper-download"
                      href={HELPER_DOWNLOAD_URL}
                      download="AsaanCaptionHelper.exe"
                      onClick={() => setDownloaded(true)}
                    >
                      <DownloadSimple size={16} weight="bold" aria-hidden="true" /> Download the helper
                    </a>
                    <span className="muted tiny">Free · Windows 10 or 11 · under 1 MB. If your browser asks, choose Keep.</span>
                  </div>
                </li>
                <li className={`helper-step${downloaded ? ' is-current' : ''}`}>
                  <span className="helper-step-num" aria-hidden="true">
                    2
                  </span>
                  <div className="helper-step-body">
                    <strong>Open the file you downloaded</strong>
                    <span className="muted tiny">
                      If Windows says “Windows protected your PC”, click <b>More info</b>, then <b>Run anyway</b>. It sets
                      itself up in a few seconds.
                    </span>
                  </div>
                </li>
                <li className={`helper-step${connected ? ' is-done' : ''}`}>
                  <span className="helper-step-num" aria-hidden="true">
                    {connected ? <CheckCircle size={18} weight="fill" /> : 3}
                  </span>
                  <div className="helper-step-body">
                    <strong>Come back here</strong>
                    <span className="muted tiny">This page carries on by itself.</span>
                  </div>
                </li>
              </ol>

              <div className={`helper-status${connected ? ' is-connected' : ''}`} role="status" aria-live="polite">
                {connected ? (
                  <>
                    <CheckCircle size={16} weight="fill" aria-hidden="true" /> Helper connected. Carrying on…
                  </>
                ) : (
                  <>
                    <CircleNotch size={16} weight="bold" className="helper-spin" aria-hidden="true" /> Waiting for the helper…
                  </>
                )}
              </div>

              {!connected && blocked === 'denied' && (
                <p className="clip-card-error" role="alert">
                  Your browser is blocking this page from talking to the helper. Click the icon at the left of the address
                  bar, allow access to apps on this device (local network), then reload the page.
                </p>
              )}
              {!connected && blocked === 'prompt' && (
                <p className="muted tiny">If your browser asks to let this site connect to apps on this device, click Allow.</p>
              )}

              {!connected && (
                <p className="muted tiny helper-installed">
                  <Desktop size={14} weight="bold" aria-hidden="true" /> Already installed?{' '}
                  <a href={HELPER_LAUNCH_URL}>
                    <Play size={12} weight="fill" aria-hidden="true" /> Start the helper
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
