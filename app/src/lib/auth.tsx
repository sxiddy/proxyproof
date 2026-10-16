import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, loadApiState, setAuthToken, setDeviceKey, syncClock } from './api';
import { deviceInfo, devicePublicKey } from './device';
import { disconnectSocket } from './socket';

export type Role = 'student' | 'organiser' | 'admin';
export type User = { id: string; name: string; email: string; role: Role; rollNo: string | null };
export type DeviceStatus = 'active' | 'pending' | 'none';

type AuthState = {
  ready: boolean;
  user: User | null;
  deviceStatus: DeviceStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { name: string; email: string; password: string; role: 'student' | 'organiser'; rollNo?: string; organiserCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('none');

  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    const me = await api<{ user: User; deviceStatus: DeviceStatus; serverTime: number }>('/me');
    syncClock(me.serverTime, sentAt, Date.now());
    setUser(me.user);
    setDeviceStatus(me.deviceStatus);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [{ token }, key] = await Promise.all([loadApiState(), devicePublicKey()]);
        setDeviceKey(key);
        if (token) await refresh();
      } catch (e) {
        // Expired token: start fresh. Offline: keep the token and try again later.
        if (e instanceof ApiError && e.status === 401) await setAuthToken(null);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  const finish = useCallback(async (res: { token: string; user: User; deviceStatus: DeviceStatus }) => {
    await setAuthToken(res.token);
    setUser(res.user);
    setDeviceStatus(res.deviceStatus);
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
    setUser(null);
    setDeviceStatus('none');
  }, []);

  const value = useMemo(
    () => ({ ready, user, deviceStatus, login, register, logout, refresh }),
    [ready, user, deviceStatus, login, register, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
