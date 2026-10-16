import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import ProxyBeacon, { type BeaconEvent, type BluetoothState } from '../../modules/proxy-beacon';
import { serverNow } from './api';
import { encodePayload, MANUFACTURER_ID, tokenFor, windowAt } from './token';

export const bleAvailable = ProxyBeacon != null;
export const canAdvertise = () => ProxyBeacon?.canAdvertise() ?? false;

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = Number(Platform.Version) >= 31
    ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT]
    : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Polls the adapter state; Android doesn't push changes to us without a receiver. */
export function useBluetoothState(): BluetoothState {
  const [state, setState] = useState<BluetoothState>(() => ProxyBeacon?.getState() ?? 'unsupported');
  useEffect(() => {
    if (!ProxyBeacon) return;
    const tick = () => setState(ProxyBeacon!.getState());
    const id = setInterval(tick, 1500);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  return state;
}

/** Don't let a native call that never calls back freeze the beacon loop. */
function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Bluetooth stopped responding.')), ms))]);
}

export function advertise(payloadHex: string) {
  if (!ProxyBeacon) return Promise.reject(new Error('Bluetooth module missing'));
  return withTimeout(ProxyBeacon.startAdvertising(MANUFACTURER_ID, payloadHex), 3000);
}

export function stopAdvertising() {
  return ProxyBeacon?.stopAdvertising().catch(() => {});
}

export type Beacon = { code: number; secret: string; windowSeconds: number };

/**
 * Organiser side: broadcast the session's beacon, swapping in a new token at
 * the start of every window. Returns the token currently on air.
 */
export function useBroadcast(beacon: Beacon | null, enabled: boolean) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextChangeAt, setNextChangeAt] = useState(0);

  useEffect(() => {
    if (!beacon || !enabled || !ProxyBeacon) {
      setToken(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const ms = beacon.windowSeconds * 1000;

    const cycle = async () => {
      if (stopped) return;
      const t = tokenFor(beacon.secret, beacon.code, windowAt(serverNow(), beacon.windowSeconds));
      try {
        await advertise(encodePayload(beacon.code, t));
        if (stopped) return;
        setToken(t);
        setError(null);
      } catch (e: any) {
        if (!stopped) setError(e?.code === 'BLUETOOTH_OFF' ? 'Bluetooth is off.' : (e?.message ?? 'Could not start broadcasting.'));
      }
      // Line up with the next window boundary (plus a hair, so we're safely inside it).
      const wait = ms - (serverNow() % ms) + 50;
      setNextChangeAt(Date.now() + wait);
      timer = setTimeout(cycle, wait);
    };
    cycle();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stopAdvertising();
    };
    // Only restart when the beacon itself changes, not on every re-render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beacon?.code, beacon?.secret, beacon?.windowSeconds, enabled]);

  return { token, error, nextChangeAt };
}

/**
 * Keep a scan running for adverts starting with `prefix`, and hand each one to
 * `onBeacon`. Stopping is delayed a few seconds: Android silently blocks apps
 * that start more than five scans in 30 seconds, and flicking between apps
 * would otherwise burn through that.
 */
export function useScanner(enabled: boolean, prefix: string, onBeacon: (e: BeaconEvent) => void) {
  const handler = useRef(onBeacon);
  useEffect(() => { handler.current = onBeacon; });
  const [error, setError] = useState<string | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ProxyBeacon) return;
    const sub = ProxyBeacon.addListener('onBeacon', (e) => handler.current(e));
    const errSub = ProxyBeacon.addListener('onScanError', () =>
      setError("Bluetooth scanning stopped. Turn Bluetooth off and on again, then reopen the app."));
    return () => {
      sub.remove();
      errSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!ProxyBeacon) return;
    if (enabled) {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = null;
      ProxyBeacon.startScanning(MANUFACTURER_ID, prefix)
        .then(() => setError(null))
        .catch((e: any) => setError(e?.code === 'BLUETOOTH_OFF' ? 'Bluetooth is off.' : (e?.message ?? "Couldn't start scanning.")));
    } else {
      stopTimer.current = setTimeout(() => ProxyBeacon?.stopScanning().catch(() => {}), 10_000);
    }
  }, [enabled, prefix]);

  // Leaving the screen stops for real.
  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    ProxyBeacon?.stopScanning().catch(() => {});
  }, []);

  return { error };
}
