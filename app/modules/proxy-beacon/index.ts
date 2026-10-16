import { NativeModule, requireOptionalNativeModule } from 'expo';

export type BeaconEvent = { payload: string; rssi: number; at: number };
export type BluetoothState = 'on' | 'off' | 'location_off' | 'unsupported';

type Events = {
  onBeacon: (e: BeaconEvent) => void;
  onScanError: (e: { code: number }) => void;
};

declare class ProxyBeaconModule extends NativeModule<Events> {
  getState(): BluetoothState;
  canAdvertise(): boolean;
  startAdvertising(manufacturerId: number, payloadHex: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  startScanning(manufacturerId: number, prefixHex: string): Promise<void>;
  stopScanning(): Promise<void>;
}

// Optional so the JS bundle still loads where the native side isn't built in
// (web preview, Expo Go). Screens check for null and explain what's missing.
export default requireOptionalNativeModule<ProxyBeaconModule>('ProxyBeacon');
