import { create } from 'zustand';

export interface EditorChromeState {
  active: boolean;
  onExport: (() => void) | null;
  /** Export button text when it does something else (clip mode: "Render clip"); null = "Export". */
  exportLabel: string | null;
  onDownloadSrt: (() => void) | null;
  setChrome: (patch: {
    active: boolean;
    onExport?: (() => void) | null;
    exportLabel?: string | null;
    onDownloadSrt?: (() => void) | null;
  }) => void;
  clearChrome: () => void;
}

export const useEditorChromeStore = create<EditorChromeState>((set) => ({
  active: false,
  onExport: null,
  exportLabel: null,
  onDownloadSrt: null,
  setChrome(patch) {
    set((s) => ({
      active: patch.active,
      onExport: patch.onExport !== undefined ? patch.onExport : s.onExport,
      exportLabel: patch.exportLabel !== undefined ? patch.exportLabel : s.exportLabel,
      onDownloadSrt: patch.onDownloadSrt !== undefined ? patch.onDownloadSrt : s.onDownloadSrt,
    }));
  },
  clearChrome() {
    set({ active: false, onExport: null, exportLabel: null, onDownloadSrt: null });
  },
}));
