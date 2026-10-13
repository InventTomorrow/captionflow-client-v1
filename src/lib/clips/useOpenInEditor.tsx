import { useCallback, useState } from 'react';
import { OpenInEditorDialog } from '../../components/clips/OpenInEditorDialog';
import type { Clip } from './api';

/** A page's "Open in editor": open(projectId, clip) shows the dialog; render `dialog`. */
export function useOpenInEditor() {
  const [target, setTarget] = useState<{ projectId: string; clip: Clip } | null>(null);
  const open = useCallback((projectId: string, clip: Clip) => setTarget({ projectId, clip }), []);
  const dialog = target ? (
    <OpenInEditorDialog projectId={target.projectId} clip={target.clip} onClose={() => setTarget(null)} />
  ) : null;
  return { open, dialog };
}
