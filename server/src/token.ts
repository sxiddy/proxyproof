import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

// The beacon token works like a TOTP code: HMAC(session secret, beacon code +
// time window), cut down to 8 bytes so it fits in a BLE advert. The organiser's
// phone computes the same thing offline. Keep this in sync with app/src/lib/token.ts.

export const DEFAULT_WINDOW_SECONDS = 5;

export function newSecret() {
  return randomBytes(32).toString('hex');
}

/** 31-bit so it fits in a Postgres integer and in 4 bytes of the advert. */
export function newBeaconCode() {
  return randomBytes(4).readUInt32BE(0) & 0x7fffffff;
}

export function windowAt(ms: number, windowSeconds: number) {
  return Math.floor(ms / (windowSeconds * 1000));
}

export function tokenFor(secretHex: string, beaconCode: number, window: number) {
  return createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${beaconCode}:${window}`)
    .digest()
    .subarray(0, 8)
    .toString('hex');
}

/**
 * A token is fresh if it belongs to the current window or one either side of
 * it. That's at most ~15 seconds of validity with 5s windows: long enough for
 * a slightly-off phone clock, too short to forward a screenshot to a friend.
 */
export function isTokenFresh(secretHex: string, beaconCode: number, token: string, windowSeconds: number, now = Date.now()) {
  if (!/^[0-9a-f]{16}$/.test(token)) return false;
  const given = Buffer.from(token, 'hex');
  const current = windowAt(now, windowSeconds);
  return [current, current - 1, current + 1].some((w) =>
    timingSafeEqual(given, Buffer.from(tokenFor(secretHex, beaconCode, w), 'hex')),
  );
}

/**
 * What a student's phone advertises back once it hears the beacon. It changes
 * with every token (so it can't be used to track someone) and only the server,
 * which knows each phone's public key, can tell whose it is. If the organiser's
 * phone hears it, that student's phone was physically in the room, which a
 * friend relaying codes over WhatsApp can't fake.
 */
export function echoFor(publicKeyHex: string, token: string) {
  return createHash('sha256').update(`proxyproof-echo|${publicKeyHex}|${token}`).digest().subarray(0, 8).toString('hex');
}

/** The exact string a student's phone signs for a check-in. */
export function checkinMessage(p: { beaconCode: number; token: string; userId: string; ts: number; rssi: number; samples: number }) {
  return `proxyproof-checkin|v1|${p.beaconCode}|${p.token}|${p.userId}|${p.ts}|${p.rssi}|${p.samples}`;
}

/** Verify an Ed25519 signature. Keys and signatures travel as hex. */
export function verifySignature(publicKeyHex: string, message: string, signatureHex: string) {
  try {
    const raw = Buffer.from(publicKeyHex, 'hex');
    const sig = Buffer.from(signatureHex, 'hex');
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    return verify(null, Buffer.from(message), key, sig);
  } catch {
    return false;
  }
}
