import { create } from 'zustand';
import { ensureOneHeroOneSupport } from '../lib/emphasisRoles';

export type WordRole = 'auto' | 'hero' | 'small' | 'normal';

/** Per-word manual overrides: scale is font size % (100 = normal), color any hex. */
export interface WordStyle {
  scale?: number | null;
  color?: string | null;
}

export interface Caption {
  _id?: string;
  sequence: number;
  start: number;
  end: number;
  text: string;
  originalText?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  /** Per-word display role aligned with text.split(whitespace). Empty = all auto. */
  emphasis?: WordRole[];
  /** Per-word size/color overrides aligned with text.split(whitespace). */
  wordStyles?: WordStyle[];
  /** Whole-chunk font-size multiplier (100 = normal), on top of style.fontSize. */
  sizeScale?: number | null;
  /** Whole-chunk position override (% of canvas, center anchor) — composes
   *  with the global style position the same way sizeScale composes with
   *  style.fontSize. Null/undefined = use the project's style position. */
  offsetX?: number | null;
  offsetY?: number | null;
  /** Whole-chunk text-behind-person override. Null/undefined = follow the
   *  project's style.behindPerson; true/false force this chunk behind or in
   *  front of the speaker. */
  behindPerson?: boolean | null;
}

interface StageState {
  current: string;
  percent: number;
  message?: string;
}

interface CaptionState {
  captions: Caption[];
  partialChunks: Record<number, Caption[]>;
  loadingState: 'idle' | 'processing' | 'ready' | 'error';
  /** Once true, ignore late captions:partial events (they were overwriting the final list). */
  finalized: boolean;
  stage: StageState;
  chunkStatuses: Record<number, string>;
  silent?: boolean;
  setCaptions: (captions: Caption[]) => void;
  beginGeneration: () => void;
  receivePartialChunk: (chunkIndex: number, partial: Caption[]) => void;
  setStage: (stage: StageState) => void;
  setChunkStatus: (index: number, status: string) => void;
  setComplete: (total: number, silent?: boolean) => void;
  setError: (message?: string) => void;
  reset: () => void;
}

function mergePartials(partialChunks: Record<number, Caption[]>) {
  const merged = Object.keys(partialChunks)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((k) => partialChunks[k]);
  // Re-sequence so the phrases list / timeline stay ordered while streaming.
  return merged.map((c, i) => ({ ...c, sequence: i + 1 }));
}

export const useCaptionStore = create<CaptionState>((set) => ({
  captions: [],
  partialChunks: {},
  loadingState: 'idle',
  finalized: false,
  stage: { current: 'idle', percent: 0 },
  chunkStatuses: {},
  setCaptions: (captions) =>
    set({
      // Normalize so Phrases always shows exactly one Hero + one Support tag.
      captions: captions.map((c) => ({
        ...c,
        emphasis: ensureOneHeroOneSupport(c.text, c.emphasis),
      })),
      loadingState: 'ready',
      finalized: true,
      partialChunks: {},
    }),
  beginGeneration: () =>
    set({
      finalized: false,
      partialChunks: {},
      captions: [],
      loadingState: 'processing',
      stage: { current: 'extracting', percent: 0 },
      silent: false,
    }),
  receivePartialChunk: (chunkIndex, partial) =>
    set((state) => {
      // Final DB captions already applied — a late socket partial must not
      // wipe them back to an incomplete chunk merge.
      if (state.finalized) return state;
      const partialChunks = { ...state.partialChunks, [chunkIndex]: partial };
      return {
        partialChunks,
        captions: mergePartials(partialChunks),
        loadingState: 'processing',
      };
    }),
  setStage: (stage) =>
    set((state) => ({
      stage,
      // Don't reopen partial acceptance after finalize — stage:ready can race
      // with a late captions:partial and wipe the full list.
      loadingState: stage.current === 'ready' ? 'ready' : 'processing',
      finalized: stage.current === 'ready' ? true : state.finalized,
    })),
  setChunkStatus: (index, status) =>
    set((state) => ({ chunkStatuses: { ...state.chunkStatuses, [index]: status } })),
  setComplete: (total, silent) =>
    set({
      loadingState: 'ready',
      finalized: true,
      partialChunks: {},
      silent,
      stage: { current: 'ready', percent: 100, message: `${total} captions` },
    }),
  setError: () => set({ loadingState: 'error' }),
  reset: () =>
    set({
      captions: [],
      partialChunks: {},
      loadingState: 'idle',
      finalized: false,
      stage: { current: 'idle', percent: 0 },
      chunkStatuses: {},
      silent: false,
    }),
}));
