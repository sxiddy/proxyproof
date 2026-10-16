import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const URL_KEY = 'pp.apiUrl';
const TOKEN_KEY = 'pp.authToken';

export const DEFAULT_API_URL: string = (Constants.expoConfig?.extra as any)?.apiUrl ?? 'http://192.168.1.10:4000';

let baseUrl = DEFAULT_API_URL;
let authToken: string | null = null;
let deviceKey: string | null = null;
/** serverTime - phoneTime, so tokens line up even if the phone clock is off. */
let clockOffset = 0;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function loadApiState() {
  const [url, token] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  if (url) baseUrl = url;
  authToken = token;
  return { url: baseUrl, token };
}

export const getApiUrl = () => baseUrl;
export const getAuthToken = () => authToken;
export const serverNow = () => Date.now() + clockOffset;
export const setDeviceKey = (k: string) => { deviceKey = k; };

export async function setApiUrl(url: string) {
  baseUrl = url.trim().replace(/\/+$/, '') || DEFAULT_API_URL;
  if (baseUrl === DEFAULT_API_URL) await SecureStore.deleteItemAsync(URL_KEY);
  else await SecureStore.setItemAsync(URL_KEY, baseUrl);
}

export async function setAuthToken(token: string | null) {
  authToken = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function syncClock(serverTime: number, sentAt: number, receivedAt: number) {
  clockOffset = serverTime - (sentAt + receivedAt) / 2;
}

type Opts = { method?: string; body?: unknown; timeoutMs?: number };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (deviceKey) headers['x-device-key'] = deviceKey;

  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your internet (or the server address in Settings).");
  } finally {
    clearTimeout(timer);
  }

  if (path.endsWith('.csv') && res.ok) return (await res.text()) as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 429) throw new ApiError(429, 'slow_down', 'Too many tries. Give it a minute.');
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
