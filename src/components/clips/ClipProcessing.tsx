/**
 * ClipProcessing — where a Clips project is: transcribing → finding moments →
 * ready. Driven by the project's own stage (stage:update) and the clips run
 * status (clips:status).
 */
import type { ClipRunStatus } from '../../lib/clips/api';

type StepState = 'done' | 'active' | 'todo' | 'error';

const TRANSCRIBING = ['uploading', 'uploaded', 'processing', 'transcribing', 'translating'];

export function ClipProcessing({
  projectStatus,
  stagePercent,
  stageMessage,
  runStatus,
  runPercent,
  runMessage,
}: {
  projectStatus: string;
  stagePercent?: number;
  stageMessage?: string;
  runStatus: ClipRunStatus;
  runPercent?: number;
  runMessage?: string;
}) {
  const transcribing = TRANSCRIBING.includes(projectStatus);
  const transcriptFailed = projectStatus === 'error';
  const steps: Array<{ label: string; state: StepState; detail?: string; percent?: number }> = [
    { label: 'Uploaded', state: 'done' },
    {
      label: 'Transcribing',
      state: transcriptFailed ? 'error' : transcribing ? 'active' : 'done',
      detail: transcribing ? stageMessage : undefined,
      percent: transcribing ? stagePercent : undefined,
    },
    {
      label: 'Finding the best moments',
      state:
        runStatus === 'error'
          ? 'error'
          : runStatus === 'ready'
            ? 'done'
            : !transcribing && !transcriptFailed
              ? 'active'
              : 'todo',
      detail: runStatus === 'analyzing' || runStatus === 'queued' ? runMessage : undefined,
      percent: runStatus === 'analyzing' ? runPercent : undefined,
    },
    { label: 'Ready', state: runStatus === 'ready' ? 'done' : 'todo' },
  ];
  return (
    <ol className="clip-steps" aria-label="Clips progress">
      {steps.map((s) => (
        <li key={s.label} className={`clip-step is-${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
          <span className="clip-step-dot" aria-hidden="true" />
          <span className="clip-step-text">
            <span className="clip-step-label">{s.label}</span>
            {s.detail && <span className="clip-step-detail">{s.detail}</span>}
            {s.percent !== undefined && (
              <span
                className="clip-step-bar"
                role="progressbar"
                aria-valuenow={Math.round(s.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.max(2, Math.min(100, s.percent))}%` }} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
