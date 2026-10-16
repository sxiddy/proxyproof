import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { HttpError, parse, requireAuth } from '../http.ts';
import { checkinMessage, isTokenFresh, verifySignature } from '../token.ts';
import { percent } from './courses.ts';
import { rosterEntry } from './sessions.ts';

const body = z.object({
  beaconCode: z.number().int().min(0).max(0x7fffffff),
  token: z.string().regex(/^[0-9a-f]{16}$/),
  rssi: z.number().int().min(-127).max(20),
  samples: z.number().int().min(1).max(100),
  ts: z.number().int(),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
});

// Plain-English reasons, shown on the student's phone and the organiser's dashboard.
export const REASONS = {
  device_not_bound: "This phone isn't linked to your account yet.",
  device_pending: 'Your new phone is waiting for admin approval.',
  bad_signature: "This request didn't come from your registered phone.",
  stale_request: "Your phone's clock looks off. Check the time settings.",
  no_session: 'No live session matches this signal.',
  session_closed: 'That session has already ended.',
  not_enrolled: "You're not in this course. Join it with the code first.",
  stale_token: 'That code has expired. Stay near the organiser for a few seconds.',
  too_far: "You're a bit far from the organiser. Move closer.",
  weak_reading: 'Signal is still settling. Hold on a second.',
  device_used: 'This phone already marked someone else in this session.',
} as const;

type Reason = keyof typeof REASONS;

export function checkinRoutes({ db, config, rt }: Ctx) {
  const r = Router();
  const student = requireAuth(config.jwtSecret, 'student');
  // A phone sends at most a handful of these per session; this is just a backstop.
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: (req) => req.user!.id, standardHeaders: true, legacyHeaders: false });

  r.post('/checkin', student, limiter, async (req, res) => {
    const me = req.user!;
    const p = parse(body, req.body);
    let sessionId: string | null = null;

    const reject = async (reason: Reason, status = 403, log = true): Promise<never> => {
      if (log && sessionId) {
        const { rows: [a] } = await db.query(
          'INSERT INTO checkin_attempts (session_id, student_id, reason, rssi) VALUES ($1, $2, $3, $4) RETURNING id, at',
          [sessionId, me.id, reason, p.rssi]);
        rt.toSession(sessionId, 'attempt', { id: String(a.id), studentId: me.id, name: me.name, reason, rssi: p.rssi, at: a.at });
      }
      throw new HttpError(status, reason, REASONS[reason]);
    };

    // 1. Which session is this signal for?
    const { rows: [s] } = await db.query(`
      SELECT s.*, c.name AS course_name FROM sessions s JOIN courses c ON c.id = s.course_id
      WHERE s.beacon_code = $1 ORDER BY s.started_at DESC LIMIT 1`, [p.beaconCode]);
    if (!s) await reject('no_session', 404, false);
    const live = !s.closed_at && new Date(s.ends_at) > new Date();
    if (!live) await reject('session_closed', 410, false);

    // 2. Is the student registered for it? (Not logged: could be a neighbouring class.)
    const { rows: [enrolled] } = await db.query(
      'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2', [s.course_id, me.id]);
    if (!enrolled) await reject('not_enrolled', 403, false);
    sessionId = s.id;

    // Already marked? Then the phone can stop scanning; nothing else to check.
    const { rows: [already] } = await db.query(
      'SELECT method, marked_at FROM attendance WHERE session_id = $1 AND student_id = $2', [s.id, me.id]);
    if (already) {
      return res.json({ status: 'already', sessionId: s.id, courseName: s.course_name, markedAt: already.marked_at, method: already.method });
    }

    // 3. Did it come from the student's own registered phone?
    const { rows: devices } = await db.query(
      `SELECT id, public_key, status FROM devices WHERE user_id = $1 AND status IN ('active', 'pending')`, [me.id]);
    const device = devices.find((d) => d.status === 'active');
    if (!device) await reject(devices.length ? 'device_pending' : 'device_not_bound');
    const message = checkinMessage({ ...p, userId: me.id });
    if (!verifySignature(device.public_key, message, p.signature)) {
      const pendingMatch = devices.some((d) => d.status === 'pending' && verifySignature(d.public_key, message, p.signature));
      await reject(pendingMatch ? 'device_pending' : 'bad_signature');
    }
    if (Math.abs(Date.now() - p.ts) > 30_000) await reject('stale_request');

    // 4. Is the token from the last few seconds?
    if (!isTokenFresh(s.secret, s.beacon_code, p.token, s.window_seconds)) await reject('stale_token');

    // 5. Close enough to the organiser? The phone sends a median of several readings.
    if (p.samples < 3) await reject('weak_reading', 425, false);
    if (p.rssi < s.rssi_threshold) await reject('too_far');

    // 6. Mark. The unique index on (session, device) blocks one phone marking two people.
    try {
      await db.query(
        `INSERT INTO attendance (session_id, student_id, device_id, method, rssi) VALUES ($1, $2, $3, 'ble', $4)`,
        [s.id, me.id, device.id, p.rssi]);
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      const { rows: [mine] } = await db.query('SELECT 1 FROM attendance WHERE session_id = $1 AND student_id = $2', [s.id, me.id]);
      if (!mine) await reject('device_used', 409);
    }

    const entry = await rosterEntry(db, s.id, me.id);
    rt.toSession(s.id, 'mark', entry);
    res.status(201).json({ status: 'marked', sessionId: s.id, courseName: s.course_name, markedAt: entry.markedAt, method: 'ble' });
  });

  // Overall picture for the student's history screen.
  r.get('/me/history', student, async (req, res) => {
    const { rows } = await db.query(`
      SELECT c.id AS course_id, c.name AS course_name, c.code, s.id, s.started_at, s.closed_at, a.marked_at, a.method
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      JOIN sessions s ON s.course_id = c.id
      LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = e.student_id
      WHERE e.student_id = $1 AND ((s.closed_at IS NOT NULL AND s.started_at >= e.joined_at) OR a.student_id IS NOT NULL)
      ORDER BY s.started_at DESC LIMIT 200`, [req.user!.id]);
    const attended = rows.filter((r) => r.marked_at).length;
    res.json({
      attended, total: rows.length, percentage: percent(attended, rows.length),
      sessions: rows.map((r) => ({
        id: r.id, courseId: r.course_id, courseName: r.course_name, courseCode: r.code,
        startedAt: r.started_at, status: r.marked_at ? 'present' : 'absent', markedAt: r.marked_at, method: r.method,
      })),
    });
  });

  return r;
}
