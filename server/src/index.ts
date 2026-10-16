import { createServer } from 'node:http';
import { createApp, ensureAdmin } from './app.ts';
import type { Ctx } from './context.ts';
import { createDb } from './db.ts';
import { attachRealtime } from './realtime.ts';
import { sweepExpired } from './routes/sessions.ts';
import { seedDemo } from './seed.ts';

const port = Number(process.env.PORT) || 4000;
const jwtSecret = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set; using a dev secret. Do not ship this.');

const db = await createDb();
// The routes need the socket layer, and the socket layer needs the server,
// so the server forwards to an app we build a moment later.
let app: ReturnType<typeof createApp>;
const server = createServer((req, res) => app(req, res));
const ctx: Ctx = {
  db,
  config: { jwtSecret, organiserCode: process.env.ORGANISER_CODE || 'STAFF-2026' },
  rt: attachRealtime(server, db, jwtSecret),
};
app = createApp(ctx);

await ensureAdmin(ctx, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
if (process.env.SEED_DEMO === 'true') await seedDemo(db);

// Sessions end on their own; this tells live dashboards when the timer runs out.
setInterval(() => sweepExpired(db, ctx.rt).catch((e) => console.error('sweep failed', e)), 2000).unref();

server.listen(port, () => console.log(`ProxyProof API listening on :${port}`));
