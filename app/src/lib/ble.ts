import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import ProxyBeacon, { type BeaconEvent, type BluetoothState } from '../../modules/proxy-beacon';
import { serverNow } from './api';
import { encodePayload, MANUFACTURER_ID, PAYLOAD_PREFIX, tokenFor, windowAt } from './token';

export const bleAvailable = ProxyBeacon != null;

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
      const now = serverNow();
      const t = tokenFor(beacon.secret, beacon.code, windowAt(now, beacon.windowSeconds));
      try {
        await ProxyBeacon!.startAdvertising(MANUFACTURER_ID, encodePayload(beacon.code, t));
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
      ProxyBeacon?.stopAdvertising().catch(() => {});
    };
    // Only restart when the beacon itself changes, not on every re-render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beacon?.code, beacon?.secret, beacon?.windowSeconds, enabled]);

  return { token, error, nextChangeAt };
}

/** Student side: keep a scan running and hand every matching advert to `onBeacon`. */
export function useScanner(enabled: boolean, onBeacon: (e: BeaconEvent) => void) {
  const handler = useRef(onBeacon);
  useEffect(() => { handler.current = onBeacon; });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !ProxyBeacon) return;
    const sub = ProxyBeacon.addListener('onBeacon', (e) => handler.current(e));
    const errSub = ProxyBeacon.addListener('onScanError', (e) => setError(`Scanning stopped (code ${e.code}).`));
    ProxyBeacon.startScanning(MANUFACTURER_ID, PAYLOAD_PREFIX)
      .then(() => setError(null))
      .catch((e: any) => setError(e?.code === 'BLUETOOTH_OFF' ? 'Bluetooth is off.' : (e?.message ?? "Couldn't start scanning.")));
    return () => {
      sub.remove();
      errSub.remove();
      ProxyBeacon?.stopScanning().catch(() => {});
    };
  }, [enabled]);

  return { error };
}
