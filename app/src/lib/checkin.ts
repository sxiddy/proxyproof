import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, serverNow, syncClock } from './api';
import { advertise, stopAdvertising } from './ble';
import { devicePublicKey, signMessage } from './device';
import { checkinMessage, decodePayload, ECHO_PREFIX, echoFor } from './token';

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
/** Keep answering the organiser for a while after the last beacon we heard. */
const ECHO_LINGER_MS = 15_000;

// How long to leave a beacon alone after each kind of "no".
const COOLDOWN: Record<string, number> = {
  too_far: 3000,
  stale_token: 1500,
  stale_request: 500,
  weak_reading: 1000,
  offline: 4000,
};
// These won't fix themselves by walking closer, so stop and tell the student.
const BLOCKING = new Set(['device_pending', 'device_not_bound', 'bad_signature', 'device_used', 'unauthenticated', 'removed']);
// Someone else's class, or one that's over. Not worth mentioning.
const IGNORE = new Set(['not_enrolled', 'no_session', 'session_closed']);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

async function resyncClock() {
  const sentAt = Date.now();
  const { now } = await api<{ now: number }>('/time');
  syncClock(now, sentAt, Date.now());
}

/**
 * Collects RSSI readings per beacon and, once there are a few, sends one
 * signed check-in with the median. A single lucky reading isn't enough, and a
 * median shrugs off the odd spike from someone walking past.
 *
 * While it can hear a beacon it also advertises a short "echo" (see
 * echoFor), so the organiser's phone can confirm this phone was in the room.
 */
export function useAutoCheckin(userId: string | undefined, onMarked: (m: Marked) => void) {
  const [state, setState] = useState<CheckinState>({ phase: 'listening' });
  const readings = useRef(new Map<number, Reading[]>());
  const holdUntil = useRef(new Map<number, number>());
  const done = useRef(new Set<number>());
  /** Beacons from other classes: we don't check in, and we don't echo back. */
  const ignored = useRef(new Set<number>());
  const inFlight = useRef(false);
  const lastHeard = useRef(0);
  const echoToken = useRef<string | null>(null);
  const onMarkedRef = useRef(onMarked);
  useEffect(() => { onMarkedRef.current = onMarked; });

  const echo = useCallback(async (token: string) => {
    if (echoToken.current === token) return;
    echoToken.current = token;
    try {
      await advertise(ECHO_PREFIX + echoFor(await devicePublicKey(), token));
    } catch {
      // Some phones can't advertise; the check-in still works, it's just not "heard".
    }
  }, []);

  const onBeacon = useCallback(async (e: { payload: string; rssi: number; at: number }) => {
    const decoded = decodePayload(e.payload);
    if (!decoded || !userId) return;
    const { beaconCode, token } = decoded;
    const now = Date.now();
    lastHeard.current = now;
    if (ignored.current.has(beaconCode)) return;
    echo(token);
    if (done.current.has(beaconCode)) return;

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
      if (code === 'stale_request') {
        // Phone clock is off: ask the server for the time and try again straight away.
        await resyncClock().catch(() => {});
      }
      if (BLOCKING.has(code)) {
        if (code === 'removed') done.current.add(beaconCode);
        holdUntil.current.set(beaconCode, now + 15_000);
        setState({ phase: 'blocked', message, code });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else if (IGNORE.has(code)) {
        ignored.current.add(beaconCode);
        setState({ phase: 'listening' });
      } else {
        holdUntil.current.set(beaconCode, Date.now() + (COOLDOWN[code] ?? 5000));
        setState(code === 'stale_request' ? { phase: 'checking', rssi } : { phase: 'retry', rssi, message, code });
      }
    } finally {
      inFlight.current = false;
    }
  }, [userId, echo]);

  /** Drop back to "listening" and stop echoing once the beacon goes quiet. */
  const tick = useCallback(() => {
    const quiet = Date.now() - lastHeard.current;
    if (quiet > 8000) {
      setState((s) => (s.phase === 'hearing' || s.phase === 'retry' ? { phase: 'listening' } : s));
    }
    if (quiet > ECHO_LINGER_MS && echoToken.current) {
      echoToken.current = null;
      stopAdvertising();
    }
  }, []);

  const reset = useCallback(() => {
    done.current.clear();
    ignored.current.clear();
    holdUntil.current.clear();
    readings.current.clear();
    setState({ phase: 'listening' });
  }, []);

  useEffect(() => () => { stopAdvertising(); }, []);

  return { state, onBeacon, tick, reset };
}
