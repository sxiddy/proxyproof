import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// Mirrors server/src/token.ts. The organiser's phone works the token out
// itself every few seconds, so the beacon keeps going even if Wi-Fi drops.

/** 0xFFFF is the Bluetooth SIG id reserved for testing / unregistered use. */
export const MANUFACTURER_ID = 0xffff;
/** "PP" + format version 1. Scanners filter on this so they ignore every other gadget. */
export const PAYLOAD_PREFIX = '505001';

export function windowAt(ms: number, windowSeconds: number) {
  return Math.floor(ms / (windowSeconds * 1000));
}

export function tokenFor(secretHex: string, beaconCode: number, window: number) {
  const mac = hmac(sha256, hexToBytes(secretHex), utf8ToBytes(`${beaconCode}:${window}`));
  return bytesToHex(mac.subarray(0, 8));
}

/** prefix (3 bytes) + beacon code (4 bytes, big-endian) + token (8 bytes) = 15 bytes. */
export function encodePayload(beaconCode: number, token: string) {
  return PAYLOAD_PREFIX + (beaconCode >>> 0).toString(16).padStart(8, '0') + token;
}

export function decodePayload(hex: string): { beaconCode: number; token: string } | null {
  const h = hex.toLowerCase();
  if (h.length !== 30 || !h.startsWith(PAYLOAD_PREFIX)) return null;
  return { beaconCode: parseInt(h.slice(6, 14), 16), token: h.slice(14) };
}

export function checkinMessage(p: { beaconCode: number; token: string; userId: string; ts: number; rssi: number; samples: number }) {
  return `proxyproof-checkin|v1|${p.beaconCode}|${p.token}|${p.userId}|${p.ts}|${p.rssi}|${p.samples}`;
}

/** "PP" + type 2: a student's phone answering the beacon. */
export const ECHO_PREFIX = '505002';

/** Mirrors echoFor() in server/src/token.ts. Changes with every token. */
export function echoFor(publicKeyHex: string, token: string) {
  return bytesToHex(sha256(utf8ToBytes(`proxyproof-echo|${publicKeyHex}|${token}`)).subarray(0, 8));
}

export function decodeEcho(hex: string): string | null {
  const h = hex.toLowerCase();
  return h.length === 22 && h.startsWith(ECHO_PREFIX) ? h.slice(6) : null;
}
