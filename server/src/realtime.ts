import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Db } from './db.ts';
import { readToken } from './http.ts';

// Everything the live dashboard and the student's "you're in" screen listen to.
export interface Realtime {
  toSession(sessionId: string, event: string, payload: unknown): void;
  toUser(userId: string, event: string, payload: unknown): void;
  close(): Promise<void>;
}

export const silentRealtime: Realtime = {
  toSession() {},
  toUser() {},
  async close() {},
};

export function attachRealtime(server: HttpServer, db: Db, jwtSecret: string): Realtime {
  const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10_000 });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const user = typeof token === 'string' ? readToken(jwtSecret, token) : null;
    if (!user) return next(new Error('unauthenticated'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    // Organisers ask to follow one of their own sessions.
    socket.on('watch', async (sessionId: unknown, ack?: (res: { ok: boolean }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return reply({ ok: false });
      const { rows } = await db.query(
        'SELECT 1 FROM sessions WHERE id = $1 AND organiser_id = $2',
        [sessionId, user.id],
      ).catch(() => ({ rows: [] }));
      if (!rows.length) return reply({ ok: false });
      socket.join(`session:${sessionId}`);
      reply({ ok: true });
    });

    socket.on('unwatch', (sessionId: unknown) => {
      if (typeof sessionId === 'string') socket.leave(`session:${sessionId}`);
    });
  });

  return {
    toSession: (id, event, payload) => io.to(`session:${id}`).emit(event, payload),
    toUser: (id, event, payload) => io.to(`user:${id}`).emit(event, payload),
    close: () => new Promise((resolve) => io.close(() => resolve())),
  };
}
