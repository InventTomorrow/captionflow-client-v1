import { create } from 'zustand';

export interface EditorChromeState {
  active: boolean;
  projectName: string;
  onExport: (() => void) | null;
  onDownloadSrt: (() => void) | null;
  setChrome: (patch: {
    active: boolean;
    projectName?: string;
    onExport?: (() => void) | null;
    onDownloadSrt?: (() => void) | null;
  }) => void;
  clearChrome: () => void;
}

export const useEditorChromeStore = create<EditorChromeState>((set) => ({
  active: false,
  projectName: '',
  onExport: null,
  onDownloadSrt: null,
  setChrome(patch) {
    set((s) => ({
      active: patch.active,
      projectName: patch.projectName ?? s.projectName,
      onExport: patch.onExport !== undefined ? patch.onExport : s.onExport,
      onDownloadSrt: patch.onDownloadSrt !== undefined ? patch.onDownloadSrt : s.onDownloadSrt,
    }));
  },
  clearChrome() {
    set({ active: false, projectName: '', onExport: null, onDownloadSrt: null });
  },
}));
