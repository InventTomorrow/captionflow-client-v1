import { create } from 'zustand';
import { api } from '../lib/api';

export interface AppFlags {
  projectsListEnabled: boolean;
  export4kEnabled: boolean;
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
  launchOffer: DEFAULT_LAUNCH_OFFER,
  bankTransfer: DEFAULT_BANK_TRANSFER,
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const { data } = await api.get('/billing/flags');
      set({
        flags: { ...DEFAULT_FLAGS, ...data.flags },
        launchOffer: { ...DEFAULT_LAUNCH_OFFER, ...data.launchOffer },
        bankTransfer: { ...DEFAULT_BANK_TRANSFER, ...data.bankTransfer },
        loaded: true,
      });
    } catch {
      set({ flags: DEFAULT_FLAGS, launchOffer: DEFAULT_LAUNCH_OFFER, bankTransfer: DEFAULT_BANK_TRANSFER, loaded: true });
    }
  },
}));
