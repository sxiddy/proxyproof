import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import type { Queryable } from '../db.ts';
import { fail, parse, requireAuth, signToken, type Role } from '../http.ts';

const device = z.object({
  hardwareId: z.string().trim().min(4).max(128),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/, 'must be a 32-byte hex key'),
  model: z.string().trim().max(80).optional(),
});

const registerBody = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email: z.string().trim().toLowerCase().email('That email looks off'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  role: z.enum(['student', 'organiser']),
  rollNo: z.string().trim().max(32).optional(),
  organiserCode: z.string().trim().optional(),
  device: device.optional(),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
  device: device.optional(),
});

export type DeviceStatus = 'active' | 'pending' | 'none';

/**
 * Ties a phone to a student. First phone gets bound straight away; a different
 * phone later turns into a request an admin has to approve.
 */
export async function bindDevice(q: Queryable, userId: string, d: z.infer<typeof device>): Promise<DeviceStatus> {
  const { rows: [active] } = await q.query(
    `SELECT id, hardware_id, public_key FROM devices WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );

  if (active?.public_key === d.publicKey) return 'active';

  const { rows: [taken] } = await q.query(
    `SELECT user_id FROM devices WHERE hardware_id = $1 AND status = 'active' AND user_id <> $2`,
    [d.hardwareId, userId],
  );
  if (taken) {
    fail(409, 'device_taken', "This phone is already linked to another student. One phone, one student.");
  }

  // Anything other than the exact bound key (a new phone, or this phone after a
  // reinstall) goes to an admin. Auto-swapping keys would let anyone who knows
  // a student's hardware id take over their account.
  try {
    if (!active) {
      await q.query(
        `INSERT INTO devices (user_id, hardware_id, public_key, model, status) VALUES ($1, $2, $3, $4, 'active')`,
        [userId, d.hardwareId, d.publicKey, d.model ?? null],
      );
      return 'active';
    }
    // Replace any older pending request with this one.
    await q.query(`UPDATE devices SET status = 'rejected', note = 'superseded', decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [userId]);
    await q.query(
      `INSERT INTO devices (user_id, hardware_id, public_key, model, status) VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, d.hardwareId, d.publicKey, d.model ?? null],
    );
    return 'pending';
  } catch (err: any) {
    if (err?.code !== '23505') throw err;
    // Two logins from this account landed at the same moment; the other one won.
    if (/^devices_one_(active|pending)_per_user$/.test(err.constraint)) fail(409, 'try_again', 'Another sign-in from this account just went through. Try again.');
    return fail(409, 'device_taken', "This phone is already linked to another student. One phone, one student.");
  }
}

/** Status of the phone holding `publicKey`, as far as this student is concerned. */
export async function deviceStatus(q: Queryable, userId: string, publicKey?: string): Promise<DeviceStatus> {
  const { rows } = await q.query(
    `SELECT status FROM devices WHERE user_id = $1 AND public_key = $2 AND status IN ('active', 'pending')`,
    [userId, publicKey ?? ''],
  );
  const statuses = rows.map((r) => r.status);
  if (statuses.includes('active')) return 'active';
  return statuses.includes('pending') ? 'pending' : 'none';
}

function publicUser(u: any) {
  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, rollNo: u.roll_no ?? null };
}

export function authRoutes({ db, config }: Ctx) {
  const r = Router();
  // A whole class shares one college IP, so count only failures, per IP and per email.
  const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 300, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false });
  const perEmail = rateLimit({
    windowMs: 10 * 60_000, limit: 15, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`,
  });

  r.post('/auth/register', limiter, async (req, res) => {
    const body = parse(registerBody, req.body);
    if (body.role === 'organiser' && body.organiserCode !== config.organiserCode) {
      fail(403, 'bad_staff_code', "That staff code isn't right. Ask your department for it.");
    }
    if (body.role === 'student' && !body.device) {
      fail(400, 'device_required', 'Students have to sign up from their phone.');
    }

    const hash = await bcrypt.hash(body.password, 10);
    const result = await db.tx(async (q) => {
      const { rows: [existing] } = await q.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (existing) fail(409, 'email_taken', 'There is already an account with that email.');
      const { rows: [user] } = await q.query(
        `INSERT INTO users (name, email, password_hash, role, roll_no) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.name, body.email, hash, body.role, body.role === 'student' ? (body.rollNo || null) : null],
      );
      const status = body.role === 'student' ? await bindDevice(q, user.id, body.device!) : 'none';
      return { user, status };
    }).catch((err) => {
      // Same email registered twice at once: the second one loses the race.
      if (err?.code === '23505' && err.constraint === 'users_email_key') fail(409, 'email_taken', 'There is already an account with that email.');
      throw err;
    });

    const user = publicUser(result.user);
    res.status(201).json({ token: signToken(config.jwtSecret, user), user, deviceStatus: result.status });
  });

  r.post('/auth/login', limiter, perEmail, async (req, res) => {
    const body = parse(loginBody, req.body);
    const { rows: [row] } = await db.query('SELECT * FROM users WHERE email = $1', [body.email]);
    const ok = row && (await bcrypt.compare(body.password, row.password_hash));
    if (!ok) fail(401, 'bad_login', "Email or password doesn't match.");

    let status: DeviceStatus = 'none';
    if (row.role === 'student') {
      if (!body.device) fail(400, 'device_required', 'Students have to log in from their phone.');
      status = await db.tx((q) => bindDevice(q, row.id, body.device!));
    }
    const user = publicUser(row);
    res.json({ token: signToken(config.jwtSecret, user), user, deviceStatus: status });
  });

  r.get('/me', requireAuth(config.jwtSecret), async (req, res) => {
    const { rows: [row] } = await db.query('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!row) fail(401, 'unauthenticated', 'This account no longer exists.');
    // The app sends its public key so we can say whether *this* phone is the bound one.
    const key = req.header('x-device-key');
    const status = row.role === 'student' ? await deviceStatus(db, row.id, key) : 'none';
    res.json({ user: publicUser(row), deviceStatus: status, serverTime: Date.now() });
  });

  r.get('/time', (_req, res) => {
    res.json({ now: Date.now() });
  });

  return r;
}
