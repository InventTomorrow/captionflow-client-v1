import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useFlagsStore } from '../../stores/flagsStore';
import './legal.css';

/**
 * Privacy Policy, Terms of Service and Cookie Policy — one page, three
 * documents, linked from the landing footer and the sign-up form. The text
 * describes what the app actually does (retention windows from server
 * config.ts, the two httpOnly auth cookies, device-only media) — keep it in
 * step when those change.
 */

export type LegalDoc = 'privacy' | 'terms' | 'cookies';

const EFFECTIVE = '27 October 2026';

interface Section {
  id: string;
  heading: string;
  body: ReactNode;
}

interface Doc {
  title: string;
  intro: string;
  summary: string[];
  sections: Section[];
}

const TABS: { doc: LegalDoc; label: string; path: string }[] = [
  { doc: 'privacy', label: 'Privacy', path: '/privacy' },
  { doc: 'terms', label: 'Terms', path: '/terms' },
  { doc: 'cookies', label: 'Cookies', path: '/cookies' },
];

function buildDocs(contact: ReactNode): Record<LegalDoc, Doc> {
  return {
    privacy: {
      title: 'Privacy Policy',
      intro:
        'This policy explains what Asaan Caption collects when you use our website and app, why, who else handles it, and how long we keep it.',
      summary: [
        'Your videos stay on your device wherever possible. What we upload is used to make your captions, then deleted on a fixed schedule.',
        'We never sell your data or use it for advertising.',
        'We use a small number of service providers, such as speech-to-text and email, only to run Asaan Caption.',
        'You can delete your projects at any time, and ask us to delete your account.',
      ],
      sections: [
        {
          id: 'who-we-are',
          heading: 'Who we are',
          body: (
            <p>
              Asaan Caption (“we”, “us”) is a captioning and short-clip service built in Pakistan. We are
              responsible for the personal data described in this policy. {contact}
            </p>
          ),
        },
        {
          id: 'what-we-collect',
          heading: 'What we collect',
          body: (
            <>
              <dl className="legal-defs">
                <dt>Account details</dt>
                <dd>
                  Your name, email address and password. We store the password only as a one-way hash, so
                  no one at Asaan Caption can read it.
                </dd>
                <dt>Media you give us</dt>
                <dd>
                  The audio of the videos you caption (or the whole video, when audio alone can’t be used),
                  and links you paste to make clips from. For a link, we download only the audio to
                  transcribe it, and later only the parts you turn into clips.
                </dd>
                <dt>What we make for you</dt>
                <dd>
                  Transcripts, captions, translations, chosen clips, your caption styles, and exported
                  videos.
                </dd>
                <dt>Plan and payment records</dt>
                <dd>
                  Your plan, its dates, minutes used, and the bank-transfer details you send us to confirm a
                  payment. We never ask for or store card numbers.
                </dd>
                <dt>Technical data</dt>
                <dd>
                  Your IP address, browser type and request times, which our servers record to keep the
                  service secure and working.
                </dd>
              </dl>
            </>
          ),
        },
        {
          id: 'on-your-device',
          heading: 'What stays on your device',
          body: (
            <p>
              Your original videos, clip parts and editing work are kept in your browser’s own storage on
              your device, not on our servers. That is why a project may only open on the device where you
              made it. Clearing this site’s data in your browser removes them permanently.
            </p>
          ),
        },
        {
          id: 'how-we-use-it',
          heading: 'How we use it',
          body: (
            <ul>
              <li>To create your account, sign you in and keep it secure.</li>
              <li>To transcribe, caption, translate and find clips in the media you give us.</li>
              <li>To apply your plan, count minutes and confirm payments.</li>
              <li>To send account emails, such as email verification and password reset.</li>
              <li>To fix problems, prevent abuse and improve the service.</li>
            </ul>
          ),
        },
        {
          id: 'who-handles-it',
          heading: 'Who else handles your data',
          body: (
            <>
              <p>
                We share data only with providers that help us run Asaan Caption, and only what each needs
                for its job:
              </p>
              <ul>
                <li>
                  <strong>Deepgram and OpenAI</strong> receive audio and text to transcribe, translate,
                  highlight words and suggest clips.
                </li>
                <li>
                  <strong>Resend</strong> sends our account emails.
                </li>
                <li>
                  <strong>MongoDB Atlas</strong> and our hosting provider store and serve account and
                  project data.
                </li>
                <li>
                  <strong>Google Fonts</strong> serves the typefaces used for captions, so Google can see
                  your IP address when they load.
                </li>
                <li>
                  <strong>YouTube, TikTok, Instagram, Vimeo and X</strong>: when you paste a link, we fetch
                  the video from that site, and YouTube videos play through YouTube’s privacy-enhanced
                  player.
                </li>
              </ul>
              <p>
                Some providers process data outside Pakistan. We do not sell personal data. We share it with
                authorities only when the law requires us to.
              </p>
            </>
          ),
        },
        {
          id: 'how-long',
          heading: 'How long we keep it',
          body: (
            <ul>
              <li>Uploaded audio: up to 7 days.</li>
              <li>Uploaded video, when needed: up to 30 days.</li>
              <li>Audio downloaded from a link: deleted once it has been transcribed.</li>
              <li>Exported videos on our servers: up to 24 hours.</li>
              <li>
                Captions and transcripts: up to 30 days, or sooner when you delete the project’s last
                video. Captions for clips are kept as long as the clips exist.
              </li>
              <li>Account details: for as long as your account is open.</li>
              <li>Payment records: as long as tax and accounting law requires.</li>
            </ul>
          ),
        },
        {
          id: 'your-choices',
          heading: 'Your choices',
          body: (
            <p>
              You can delete projects and clips in the app at any time. You can also ask us for a copy of
              your data, ask us to correct it, or ask us to close your account and delete its data. We
              answer within 30 days. {contact}
            </p>
          ),
        },
        {
          id: 'security',
          heading: 'Security',
          body: (
            <p>
              We use encrypted connections, hashed passwords, and sign-in cookies that scripts on the page
              cannot read. No service is perfectly secure, so please use a strong password that you
              don’t use anywhere else.
            </p>
          ),
        },
        {
          id: 'children',
          heading: 'Children',
          body: (
            <p>
              Asaan Caption is not meant for children under 13, and we don’t knowingly collect their
              data. If you think a child has given us data, contact us and we will delete it.
            </p>
          ),
        },
        {
          id: 'changes',
          heading: 'Changes to this policy',
          body: (
            <p>
              When we change this policy we update the date at the top. If a change materially affects how
              we use your data, we will tell you by email or in the app before it applies.
            </p>
          ),
        },
      ],
    },

    terms: {
      title: 'Terms of Service',
      intro:
        'These terms are the agreement between you and Asaan Caption for using our website and app. Please read them before you create an account.',
      summary: [
        'You own your videos and captions. We only use them to provide the service.',
        'Only upload or link videos you have the right to use.',
        'Captions and translations are made automatically and can contain mistakes, so check them before you publish.',
        'Paid plans start once we confirm your bank transfer.',
      ],
      sections: [
        {
          id: 'agreement',
          heading: 'Agreeing to these terms',
          body: (
            <p>
              By creating an account or using Asaan Caption, you agree to these terms and to our{' '}
              <Link to="/privacy">Privacy Policy</Link>. If you don’t agree, please don’t use the service.
            </p>
          ),
        },
        {
          id: 'account',
          heading: 'Your account',
          body: (
            <ul>
              <li>You must be at least 13. If you are under 18, you need a parent’s or guardian’s permission.</li>
              <li>Give accurate details and keep your password private. You are responsible for activity on your account.</li>
              <li>An account is for one person. Don’t share it or create accounts automatically.</li>
            </ul>
          ),
        },
        {
          id: 'plans',
          heading: 'Plans, minutes and payment',
          body: (
            <>
              <p>
                Each plan includes a set number of transcription minutes and features, as shown on our
                pricing section when you buy it. Paid plans and passes are paid by bank transfer, and they
                start once we have confirmed your payment.
              </p>
              <p>
                If processing fails on our side, the minutes it used are returned to your account
                automatically. Once a plan is active, payments are not refundable unless the law requires
                a refund or we can’t provide the service you paid for. If something went wrong, contact us
                and we will look into it.
              </p>
            </>
          ),
        },
        {
          id: 'your-content',
          heading: 'Your content',
          body: (
            <>
              <p>
                You keep all rights to the videos you upload or link and to the captions and clips you make.
                You give us permission to store, process and change them only as needed to provide
                Asaan Caption to you, for example to transcribe, translate and render them.
              </p>
              <p>
                You must have the right to use everything you upload or link. Pasting a link to someone
                else’s video doesn’t give you the right to republish it.
              </p>
            </>
          ),
        },
        {
          id: 'acceptable-use',
          heading: 'Acceptable use',
          body: (
            <>
              <p>Don’t use Asaan Caption to:</p>
              <ul>
                <li>break the law, or infringe anyone’s copyright, privacy or other rights;</li>
                <li>
                  make or share content that sexually exploits children, promotes violence or terrorism, or
                  harasses people;
                </li>
                <li>
                  disrupt or overload the service, get around plan limits, or access other users’ data;
                </li>
                <li>copy, resell or reverse-engineer the service, or scrape it with automated tools.</li>
              </ul>
              <p>We may remove content or suspend accounts that break these rules.</p>
            </>
          ),
        },
        {
          id: 'automatic-results',
          heading: 'Automatic results',
          body: (
            <p>
              Transcripts, captions, translations and clip suggestions are generated automatically and may
              be inaccurate, especially with background noise, mixed languages or names. Review them before
              you publish. You are responsible for what you publish.
            </p>
          ),
        },
        {
          id: 'service-changes',
          heading: 'Changes to the service',
          body: (
            <p>
              We are always improving Asaan Caption, so features may change, be added or be removed. We aim
              to keep the service available but can’t promise it will always be uninterrupted or error-free.
            </p>
          ),
        },
        {
          id: 'ending',
          heading: 'Ending your use',
          body: (
            <p>
              You can stop using Asaan Caption and ask us to close your account at any time. We may suspend
              or close an account that breaks these terms or puts the service or other users at risk.
              Wherever we can, we will tell you why.
            </p>
          ),
        },
        {
          id: 'liability',
          heading: 'Liability',
          body: (
            <p>
              We provide Asaan Caption “as is”. As far as the law allows, we are not liable for indirect
              losses, such as lost profits or lost content. Our total liability to you is limited to what
              you paid us in the three months before the claim. Keep your own copies of anything important.
              Nothing in these terms limits rights you have that can’t be excluded by law.
            </p>
          ),
        },
        {
          id: 'law',
          heading: 'Governing law',
          body: <p>These terms are governed by the laws of Pakistan, and its courts handle any disputes.</p>,
        },
        {
          id: 'changes',
          heading: 'Changes to these terms',
          body: (
            <p>
              When we change these terms we update the date at the top and, for important changes, tell you
              in the app or by email first. If you keep using the service after that, the new terms apply.{' '}
              {contact}
            </p>
          ),
        },
      ],
    },

    cookies: {
      title: 'Cookie Policy',
      intro:
        'This policy explains the cookies and browser storage Asaan Caption uses. It’s short, because we don’t use advertising or tracking cookies.',
      summary: [
        'We use two cookies, and only to keep you signed in.',
        'Your browser also stores your videos and some settings, so the editor works on your device.',
        'We don’t use advertising, analytics or cross-site tracking cookies.',
      ],
      sections: [
        {
          id: 'cookies-we-set',
          heading: 'Cookies we set',
          body: (
            <>
              <p>
                Both cookies are strictly necessary. Scripts on the page cannot read them, and they are
                only sent to our own server.
              </p>
              <div className="legal-table-wrap">
                <table className="legal-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">What it does</th>
                      <th scope="col">How long it lasts</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td data-label="Name"><code>cf_access</code></td>
                      <td data-label="What it does">Proves you are signed in when you use the app.</td>
                      <td data-label="How long it lasts">15 minutes, renewed while you use the app</td>
                    </tr>
                    <tr>
                      <td data-label="Name"><code>cf_refresh</code></td>
                      <td data-label="What it does">
                        Keeps you signed in between visits, without asking for your password each time.
                      </td>
                      <td data-label="How long it lasts">7 days</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ),
        },
        {
          id: 'browser-storage',
          heading: 'Other browser storage',
          body: (
            <>
              <p>The app also stores things in your browser that never leave your device:</p>
              <ul>
                <li>your videos, clip parts and editing work, so you can caption and export them on your device;</li>
                <li>clip thumbnails, so your clip library loads quickly;</li>
                <li>small settings, such as where your last export was saved and progress on unfinished uploads.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'third-parties',
          heading: 'Other sites',
          body: (
            <p>
              Caption fonts load from Google Fonts. YouTube clips play through YouTube’s privacy-enhanced
              player, which doesn’t set tracking cookies unless you play the video. Their own policies apply
              to what they do.
            </p>
          ),
        },
        {
          id: 'your-control',
          heading: 'Your control',
          body: (
            <p>
              You can block or delete cookies and site data in your browser’s settings. If you block our
              cookies you won’t be able to sign in. Deleting this site’s data also removes the videos and
              editing work stored on your device. {contact}
            </p>
          ),
        },
      ],
    },
  };
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const whatsapp = useFlagsStore((s) => s.bankTransfer.whatsappNumber);
  const loadFlags = useFlagsStore((s) => s.load);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [doc]);

  const contact = whatsapp ? (
    <>
      Questions? Message us on{' '}
      <a href={`https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
      .
    </>
  ) : (
    <>Questions? Contact us through the details on our website.</>
  );

  const current = buildDocs(contact)[doc];

  useEffect(() => {
    document.title = `${current.title} · Asaan Caption`;
  }, [current.title]);

  return (
    <div className="legal">
      <header className="legal-bar">
        <Link to="/" className="legal-home" aria-label="Asaan Caption home">
          <img src="/logo.png" alt="Asaan Caption" />
        </Link>
        <nav className="legal-switch" aria-label="Legal documents">
          {TABS.map((t) => (
            <NavLink key={t.doc} to={t.path} className="legal-switch-item">
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="legal-body">
        <aside className="legal-toc" aria-label="On this page">
          <p className="legal-toc-title">On this page</p>
          <ul>
            {current.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.heading}</a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="legal-doc">
          <h1>{current.title}</h1>
          <p className="legal-effective">Effective {EFFECTIVE}</p>
          <p className="legal-intro">{current.intro}</p>

          <section className="legal-summary" aria-labelledby="legal-summary-heading">
            <h2 id="legal-summary-heading">The short version</h2>
            <ul>
              {current.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {current.sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2>{s.heading}</h2>
              {s.body}
            </section>
          ))}

          <footer className="legal-foot">
            <Link to="/">Back to Asaan Caption</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
