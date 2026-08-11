import { create } from 'zustand';
import { api } from '../lib/api';

export interface AppFlags {
  projectsListEnabled: boolean;
  export4kEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

const DEFAULT_FLAGS: AppFlags = {
  projectsListEnabled: false,
  export4kEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: '',
};

interface FlagsState {
  flags: AppFlags;
  loaded: boolean;
  load: () => Promise<void>;
}

/**
 * Admin-controlled feature flags (server/src/models/SystemConfig.ts), read
 * from the public `/billing/flags` endpoint so every regular-user surface
 * (nav, editor, landing page) reflects an admin's changes without a reload —
 * see AdminSystemPage.tsx for where these get edited.
 */
export const useFlagsStore = create<FlagsState>((set, get) => ({
  flags: DEFAULT_FLAGS,
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const { data } = await api.get('/billing/flags');
      set({ flags: { ...DEFAULT_FLAGS, ...data.flags }, loaded: true });
    } catch {
      set({ flags: DEFAULT_FLAGS, loaded: true });
    }
  },
}));
