import { create } from 'zustand';
import { api } from '../lib/api';
import type { TemplateLayout } from '../lib/templateCatalog';

export interface AppFlags {
  projectsListEnabled: boolean;
  export4kEnabled: boolean;
  exportsEnabled: boolean;
  /** Render exports in the browser (WebCodecs) when the device can; off = always the server. */
  clientExportEnabled: boolean;
  /** Send only the audio track for transcription; the video stays on the device. */
  audioOnlyUploadEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

export interface LaunchOffer {
  enabled: boolean;
  text: string;
}

export interface BankTransferDetails {
  accountTitle: string;
  bankName: string;
  accountNumber: string;
  whatsappNumber: string;
  instructions: string[];
}

const DEFAULT_FLAGS: AppFlags = {
  projectsListEnabled: false,
  export4kEnabled: true,
  exportsEnabled: true,
  clientExportEnabled: true,
  audioOnlyUploadEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: '',
};

const DEFAULT_LAUNCH_OFFER: LaunchOffer = { enabled: false, text: '' };

const DEFAULT_BANK_TRANSFER: BankTransferDetails = {
  accountTitle: '',
  bankName: '',
  accountNumber: '',
  whatsappNumber: '',
  instructions: [],
};

interface FlagsState {
  flags: AppFlags;
  launchOffer: LaunchOffer;
  bankTransfer: BankTransferDetails;
  /** Template picker order from Admin → Templates; null = the catalog's default order. */
  templateLayout: TemplateLayout | null;
  loaded: boolean;
  load: () => Promise<void>;
  /** Re-read after an admin saves (the store otherwise loads once per visit). */
  reload: () => Promise<void>;
}

/**
 * Admin-controlled feature flags (server/src/models/SystemConfig.ts), read
 * from the public `/billing/flags` endpoint so every regular-user surface
 * (nav, editor, landing page) reflects an admin's changes without a reload —
 * see AdminSystemPage.tsx for where these get edited.
 */
export const useFlagsStore = create<FlagsState>((set, get) => ({
  flags: DEFAULT_FLAGS,
  launchOffer: DEFAULT_LAUNCH_OFFER,
  bankTransfer: DEFAULT_BANK_TRANSFER,
  templateLayout: null,
  loaded: false,
  async load() {
    if (get().loaded) return;
    await get().reload();
  },
  async reload() {
    try {
      const { data } = await api.get('/billing/flags');
      set({
        flags: { ...DEFAULT_FLAGS, ...data.flags },
        launchOffer: { ...DEFAULT_LAUNCH_OFFER, ...data.launchOffer },
        bankTransfer: { ...DEFAULT_BANK_TRANSFER, ...data.bankTransfer },
        templateLayout: data.templateLayout ?? null,
        loaded: true,
      });
    } catch {
      // A failed re-read keeps what was loaded; a failed first read uses defaults.
      if (get().loaded) return;
      set({
        flags: DEFAULT_FLAGS,
        launchOffer: DEFAULT_LAUNCH_OFFER,
        bankTransfer: DEFAULT_BANK_TRANSFER,
        templateLayout: null,
        loaded: true,
      });
    }
  },
}));
