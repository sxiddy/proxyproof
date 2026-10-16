import { Router } from 'express';
import type { Ctx } from '../context.ts';
import { fail, requireAuth } from '../http.ts';

const uuid = /^[0-9a-f-]{36}$/i;

export function adminRoutes({ db, config, rt }: Ctx) {
  const r = Router();
  const admin = requireAuth(config.jwtSecret, 'admin');

  r.get('/admin/device-requests', admin, async (_req, res) => {
    const { rows } = await db.query(`
      SELECT d.id, d.model, d.created_at, u.id AS student_id, u.name, u.email, u.roll_no,
             cur.model AS current_model, cur.created_at AS current_since
      FROM devices d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN devices cur ON cur.user_id = d.user_id AND cur.status = 'active'
      WHERE d.status = 'pending'
      ORDER BY d.created_at`);
    res.json({
      requests: rows.map((d) => ({
        id: d.id,
        requestedAt: d.created_at,
        model: d.model,
        student: { id: d.student_id, name: d.name, email: d.email, rollNo: d.roll_no },
        currentDevice: d.current_model || d.current_since ? { model: d.current_model, since: d.current_since } : null,
      })),
    });
  });

  r.post('/admin/device-requests/:id/approve', admin, async (req, res) => {
    const id = req.params.id as string;
    if (!uuid.test(id)) fail(404, 'not_found', 'No such request.');
    const studentId = await db.tx(async (q) => {
      const { rows: [d] } = await q.query(`SELECT * FROM devices WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!d) fail(404, 'not_found', 'That request was already handled.');
      const { rows: [clash] } = await q.query(
        `SELECT 1 FROM devices WHERE hardware_id = $1 AND status = 'active' AND user_id <> $2`,
        [d.hardware_id, d.user_id],
      );
      if (clash) fail(409, 'device_taken', 'That phone is currently linked to a different student.');
      await q.query(
        `UPDATE devices SET status = 'revoked', note = 'replaced', decided_at = now(), decided_by = $2 WHERE user_id = $1 AND status = 'active'`,
        [d.user_id, req.user!.id],
      );
      await q.query(`UPDATE devices SET status = 'active', decided_at = now(), decided_by = $2 WHERE id = $1`, [id, req.user!.id]);
      return d.user_id as string;
    });
    rt.toUser(studentId, 'device', { status: 'active' });
    res.json({ ok: true });
  });

  r.post('/admin/device-requests/:id/reject', admin, async (req, res) => {
    const id = req.params.id as string;
    if (!uuid.test(id)) fail(404, 'not_found', 'No such request.');
    const { rows: [d] } = await db.query(
      `UPDATE devices SET status = 'rejected', decided_at = now(), decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING user_id`,
      [id, req.user!.id],
    );
    if (!d) fail(404, 'not_found', 'That request was already handled.');
    rt.toUser(d.user_id, 'device', { status: 'rejected' });
    res.json({ ok: true });
  });

  r.get('/admin/overview', admin, async (_req, res) => {
    const { rows: [o] } = await db.query(`
      SELECT (SELECT count(*) FROM users WHERE role = 'student')::int AS students,
             (SELECT count(*) FROM users WHERE role = 'organiser')::int AS organisers,
             (SELECT count(*) FROM courses)::int AS courses,
             (SELECT count(*) FROM sessions)::int AS sessions,
             (SELECT count(*) FROM devices WHERE status = 'pending')::int AS pending`);
    res.json(o);
  });

  return r;
}
