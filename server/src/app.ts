import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import type { Ctx } from './context.ts';
import { errorHandler } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { checkinRoutes } from './routes/checkin.ts';
import { courseRoutes } from './routes/courses.ts';
import { sessionRoutes } from './routes/sessions.ts';

export function createApp(ctx: Ctx) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.get('/', (_req, res) => {
    res.type('text/plain').send('ProxyProof API is up. The app talks to this; there is nothing to see here.');
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(authRoutes(ctx));
  app.use(adminRoutes(ctx));
  app.use(courseRoutes(ctx));
  app.use(sessionRoutes(ctx));
  app.use(checkinRoutes(ctx));

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Nothing here.' } }));
  app.use(errorHandler);
  return app;
}

/** Make sure there's an admin to approve device switches. */
export async function ensureAdmin(ctx: Ctx, email?: string, password?: string) {
  if (!email || !password) return;
  const { rows } = await ctx.db.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
  if (rows.length) return;
  await ctx.db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', $1, $2, 'admin')`,
    [email.toLowerCase(), await bcrypt.hash(password, 10)],
  );
  console.log(`Created admin account ${email}`);
}
