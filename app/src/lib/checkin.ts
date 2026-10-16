import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, serverNow } from './api';
import { signMessage } from './device';
import { checkinMessage, decodePayload } from './token';

export type Marked = { sessionId: string; courseName: string; markedAt: string; method: 'ble' | 'manual' };

export type CheckinState =
  | { phase: 'listening' }
  | { phase: 'hearing'; rssi: number }
  | { phase: 'checking'; rssi: number }
  | { phase: 'retry'; rssi: number; message: string; code: string }
  | { phase: 'blocked'; message: string; code: string };

type Reading = { rssi: number; at: number; token: string };

const SAMPLE_WINDOW_MS = 6000;
const MIN_SAMPLES = 3;

// How long to leave a beacon alone after each kind of "no".
const COOLDOWN: Record<string, number> = {
  too_far: 3000,
  stale_token: 1500,
  weak_reading: 1000,
  offline: 4000,
  not_enrolled: 60_000,
  session_closed: 120_000,
  no_session: 30_000,
};
// These won't fix themselves by walking closer, so stop and tell the student.
const BLOCKING = new Set(['device_pending', 'device_not_bound', 'bad_signature', 'device_used', 'stale_request', 'unauthenticated']);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Collects RSSI readings per beacon and, once there are a few, sends one
 * signed check-in with the median. A single lucky reading isn't enough, and a
 * median shrugs off the odd spike from someone walking past.
 */
export function useAutoCheckin(userId: string | undefined, onMarked: (m: Marked) => void) {
  const [state, setState] = useState<CheckinState>({ phase: 'listening' });
  const readings = useRef(new Map<number, Reading[]>());
  const holdUntil = useRef(new Map<number, number>());
  const done = useRef(new Set<number>());
  const inFlight = useRef(false);
  const lastHeard = useRef(0);
  const onMarkedRef = useRef(onMarked);
  useEffect(() => { onMarkedRef.current = onMarked; });

  const onBeacon = useCallback(async (e: { payload: string; rssi: number; at: number }) => {
    const decoded = decodePayload(e.payload);
    if (!decoded || !userId) return;
    const { beaconCode, token } = decoded;
    if (done.current.has(beaconCode)) return;

    const now = Date.now();
    lastHeard.current = now;
    const list = (readings.current.get(beaconCode) ?? []).filter((r) => now - r.at < SAMPLE_WINDOW_MS);
    list.push({ rssi: e.rssi, at: now, token });
    readings.current.set(beaconCode, list.slice(-12));

    if (inFlight.current || (holdUntil.current.get(beaconCode) ?? 0) > now) {
      setState((s) => (s.phase === 'hearing' ? { phase: 'hearing', rssi: e.rssi } : s));
      return;
    }
    if (list.length < MIN_SAMPLES) {
      setState({ phase: 'hearing', rssi: e.rssi });
      return;
    }

    const rssi = median(list.map((r) => r.rssi));
    inFlight.current = true;
    setState({ phase: 'checking', rssi });
    try {
      const ts = Math.round(serverNow());
      const body = { beaconCode, token, rssi, samples: list.length, ts };
      const signature = await signMessage(checkinMessage({ ...body, userId }));
      const res = await api<Marked & { status: string }>('/checkin', { body: { ...body, signature } });
      done.current.add(beaconCode);
      readings.current.delete(beaconCode);
      if (res.status === 'marked') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setState({ phase: 'listening' });
      onMarkedRef.current(res);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error';
      const message = err instanceof Error ? err.message : 'Check-in failed.';
      if (BLOCKING.has(code)) {
        holdUntil.current.set(beaconCode, now + 15_000);
        setState({ phase: 'blocked', message, code });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else {
        holdUntil.current.set(beaconCode, Date.now() + (COOLDOWN[code] ?? 5000));
        // Quietly ignore other classes' beacons; only surface things the student can act on.
        if (code === 'not_enrolled' || code === 'no_session' || code === 'session_closed') {
          done.current.add(beaconCode);
          setState({ phase: 'listening' });
        } else {
          setState({ phase: 'retry', rssi, message, code });
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [userId]);

  /** Drop back to "listening" if the beacon goes quiet. */
  const tick = useCallback(() => {
    if (Date.now() - lastHeard.current > 8000) {
      setState((s) => (s.phase === 'hearing' || s.phase === 'retry' ? { phase: 'listening' } : s));
    }
  }, []);

  const reset = useCallback(() => {
    done.current.clear();
    holdUntil.current.clear();
    readings.current.clear();
    setState({ phase: 'listening' });
  }, []);

  return { state, onBeacon, tick, reset };
}
