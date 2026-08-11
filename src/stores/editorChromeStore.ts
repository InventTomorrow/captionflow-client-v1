import { create } from 'zustand';

export interface EditorChromeState {
  active: boolean;
  onExport: (() => void) | null;
  onDownloadSrt: (() => void) | null;
  setChrome: (patch: {
    active: boolean;
    onExport?: (() => void) | null;
    onDownloadSrt?: (() => void) | null;
  }) => void;
  clearChrome: () => void;
}

export const useEditorChromeStore = create<EditorChromeState>((set) => ({
  active: false,
  onExport: null,
  onDownloadSrt: null,
  setChrome(patch) {
    set((s) => ({
      active: patch.active,
      onExport: patch.onExport !== undefined ? patch.onExport : s.onExport,
      onDownloadSrt: patch.onDownloadSrt !== undefined ? patch.onDownloadSrt : s.onDownloadSrt,
    }));
  },
  clearChrome() {
    set({ active: false, onExport: null, onDownloadSrt: null });
  },
}));
