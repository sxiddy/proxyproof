import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import type { Db, Queryable } from '../db.ts';
import { fail, parse, requireAuth, toCsv } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { DEFAULT_WINDOW_SECONDS, newBeaconCode, newSecret } from '../token.ts';
import { formatStamp, ownedCourse, safeName } from './courses.ts';

const uuid = /^[0-9a-f-]{36}$/i;
export const DEFAULT_RSSI = -75;

/** Close sessions whose timer ran out, and tell anyone watching. */
export async function sweepExpired(db: Db, rt: Realtime) {
  const { rows } = await db.query(
    `UPDATE sessions SET closed_at = ends_at WHERE closed_at IS NULL AND ends_at <= now() RETURNING id, closed_at`,
  );
  for (const s of rows) rt.toSession(s.id, 'closed', { sessionId: s.id, closedAt: s.closed_at, reason: 'timer' });
}

export async function ownedSession(q: Queryable, id: string, organiserId: string) {
  if (!uuid.test(id)) fail(404, 'not_found', 'Session not found.');
  const { rows: [s] } = await q.query(
    `SELECT s.*, c.name AS course_name, c.code AS course_code FROM sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.id = $1 AND s.organiser_id = $2`, [id, organiserId]);
  if (!s) fail(404, 'not_found', 'Session not found.');
  return s;
}

export const isLive = (s: any) => !s.closed_at && new Date(s.ends_at) > new Date();

function sessionJson(s: any, withBeacon: boolean) {
  return {
    id: s.id,
    courseId: s.course_id,
    courseName: s.course_name,
    courseCode: s.course_code,
    startedAt: s.started_at,
    endsAt: s.ends_at,
    closedAt: s.closed_at,
    live: isLive(s),
    rssiThreshold: s.rssi_threshold,
    // Only the organiser's own phone ever sees the secret.
    beacon: withBeacon && isLive(s)
      ? { code: s.beacon_code, secret: s.secret, windowSeconds: s.window_seconds }
      : null,
  };
}

export async function rosterEntry(q: Queryable, sessionId: string, studentId: string) {
  const { rows: [r] } = await q.query(`
    SELECT u.id, u.name, u.roll_no, a.method, a.marked_at, a.rssi
    FROM users u LEFT JOIN attendance a ON a.student_id = u.id AND a.session_id = $1
    WHERE u.id = $2`, [sessionId, studentId]);
  return r && { id: r.id, name: r.name, rollNo: r.roll_no, present: !!r.marked_at, method: r.method, markedAt: r.marked_at, rssi: r.rssi };
}

export function sessionRoutes({ db, config, rt }: Ctx) {
  const r = Router();
  const organiser = requireAuth(config.jwtSecret, 'organiser');

  r.post('/courses/:id/sessions', organiser, async (req, res) => {
    const course = await ownedCourse(db, req.params.id as string, req.user!.id);
    const body = parse(z.object({
      durationMinutes: z.number().int().min(1).max(30).default(5),
      rssiThreshold: z.number().int().min(-100).max(-30).default(DEFAULT_RSSI),
    }), req.body ?? {});

    await sweepExpired(db, rt);
    const { rows: [live] } = await db.query(
      'SELECT id FROM sessions WHERE course_id = $1 AND closed_at IS NULL', [course.id]);
    if (live) fail(409, 'session_live', 'This course already has a session running. Close it first.');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows: [s] } = await db.query(`
          INSERT INTO sessions (course_id, organiser_id, beacon_code, secret, window_seconds, rssi_threshold, ends_at)
          VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7))
          RETURNING *, $8::text AS course_name, $9::text AS course_code`,
          [course.id, req.user!.id, newBeaconCode(), newSecret(), DEFAULT_WINDOW_SECONDS, body.rssiThreshold,
            body.durationMinutes, course.name, course.code]);
        return res.status(201).json({ session: sessionJson(s, true), serverTime: Date.now() });
      } catch (err: any) {
        if (err?.code !== '23505') throw err; // beacon code clash, roll again
      }
    }
    fail(500, 'server_error', "Couldn't start the session. Try again.");
  });

  r.get('/sessions/:id', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const { rows: roster } = await db.query(`
      SELECT u.id, u.name, u.roll_no, a.method, a.marked_at, a.rssi
      FROM enrollments e
      JOIN users u ON u.id = e.student_id
      LEFT JOIN attendance a ON a.session_id = $1 AND a.student_id = u.id
      WHERE e.course_id = $2
      UNION
      SELECT u.id, u.name, u.roll_no, a.method, a.marked_at, a.rssi
      FROM attendance a JOIN users u ON u.id = a.student_id
      WHERE a.session_id = $1
      ORDER BY marked_at DESC NULLS LAST, name`, [s.id, s.course_id]);
    const { rows: attempts } = await db.query(`
      SELECT ca.id, ca.reason, ca.rssi, ca.at, u.id AS student_id, u.name
      FROM checkin_attempts ca JOIN users u ON u.id = ca.student_id
      WHERE ca.session_id = $1 ORDER BY ca.at DESC LIMIT 30`, [s.id]);
    res.json({
      session: sessionJson(s, true),
      serverTime: Date.now(),
      roster: roster.map((r) => ({
        id: r.id, name: r.name, rollNo: r.roll_no, present: !!r.marked_at,
        method: r.method, markedAt: r.marked_at, rssi: r.rssi,
      })),
      attempts: attempts.map((a) => ({ id: String(a.id), studentId: a.student_id, name: a.name, reason: a.reason, rssi: a.rssi, at: a.at })),
    });
  });

  r.patch('/sessions/:id', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const { rssiThreshold } = parse(z.object({ rssiThreshold: z.number().int().min(-100).max(-30) }), req.body);
    await db.query('UPDATE sessions SET rssi_threshold = $2 WHERE id = $1', [s.id, rssiThreshold]);
    res.json({ ok: true, rssiThreshold });
  });

  r.post('/sessions/:id/close', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const { rows: [closed] } = await db.query(
      `UPDATE sessions SET closed_at = LEAST(now(), ends_at) WHERE id = $1 AND closed_at IS NULL RETURNING closed_at`, [s.id]);
    if (closed) rt.toSession(s.id, 'closed', { sessionId: s.id, closedAt: closed.closed_at, reason: 'manual' });
    res.json({ ok: true });
  });

  // Manual add: for the kid whose phone died. Works on closed sessions too, for corrections.
  r.post('/sessions/:id/attendance', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const { studentId } = parse(z.object({ studentId: z.string().regex(uuid) }), req.body);
    const { rows: [enrolled] } = await db.query(
      'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2', [s.course_id, studentId]);
    if (!enrolled) fail(400, 'not_enrolled', "That student isn't in this course.");
    await db.query(`
      INSERT INTO attendance (session_id, student_id, method, marked_by) VALUES ($1, $2, 'manual', $3)
      ON CONFLICT (session_id, student_id) DO NOTHING`, [s.id, studentId, req.user!.id]);
    const entry = await rosterEntry(db, s.id, studentId);
    rt.toSession(s.id, 'mark', entry);
    rt.toUser(studentId, 'marked', { sessionId: s.id, courseName: s.course_name, method: entry.method });
    res.json({ entry });
  });

  r.delete('/sessions/:id/attendance/:studentId', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const studentId = req.params.studentId as string;
    if (!uuid.test(studentId)) fail(404, 'not_found', 'Student not found.');
    await db.query('DELETE FROM attendance WHERE session_id = $1 AND student_id = $2', [s.id, studentId]);
    rt.toSession(s.id, 'unmark', { id: studentId });
    rt.toUser(studentId, 'unmarked', { sessionId: s.id, courseName: s.course_name });
    res.json({ ok: true });
  });

  r.get('/sessions/:id/export.csv', organiser, async (req, res) => {
    const s = await ownedSession(db, req.params.id as string, req.user!.id);
    const { rows } = await db.query(`
      SELECT u.name, u.roll_no, u.email, a.method, a.marked_at, a.rssi
      FROM enrollments e JOIN users u ON u.id = e.student_id
      LEFT JOIN attendance a ON a.session_id = $1 AND a.student_id = u.id
      WHERE e.course_id = $2 ORDER BY u.name`, [s.id, s.course_id]);
    const csv = toCsv([
      ['Name', 'Roll no', 'Email', 'Status', 'Marked at', 'How', 'Signal (dBm)'],
      ...rows.map((r) => [
        r.name, r.roll_no ?? '', r.email, r.marked_at ? 'Present' : 'Absent',
        r.marked_at ? formatStamp(r.marked_at) : '', r.method === 'manual' ? 'Added by organiser' : r.method ? 'Bluetooth' : '',
        r.rssi ?? '',
      ]),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(s.course_code)}-${formatStamp(s.started_at).replace(/[: ]/g, '-')}.csv"`);
    res.send(csv);
  });

  return r;
}
