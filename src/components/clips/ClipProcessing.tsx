/** Progress after a clips source is uploaded, driven by project and run status. */
import { Sparkle, Waveform } from '@phosphor-icons/react';
import type { ClipRunStatus } from '../../lib/clips/api';
import { WorkflowStepper } from '../creation/WorkflowStepper';

const TRANSCRIBING = ['uploading', 'uploaded', 'processing', 'transcribing', 'translating'];
const STEPS = ['Uploaded', 'Transcribing', 'Finding clips', 'Ready'];

export function ClipProcessing({
  projectStatus, stagePercent, stageMessage, runStatus, runPercent, runMessage,
}: {
  projectStatus: string;
  stagePercent?: number;
  stageMessage?: string;
  runStatus: ClipRunStatus;
  runPercent?: number;
  runMessage?: string;
}) {
  const transcribing = TRANSCRIBING.includes(projectStatus);
  const current = transcribing || projectStatus === 'error' ? 1 : runStatus === 'ready' ? 4 : 2;
  const message = transcribing ? stageMessage : runMessage;
  const percent = transcribing ? stagePercent : runStatus === 'analyzing' ? runPercent : undefined;
  return <div className="clip-processing">
    <WorkflowStepper steps={STEPS} current={current} />
    {message && <p className="clip-processing-detail" role="status">{transcribing ? <Waveform size={16} aria-hidden="true" /> : <Sparkle size={16} aria-hidden="true" />}{message}</p>}
    {percent !== undefined && <progress className="clip-processing-progress" value={Math.max(0, Math.min(100, percent))} max={100} aria-label={transcribing ? 'Transcription progress' : 'Clip discovery progress'} />}
  </div>;
}
