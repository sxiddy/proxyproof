import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import type { Queryable } from '../db.ts';
import { fail, parse, requireAuth, toCsv } from '../http.ts';

const uuid = /^[0-9a-f-]{36}$/i;
// No 0/O or 1/I/L, so codes read cleanly off a projector.
const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function joinCode() {
  return Array.from({ length: 6 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join('');
}

export async function ownedCourse(q: Queryable, courseId: string, organiserId: string) {
  if (!uuid.test(courseId)) fail(404, 'not_found', 'Course not found.');
  const { rows: [course] } = await q.query('SELECT * FROM courses WHERE id = $1 AND organiser_id = $2', [courseId, organiserId]);
  if (!course) fail(404, 'not_found', 'Course not found.');
  return course;
}

/**
 * A session counts towards a student's total once it's over, and only if it
 * happened after they joined. Anything they were actually marked in counts
 * no matter what.
 */
const COUNTS = `(s.closed_at IS NOT NULL AND s.started_at >= e.joined_at) OR a.student_id IS NOT NULL`;

export function percent(attended: number, total: number) {
  // Floor, so 74.6% never shows as a reassuring 75%.
  // Integer maths first: (29 / 50) * 100 is 57.99999… in floating point.
  return total ? Math.floor((attended * 100) / total) : null;
}

export function courseRoutes({ db, config }: Ctx) {
  const r = Router();
  const anyone = requireAuth(config.jwtSecret, 'student', 'organiser');
  const organiser = requireAuth(config.jwtSecret, 'organiser');
  const student = requireAuth(config.jwtSecret, 'student');

  r.get('/courses', anyone, async (req, res) => {
    const me = req.user!;
    if (me.role === 'organiser') {
      const { rows } = await db.query(`
        SELECT c.*,
          (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id)::int AS students,
          (SELECT count(*) FROM sessions s WHERE s.course_id = c.id)::int AS sessions,
          (SELECT s.id FROM sessions s WHERE s.course_id = c.id AND s.closed_at IS NULL AND s.ends_at > now() LIMIT 1) AS live_session_id
        FROM courses c WHERE c.organiser_id = $1 ORDER BY c.created_at DESC`, [me.id]);
      return res.json({
        courses: rows.map((c) => ({
          id: c.id, name: c.name, code: c.code, joinCode: c.join_code,
          students: c.students, sessions: c.sessions, liveSessionId: c.live_session_id,
        })),
      });
    }

    const { rows } = await db.query(`
      SELECT c.id, c.name, c.code, u.name AS organiser,
        count(s.id) FILTER (WHERE ${COUNTS})::int AS total,
        count(a.student_id)::int AS attended,
        (SELECT s2.id FROM sessions s2 WHERE s2.course_id = c.id AND s2.closed_at IS NULL AND s2.ends_at > now() LIMIT 1) AS live_session_id
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      JOIN users u ON u.id = c.organiser_id
      LEFT JOIN sessions s ON s.course_id = c.id
      LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = e.student_id
      WHERE e.student_id = $1
      GROUP BY c.id, u.name, e.joined_at
      ORDER BY e.joined_at DESC`, [me.id]);
    res.json({
      courses: rows.map((c) => ({
        id: c.id, name: c.name, code: c.code, organiser: c.organiser,
        attended: c.attended, total: c.total, percentage: percent(c.attended, c.total),
        liveSessionId: c.live_session_id,
      })),
    });
  });

  r.post('/courses', organiser, async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2, 'Give the course a name').max(80),
      code: z.string().trim().min(2, 'Add a short code like CS201').max(16),
    }), req.body);

    // Retry on the (very unlikely) join-code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows: [c] } = await db.query(
          'INSERT INTO courses (name, code, join_code, organiser_id) VALUES ($1, $2, $3, $4) RETURNING *',
          [body.name, body.code.toUpperCase(), joinCode(), req.user!.id],
        );
        return res.status(201).json({ course: { id: c.id, name: c.name, code: c.code, joinCode: c.join_code, students: 0, sessions: 0, liveSessionId: null } });
      } catch (err: any) {
        if (err?.code !== '23505') throw err;
      }
    }
    fail(500, 'server_error', "Couldn't create a join code. Try again.");
  });

  r.post('/courses/join', student, async (req, res) => {
    const { joinCode: code } = parse(z.object({ joinCode: z.string().trim().toUpperCase().length(6, 'Join codes are 6 characters') }), req.body);
    const { rows: [course] } = await db.query('SELECT id, name, code FROM courses WHERE join_code = $1', [code]);
    if (!course) fail(404, 'bad_join_code', "No course with that code. Double-check it with your organiser.");
    const { rows } = await db.query(
      `INSERT INTO enrollments (course_id, student_id, joined_at)
       VALUES ($1, $2, COALESCE((SELECT joined_at FROM course_removals WHERE course_id = $1 AND student_id = $2), now()))
       ON CONFLICT DO NOTHING RETURNING 1`,
      [course.id, req.user!.id],
    );
    res.status(rows.length ? 201 : 200).json({ course, alreadyJoined: !rows.length });
  });

  r.get('/courses/:id', anyone, async (req, res) => {
    const me = req.user!;
    const id = req.params.id as string;

    if (me.role === 'organiser') {
      const course = await ownedCourse(db, id, me.id);
      const { rows: students } = await db.query(`
        SELECT u.id, u.name, u.email, u.roll_no, e.joined_at,
          count(s.id) FILTER (WHERE ${COUNTS})::int AS total,
          count(a.student_id)::int AS attended
        FROM enrollments e
        JOIN users u ON u.id = e.student_id
        LEFT JOIN sessions s ON s.course_id = e.course_id
        LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = e.student_id
        WHERE e.course_id = $1
        GROUP BY u.id, e.joined_at
        ORDER BY u.name`, [id]);
      const { rows: sessions } = await db.query(`
        SELECT s.id, s.started_at, s.ends_at, s.closed_at,
          (SELECT count(*) FROM attendance a WHERE a.session_id = s.id)::int AS present
        FROM sessions s WHERE s.course_id = $1 ORDER BY s.started_at DESC`, [id]);
      return res.json({
        course: { id: course.id, name: course.name, code: course.code, joinCode: course.join_code },
        students: students.map((s) => ({
          id: s.id, name: s.name, email: s.email, rollNo: s.roll_no,
          attended: s.attended, total: s.total, percentage: percent(s.attended, s.total),
        })),
        sessions: sessions.map((s) => ({
          id: s.id, startedAt: s.started_at, endsAt: s.ends_at, closedAt: s.closed_at,
          live: !s.closed_at && new Date(s.ends_at) > new Date(), present: s.present,
        })),
      });
    }

    if (!uuid.test(id)) fail(404, 'not_found', 'Course not found.');
    const { rows: [course] } = await db.query(`
      SELECT c.id, c.name, c.code, u.name AS organiser, e.joined_at
      FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = c.organiser_id
      WHERE c.id = $1 AND e.student_id = $2`, [id, me.id]);
    if (!course) fail(404, 'not_found', "You're not in this course.");
    const { rows: sessions } = await db.query(`
      SELECT s.id, s.started_at, s.closed_at, s.ends_at, a.marked_at, a.method
      FROM sessions s
      JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = $2
      LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = $2
      WHERE s.course_id = $1 AND (${COUNTS} OR (s.closed_at IS NULL AND s.ends_at > now()))
      ORDER BY s.started_at DESC`, [id, me.id]);
    const finished = sessions.filter((s) => s.closed_at || s.marked_at);
    const attended = finished.filter((s) => s.marked_at).length;
    res.json({
      course: { id: course.id, name: course.name, code: course.code, organiser: course.organiser },
      attended, total: finished.length, percentage: percent(attended, finished.length),
      sessions: sessions.map((s) => ({
        id: s.id, startedAt: s.started_at,
        status: s.marked_at ? 'present' : s.closed_at ? 'absent' : 'live',
        markedAt: s.marked_at, method: s.method,
      })),
    });
  });

  r.delete('/courses/:id/students/:studentId', organiser, async (req, res) => {
    await ownedCourse(db, req.params.id as string, req.user!.id);
    if (!uuid.test(req.params.studentId as string)) fail(404, 'not_found', 'Student not found.');
    await db.tx(async (q) => {
      await q.query(`INSERT INTO course_removals (course_id, student_id, joined_at)
        SELECT course_id, student_id, joined_at FROM enrollments WHERE course_id = $1 AND student_id = $2
        ON CONFLICT DO NOTHING`, [req.params.id, req.params.studentId]);
      await q.query('DELETE FROM enrollments WHERE course_id = $1 AND student_id = $2', [req.params.id, req.params.studentId]);
    });
    res.json({ ok: true });
  });

  // One row per student, one column per session. Opens straight in Excel/Sheets.
  r.get('/courses/:id/export.csv', organiser, async (req, res) => {
    const course = await ownedCourse(db, req.params.id as string, req.user!.id);
    const { rows: sessions } = await db.query(
      'SELECT id, started_at, closed_at FROM sessions WHERE course_id = $1 ORDER BY started_at', [course.id]);
    const { rows: students } = await db.query(`
      SELECT u.id, u.name, u.email, u.roll_no, e.joined_at FROM enrollments e JOIN users u ON u.id = e.student_id
      WHERE e.course_id = $1 ORDER BY u.name`, [course.id]);
    const { rows: marks } = await db.query(`
      SELECT a.session_id, a.student_id, a.method FROM attendance a JOIN sessions s ON s.id = a.session_id
      WHERE s.course_id = $1`, [course.id]);
    const marked = new Map(marks.map((m) => [`${m.session_id}:${m.student_id}`, m.method]));

    const header = ['Name', 'Roll no', 'Email', ...sessions.map((s) => formatStamp(s.started_at)), 'Attended', 'Total', 'Percentage'];
    const body = students.map((st) => {
      let attended = 0;
      let total = 0;
      const cells = sessions.map((s) => {
        const m = marked.get(`${s.id}:${st.id}`);
        if (m) { attended++; total++; return m === 'manual' ? 'P (manual)' : 'P'; }
        if (new Date(s.started_at) < new Date(st.joined_at)) return '-';
        if (!s.closed_at) return 'live'; // still running: not absent yet, so don't count it
        total++;
        return 'A';
      });
      const pct = percent(attended, total);
      return [st.name, st.roll_no ?? '', st.email, ...cells, attended, total, pct == null ? '' : `${pct}%`];
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(course.code)}-attendance.csv"`);
    res.send(toCsv([header, ...body]));
  });

  return r;
}

// Servers usually run in UTC; exports should read in the college's local time.
const stampFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.DISPLAY_TIMEZONE || 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatStamp(d: Date | string) {
  const p = Object.fromEntries(stampFormat.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function safeName(s: string) {
  return s.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'export';
}
