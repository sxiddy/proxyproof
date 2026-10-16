import * as SecureStore from './store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, loadApiState, setAuthToken, setDeviceKey, setUnauthorizedHandler, syncClock } from './api';
import { deviceInfo, devicePublicKey } from './device';
import { disconnectSocket } from './socket';

export type Role = 'student' | 'organiser' | 'admin';
export type User = { id: string; name: string; email: string; role: Role; rollNo: string | null };
export type DeviceStatus = 'active' | 'pending' | 'none';

type AuthState = {
  ready: boolean;
  /** True while we wait on a slow (probably sleeping) server at launch. */
  waking: boolean;
  user: User | null;
  deviceStatus: DeviceStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { name: string; email: string; password: string; role: 'student' | 'organiser'; rollNo?: string; organiserCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const USER_KEY = 'pp.user';

// Remember who's logged in, so a slow or offline server at launch doesn't look like a logout.
const cacheUser = (u: User | null, status: DeviceStatus) =>
  (u ? SecureStore.setItemAsync(USER_KEY, JSON.stringify({ u, status })) : SecureStore.deleteItemAsync(USER_KEY)).catch(() => {});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [waking, setWaking] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('none');

  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    // Free-tier hosting can take most of a minute to wake up.
    const me = await api<{ user: User; deviceStatus: DeviceStatus; serverTime: number }>('/me', { timeoutMs: 60_000 });
    syncClock(me.serverTime, sentAt, Date.now());
    setUser(me.user);
    setDeviceStatus(me.deviceStatus);
    cacheUser(me.user, me.deviceStatus);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [{ token }, key, cached] = await Promise.all([loadApiState(), devicePublicKey(), SecureStore.getItemAsync(USER_KEY)]);
        setDeviceKey(key);
        if (!token) return;
        const saved = cached ? JSON.parse(cached) : null;
        if (saved?.u) {
          // Show the app straight away and catch up in the background.
          setUser(saved.u);
          setDeviceStatus(saved.status ?? 'none');
          setReady(true);
        }
        const slow = setTimeout(() => setWaking(true), 2500);
        try {
          await refresh();
        } finally {
          clearTimeout(slow);
          setWaking(false);
        }
      } catch (e) {
        // Expired token: start fresh. Offline: keep the cached user and try again later.
        if (e instanceof ApiError && e.status === 401) {
          await setAuthToken(null);
          cacheUser(null, 'none');
          setUser(null);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  const finish = useCallback(async (res: { token: string; user: User; deviceStatus: DeviceStatus }) => {
    await setAuthToken(res.token);
    setUser(res.user);
    setDeviceStatus(res.deviceStatus);
    cacheUser(res.user, res.deviceStatus);
    refresh().catch(() => {});
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const device = await deviceInfo();
    await finish(await api('/auth/login', { body: { email, password, device } }));
  }, [finish]);

  const register = useCallback<AuthState['register']>(async (body) => {
    const device = await deviceInfo();
    await finish(await api('/auth/register', { body: { ...body, device } }));
  }, [finish]);

  const logout = useCallback(async () => {
    disconnectSocket();
    await setAuthToken(null);
    cacheUser(null, 'none');
    setUser(null);
    setDeviceStatus('none');
  }, []);

  // A token the server no longer accepts: log out, and the layout sends us to the welcome screen.
  useEffect(() => {
    setUnauthorizedHandler(() => { logout().catch(() => {}); });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(
    () => ({ ready, waking, user, deviceStatus, login, register, logout, refresh }),
    [ready, waking, user, deviceStatus, login, register, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
