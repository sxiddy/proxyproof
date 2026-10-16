import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

// Each install makes its own Ed25519 key pair, kept in the phone's encrypted
// SecureStore and only loaded to sign. Every check-in is signed with it, which
// is how the server knows the request came from the student's own phone.

const KEY = 'pp.device.secret';
const FALLBACK_KEY = 'pp.device.fallbackId';
let cached: { secret: Uint8Array; publicKey: string } | null = null;

async function keys() {
  if (cached) return cached;
  let hex = await SecureStore.getItemAsync(KEY);
  if (!hex) {
    hex = bytesToHex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(KEY, hex);
  }
  const secret = hexToBytes(hex);
  cached = { secret, publicKey: bytesToHex(ed25519.getPublicKey(secret)) };
  return cached;
}

export async function devicePublicKey() {
  return (await keys()).publicKey;
}

export async function deviceInfo() {
  const { publicKey } = await keys();
  let hardwareId = '';
  try {
    hardwareId = Application.getAndroidId() || '';
  } catch {}
  if (!hardwareId) {
    // No Android ID (rare): use a random one we keep, so we never collide with other phones.
    hardwareId = (await SecureStore.getItemAsync(FALLBACK_KEY)) ?? '';
    if (!hardwareId) {
      hardwareId = `rnd-${bytesToHex(Crypto.getRandomBytes(12))}`;
      await SecureStore.setItemAsync(FALLBACK_KEY, hardwareId);
    }
  }
  const model = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Android phone';
  return { hardwareId: `android:${hardwareId}`, publicKey, model };
}

export async function signMessage(message: string) {
  const { secret } = await keys();
  return bytesToHex(ed25519.sign(utf8ToBytes(message), secret));
}
