import { create } from 'zustand';
import { api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

export interface PlanLimits {
  minutesPerMonth?: number;
  maxExportQuality?: string;
  maxFileSizeGb?: number;
  maxProjects?: number;
  bulkUpload?: boolean;
  priorityProcessing?: boolean;
  brandKits?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  plan?: string;
  planName?: string;
  planId?: string;
  role?: 'user' | 'admin' | 'support';
  status?: string;
  limits?: PlanLimits;
}

/** What sign-up led to. */
export interface RegisterResult {
  /**
   * True: the account exists but nobody is signed in — the emailed link has to
   * be opened first. False: signed in, as sign-up always used to be (a server
   * with verification switched off, or one that predates it).
   */
  verificationRequired: boolean;
  /** False when the account was made but the email could not be sent. */
  emailSent: boolean;
  /** How long the emailed link lasts, when the server says. */
  expiresInHours?: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

function mapUser(raw: Record<string, unknown>): User {
  return {
    id: String(raw._id || raw.id),
    email: String(raw.email || ''),
    name: String(raw.name || ''),
    plan: raw.plan as string | undefined,
    planName: raw.planName as string | undefined,
    planId: raw.planId ? String(raw.planId) : undefined,
    role: (raw.role as User['role']) || 'user',
    status: raw.status as string | undefined,
    limits: raw.limits as PlanLimits | undefined,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    set({ user: mapUser(data.user) });
    connectSocket();
  },
  async register(name, email, password) {
    const { data } = await api.post('/auth/register', { name, email, password });
    // Decided by the reply, not assumed: client and server deploy separately,
    // and this has to work against a server on either side of the feature.
    if (data?.verificationRequired) {
      return {
        verificationRequired: true,
        emailSent: data.emailSent !== false,
        expiresInHours: typeof data.expiresInHours === 'number' ? data.expiresInHours : undefined,
      };
    }
    set({ user: mapUser(data.user) });
    connectSocket();
    return { verificationRequired: false, emailSent: false };
  },
  async logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      disconnectSocket();
      set({ user: null });
    }
  },
  async bootstrap() {
    // No token in JS to check — the access/refresh cookies are httpOnly, so
    // the only way to know if a session exists is to ask the server.
    try {
      const { data } = await api.get('/auth/me');
      set({
        user: mapUser(data.user),
        loading: false,
      });
      connectSocket();
    } catch {
      set({ user: null, loading: false });
    }
  },
}));
