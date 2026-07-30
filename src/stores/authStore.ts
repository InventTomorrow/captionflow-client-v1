import { create } from 'zustand';
import { api, setAccessToken } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

interface User {
  id: string;
  email: string;
  name: string;
  plan?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    set({ user: data.user });
    connectSocket();
  },
  async register(name, email, password) {
    const { data } = await api.post('/auth/register', { name, email, password });
    setAccessToken(data.accessToken);
    set({ user: data.user });
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
        user: {
          id: data.user._id || data.user.id,
          email: data.user.email,
          name: data.user.name,
          plan: data.user.plan,
        },
        loading: false,
      });
      connectSocket();
    } catch {
      setAccessToken(null);
      set({ user: null, loading: false });
    }
  },
}));
