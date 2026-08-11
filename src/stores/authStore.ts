import { create } from 'zustand';
import { api, setAccessToken } from '../lib/api';
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

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
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
    setAccessToken(data.accessToken);
    set({ user: mapUser(data.user) });
    connectSocket();
  },
  async register(name, email, password) {
    const { data } = await api.post('/auth/register', { name, email, password });
    setAccessToken(data.accessToken);
    set({ user: mapUser(data.user) });
    connectSocket();
  },
  async logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      disconnectSocket();
      set({ user: null });
    }
  },
  async bootstrap() {
    try {
      const token = localStorage.getItem('cf_access');
      if (!token) {
        set({ loading: false, user: null });
        return;
      }
      setAccessToken(token);
      const { data } = await api.get('/auth/me');
      set({
        user: mapUser(data.user),
        loading: false,
      });
      connectSocket();
    } catch {
      setAccessToken(null);
      set({ user: null, loading: false });
    }
  },
}));
