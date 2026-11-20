import { Check } from '@phosphor-icons/react';

export function WorkflowStepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="creation-steps" aria-label="Creation progress">
      {steps.map((label, index) => (
        <li key={label} className={index === current ? 'is-current' : index < current ? 'is-done' : ''} aria-current={index === current ? 'step' : undefined}>
          <span className="creation-step-number">{index < current ? <Check size={12} weight="bold" role="img" alt="Done" aria-label="Done" /> : index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
