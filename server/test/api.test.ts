import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp, ensureAdmin } from '../src/app.ts';
import type { Ctx } from '../src/context.ts';
import { createDb } from '../src/db.ts';
import { checkinMessage, tokenFor, windowAt } from '../src/token.ts';

const events: { to: string; event: string; payload: any }[] = [];
let ctx: Ctx;
let app: ReturnType<typeof createApp>;

function phone(hardwareId: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  return { hardwareId, publicKey: Buffer.from(x, 'base64url').toString('hex'), model: 'Test Phone', privateKey };
}
type Phone = ReturnType<typeof phone>;
const deviceBody = (p: Phone) => ({ hardwareId: p.hardwareId, publicKey: p.publicKey, model: p.model });

function signedCheckin(p: Phone & { privateKey: KeyObject }, userId: string, beacon: any, opts: { rssi?: number; samples?: number; tokenAt?: number } = {}) {
  const token = tokenFor(beacon.secret, beacon.code, windowAt(opts.tokenAt ?? Date.now(), beacon.windowSeconds));
  const payload = { beaconCode: beacon.code, token, rssi: opts.rssi ?? -60, samples: opts.samples ?? 5, ts: Date.now() };
  const signature = sign(null, Buffer.from(checkinMessage({ ...payload, userId })), p.privateKey).toString('hex');
  return { ...payload, signature };
}

async function register(body: any) {
  const res = await request(app).post('/auth/register').send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { token: string; user: { id: string }; deviceStatus: string };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('ProxyProof API', () => {
  let org: any, alice: any, bob: any, admin: string;
  const alicePhone = phone('hw-alice');
  const bobPhone = phone('hw-bob');
  let courseId: string, joinCode: string, session: any;

  before(async () => {
    const db = await createDb('');
    ctx = {
      db,
      config: { jwtSecret: 'test', organiserCode: 'STAFF' },
      rt: {
        toSession: (id, event, payload) => events.push({ to: `session:${id}`, event, payload }),
        toUser: (id, event, payload) => events.push({ to: `user:${id}`, event, payload }),
        close: async () => {},
      },
    };
    app = createApp(ctx);
    await ensureAdmin(ctx, 'admin@test.dev', 'adminpass');
    admin = (await request(app).post('/auth/login').send({ email: 'admin@test.dev', password: 'adminpass' })).body.token;
  });
  after(() => ctx.db.close());

  it('needs the staff code to sign up as an organiser', async () => {
    const res = await request(app).post('/auth/register').send({ name: 'Dr. Rao', email: 'rao@test.dev', password: 'password1', role: 'organiser', organiserCode: 'nope' });
    assert.equal(res.status, 403);
    org = await register({ name: 'Dr. Rao', email: 'rao@test.dev', password: 'password1', role: 'organiser', organiserCode: 'STAFF' });
  });

  it('binds a student to the phone they sign up on', async () => {
    alice = await register({ name: 'Alice', email: 'alice@test.dev', password: 'password1', role: 'student', rollNo: '21BCE001', device: deviceBody(alicePhone) });
    assert.equal(alice.deviceStatus, 'active');
    bob = await register({ name: 'Bob', email: 'bob@test.dev', password: 'password1', role: 'student', device: deviceBody(bobPhone) });
  });

  it("won't let a second student claim a phone that's already linked", async () => {
    const res = await request(app).post('/auth/register').send({ name: 'Carl', email: 'carl@test.dev', password: 'password1', role: 'student', device: { ...deviceBody(phone('hw-alice')) } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'device_taken');
  });

  it('lets an organiser create a course and students join it', async () => {
    const c = await request(app).post('/courses').set(auth(org.token)).send({ name: 'Operating Systems', code: 'cs301' });
    assert.equal(c.status, 201);
    courseId = c.body.course.id;
    joinCode = c.body.course.joinCode;
    assert.equal(c.body.course.code, 'CS301');
    for (const s of [alice, bob]) {
      const j = await request(app).post('/courses/join').set(auth(s.token)).send({ joinCode: joinCode.toLowerCase() });
      assert.equal(j.status, 201);
    }
  });

  it('starts a timed session and hands the beacon secret to the organiser only', async () => {
    const res = await request(app).post(`/courses/${courseId}/sessions`).set(auth(org.token)).send({ durationMinutes: 5 });
    assert.equal(res.status, 201);
    session = res.body.session;
    assert.ok(session.beacon.secret);
    const ends = new Date(session.endsAt).getTime() - new Date(session.startedAt).getTime();
    assert.ok(Math.abs(ends - 5 * 60_000) < 2000);
    const again = await request(app).post(`/courses/${courseId}/sessions`).set(auth(org.token)).send({});
    assert.equal(again.status, 409);
    const asStudent = await request(app).get(`/sessions/${session.id}`).set(auth(alice.token));
    assert.equal(asStudent.status, 403);
  });

  it('rejects an expired (replayed) token', async () => {
    const body = signedCheckin(alicePhone, alice.user.id, session.beacon, { tokenAt: Date.now() - 60_000 });
    const res = await request(app).post('/checkin').set(auth(alice.token)).send(body);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'stale_token');
    assert.ok(events.some((e) => e.event === 'attempt' && e.payload.reason === 'stale_token'));
  });

  it("rejects a check-in signed by someone else's phone", async () => {
    // Bob tries to mark Alice using Alice's login on his phone.
    const body = signedCheckin(bobPhone, alice.user.id, session.beacon);
    const res = await request(app).post('/checkin').set(auth(alice.token)).send(body);
    assert.equal(res.body.error.code, 'bad_signature');
  });

  it('rejects a student who is too far away', async () => {
    const res = await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, session.beacon, { rssi: -92 }));
    assert.equal(res.body.error.code, 'too_far');
  });

  it('marks a student who is present, with a live event for the dashboard', async () => {
    events.length = 0;
    const res = await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, session.beacon));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, 'marked');
    assert.ok(events.some((e) => e.to === `session:${session.id}` && e.event === 'mark' && e.payload.id === alice.user.id));
    const twice = await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, session.beacon));
    assert.equal(twice.body.status, 'already');
  });

  it('turns a login on a new phone into a request an admin has to approve', async () => {
    const newPhone = phone('hw-bob-new');
    const login = await request(app).post('/auth/login').send({ email: 'bob@test.dev', password: 'password1', device: deviceBody(newPhone) });
    assert.equal(login.body.deviceStatus, 'pending');
    const blocked = await request(app).post('/checkin').set(auth(login.body.token)).send(signedCheckin(newPhone, bob.user.id, session.beacon));
    assert.equal(blocked.body.error.code, 'device_pending');

    const list = await request(app).get('/admin/device-requests').set(auth(admin));
    assert.equal(list.body.requests.length, 1);
    const approve = await request(app).post(`/admin/device-requests/${list.body.requests[0].id}/approve`).set(auth(admin));
    assert.equal(approve.status, 200);

    const ok = await request(app).post('/checkin').set(auth(login.body.token)).send(signedCheckin(newPhone, bob.user.id, session.beacon));
    assert.equal(ok.status, 201);
    // The old phone is now dead weight.
    const me = await request(app).get('/me').set(auth(login.body.token)).set('x-device-key', bobPhone.publicKey);
    assert.equal(me.body.deviceStatus, 'none');
  });

  it('lets the organiser add and remove students by hand, then close', async () => {
    const del = await request(app).delete(`/sessions/${session.id}/attendance/${bob.user.id}`).set(auth(org.token));
    assert.equal(del.status, 200);
    const add = await request(app).post(`/sessions/${session.id}/attendance`).set(auth(org.token)).send({ studentId: bob.user.id });
    assert.equal(add.body.entry.method, 'manual');
    const view = await request(app).get(`/sessions/${session.id}`).set(auth(org.token));
    assert.equal(view.body.roster.filter((r: any) => r.present).length, 2);
    assert.ok(view.body.attempts.length >= 3);
    const close = await request(app).post(`/sessions/${session.id}/close`).set(auth(org.token));
    assert.equal(close.status, 200);
    const late = await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, session.beacon));
    assert.equal(late.body.error.code, 'session_closed');
  });

  it('works out attendance percentage across sessions', async () => {
    const s2 = (await request(app).post(`/courses/${courseId}/sessions`).set(auth(org.token)).send({})).body.session;
    await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, s2.beacon));
    await request(app).post(`/sessions/${s2.id}/close`).set(auth(org.token));

    const hist = await request(app).get('/me/history').set(auth(bob.token));
    assert.equal(hist.body.total, 2);
    assert.equal(hist.body.attended, 1);
    assert.equal(hist.body.percentage, 50);
    const courses = await request(app).get('/courses').set(auth(alice.token));
    assert.equal(courses.body.courses[0].percentage, 100);
  });

  it('exports CSV for a session and for the whole course', async () => {
    const res = await request(app).get(`/courses/${courseId}/export.csv`).set(auth(org.token));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    const lines = res.text.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines.find((l) => l.startsWith('Alice'))!, /,P,P,2,2,100%$/);
    assert.match(lines.find((l) => l.startsWith('Bob'))!, /P \(manual\),A,1,2,50%$/);
    const one = await request(app).get(`/sessions/${session.id}/export.csv`).set(auth(org.token));
    assert.match(one.text, /Added by organiser/);
  });

  it('keeps one phone from marking two students in the same session', async () => {
    // Force the edge case directly: Bob's active device row reused for Alice.
    const s3 = (await request(app).post(`/courses/${courseId}/sessions`).set(auth(org.token)).send({})).body.session;
    const { rows: [d] } = await ctx.db.query(`SELECT id FROM devices WHERE user_id = $1 AND status = 'active'`, [alice.user.id]);
    await ctx.db.query(`INSERT INTO attendance (session_id, student_id, device_id, method) VALUES ($1, $2, $3, 'ble')`, [s3.id, bob.user.id, d.id]);
    const res = await request(app).post('/checkin').set(auth(alice.token)).send(signedCheckin(alicePhone, alice.user.id, s3.beacon));
    assert.equal(res.body.error.code, 'device_used');
  });
});
