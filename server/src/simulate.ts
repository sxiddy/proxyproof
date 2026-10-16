// Fills a live session with pretend students, so you can watch the organiser
// dashboard update without a room full of phones. Some of them deliberately
// try things that should be blocked (standing too far away, replaying an
// old code) so the "blocked attempts" list has something in it too.
//
//   npm run simulate -- --api http://localhost:4000 --join OSDEMO --count 12
//
// It logs in as the organiser to read the beacon secret, which a real student
// never sees. Demo tool only.

import { generateKeyPairSync, sign } from 'node:crypto';
import { parseArgs } from 'node:util';
import { checkinMessage, tokenFor, windowAt } from './token.ts';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:4000' },
    join: { type: 'string', default: 'OSDEMO' },
    count: { type: 'string', default: '10' },
    'org-email': { type: 'string', default: 'organiser@proxyproof.dev' },
    'org-password': { type: 'string', default: 'demo1234' },
  },
});

const NAMES = ['Aarav Shah', 'Diya Menon', 'Kabir Rao', 'Ishita Verma', 'Rohan Pillai', 'Sneha Reddy', 'Arjun Nair', 'Meghna Iyer',
  'Vikram Joshi', 'Tanvi Kulkarni', 'Nikhil Das', 'Priya Bhat', 'Aditya Sen', 'Zoya Khan', 'Rahul Gupta', 'Ananya Ghosh'];

async function call(path: string, body?: unknown, token?: string) {
  const res = await fetch(args.api + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function phone(tag: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('hex');
  return { device: { hardwareId: `sim:${tag}`, publicKey: pub, model: 'Simulated phone' }, privateKey };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const org = await call('/auth/login', { email: args['org-email'], password: args['org-password'] });
if (!org.ok) throw new Error(`Organiser login failed: ${org.data?.error?.message}`);
const courses = (await call('/courses', undefined, org.data.token)).data.courses as any[];
const course = courses.find((c) => c.joinCode === args.join.toUpperCase());
if (!course) throw new Error(`No course with join code ${args.join} for this organiser`);
if (!course.liveSessionId) throw new Error('Start a session from the app first, then run this again.');
const { session } = (await call(`/sessions/${course.liveSessionId}`, undefined, org.data.token)).data;
console.log(`Session for ${course.code} is live. Sending in ${args.count} students…`);

const count = Math.min(Number(args.count), NAMES.length);
for (let i = 0; i < count; i++) {
  const name = NAMES[i];
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}@sim.proxyproof.dev`;
  const p = phone(email);
  let auth = await call('/auth/login', { email, password: 'simulated', device: p.device });
  if (!auth.ok) auth = await call('/auth/register', { name, email, password: 'simulated', role: 'student', rollNo: `23BCE${1000 + i}`, device: p.device });
  if (!auth.ok) { console.log(`  ${name}: couldn't log in (${auth.data?.error?.message})`); continue; }
  await call('/courses/join', { joinCode: args.join }, auth.data.token);

  // A few troublemakers, so the dashboard shows what blocking looks like.
  const trick = i === 2 ? 'far' : i === 5 ? 'replay' : 'none';
  const b = session.beacon;
  const at = trick === 'replay' ? Date.now() - 90_000 : Date.now();
  const payload = {
    beaconCode: b.code,
    token: tokenFor(b.secret, b.code, windowAt(at, b.windowSeconds)),
    rssi: trick === 'far' ? -91 : -50 - Math.floor(Math.random() * 20),
    samples: 5,
    ts: Date.now(),
  };
  const signature = sign(null, Buffer.from(checkinMessage({ ...payload, userId: auth.data.user.id })), p.privateKey).toString('hex');
  const res = await call('/checkin', { ...payload, signature }, auth.data.token);
  console.log(`  ${name.padEnd(16)} ${res.ok ? res.data.status : `blocked: ${res.data?.error?.code}`}`);
  await sleep(600 + Math.random() * 1400);
}
console.log('Done.');
