import pg from 'pg';

// A tiny wrapper so the same SQL runs against real Postgres (hosted) and
// PGlite (embedded Postgres, used for local dev and tests).
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('student', 'organiser', 'admin')),
  roll_no       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A student's phone. Only one active device per student, and one hardware id
-- can only ever be active for one student at a time.
CREATE TABLE IF NOT EXISTS devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hardware_id text NOT NULL,
  public_key  text NOT NULL,
  model       text,
  status      text NOT NULL CHECK (status IN ('active', 'pending', 'revoked', 'rejected')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_one_active_per_user ON devices (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS devices_one_pending_per_user ON devices (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS devices_hardware_active ON devices (hardware_id) WHERE status = 'active';
-- A key belongs to exactly one phone and one student, so two accounts can't share it.
CREATE UNIQUE INDEX IF NOT EXISTS devices_key_live ON devices (public_key) WHERE status IN ('active', 'pending');

CREATE TABLE IF NOT EXISTS courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  code         text NOT NULL,
  join_code    text NOT NULL UNIQUE,
  organiser_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  organiser_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beacon_code    integer NOT NULL,
  secret         text NOT NULL,
  window_seconds integer NOT NULL,
  rssi_threshold integer NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz NOT NULL,
  closed_at      timestamptz
);
-- closed_at is filled in when a session is closed by hand or runs out of time,
-- so a beacon code is only reserved while its session is live.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_live_beacon ON sessions (beacon_code) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_course ON sessions (course_id, started_at DESC);

CREATE TABLE IF NOT EXISTS attendance (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  uuid REFERENCES devices(id) ON DELETE SET NULL,
  method     text NOT NULL CHECK (method IN ('ble', 'manual')),
  rssi       integer,
  marked_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  -- Set when the organiser's phone also heard this student's phone echo back.
  heard_at   timestamptz,
  PRIMARY KEY (session_id, student_id)
);

-- Students the organiser removed by hand. Stops the phone quietly marking them again.
CREATE TABLE IF NOT EXISTS attendance_removals (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, student_id)
);
-- The "one phone marks one student" rule, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_device ON attendance (session_id, device_id) WHERE device_id IS NOT NULL;

-- Rejected check-ins, so the organiser can see when someone is trying it on.
-- One row per (session, student, reason) with a counter, so a student hovering
-- at the edge of range doesn't flood the list.
CREATE TABLE IF NOT EXISTS checkin_attempts (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  rssi       integer,
  count      integer NOT NULL DEFAULT 1,
  at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id, reason)
);
CREATE INDEX IF NOT EXISTS checkin_attempts_session ON checkin_attempts (session_id, at DESC);
`;

export async function createDb(url = process.env.DATABASE_URL): Promise<Db> {
  let db: Db;

  if (url) {
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
    db = {
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (sql, params) => client.query(sql, params as any[]) as any });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    // PGLITE_DIR keeps data between restarts; without it everything lives in memory.
    const lite = new PGlite(process.env.PGLITE_DIR || undefined);
    db = {
      query: (sql, params) => lite.query(sql, params as any[]) as any,
      tx: (fn) => lite.transaction((t) => fn({ query: (sql, params) => t.query(sql, params as any[]) as any })),
      close: () => lite.close(),
    };
  }

  // Prepared queries take one statement at a time, so feed the schema in pieces.
  for (const stmt of SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
  return db;
}
